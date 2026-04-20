# -*- coding: utf-8 -*-
"""
脑卒中：基于预处理数据的建模、风险分层与 MLP 特征重要度

- 优先读取 origin/balanced_train_stroke.csv 与 origin/balanced_test_stroke.csv（由 文本数据预处理1.py 产出）
- 若平衡数据不存在，则回退读取 origin/stroke_preprocessed.csv（若不存在则先运行 文本数据预处理.py）
- 二分类：target_stroke（1=患脑卒中，0=未患脑卒中）
- 训练：标准化 + XGBoost（scale_pos_weight 平衡）；特征重要度以 MLP（3 层）权重绝对值 + Permutation 验证
- 风险等级：验证集选阈值后预测概率，按训练集分位数映射为 1~4（model_risk_tier）
- 重要病因/特征：MLP 权重绝对值重要度 + Permutation（打乱单列看性能下降）验证；附 XGBoost gain 重要度作对照

依赖：pip install xgboost matplotlib（shap 不再必需）

输出目录：models/stroke/
"""

from __future__ import annotations

import importlib.util
import argparse
import json
import warnings
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from xgboost import XGBClassifier
from sklearn.calibration import CalibratedClassifierCV
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    balanced_accuracy_score,
    brier_score_loss,
    classification_report,
    confusion_matrix,
    f1_score,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.neural_network import MLPClassifier

warnings.filterwarnings("ignore", category=UserWarning)

ROOT = Path(__file__).resolve().parent
DATA_CSV = ROOT / "origin" / "stroke_preprocessed.csv"
BALANCED_TRAIN_CSV = ROOT / "origin" / "balanced_train_stroke.csv"
BALANCED_TEST_CSV = ROOT / "origin" / "balanced_test_stroke.csv"
SELECTED_TRAIN_CSV = ROOT / "origin" / "selected25_train_stroke.csv"
SELECTED_TEST_CSV = ROOT / "origin" / "selected25_test_stroke.csv"
SELECTED_TRAIN_CSV_NEW = ROOT / "origin" / "selected25_train_stroke_new.csv"
SELECTED_TEST_CSV_NEW = ROOT / "origin" / "selected25_test_stroke_new.csv"
PREPROCESS_SCRIPT = ROOT / "文本数据预处理.py"
PREPROCESS_BALANCED_SCRIPT = ROOT / "文本数据预处理1.py"
MODEL_DIR = ROOT / "models" / "stroke"
COLUMN_DESC_CSV = ROOT / "origin" / "merged_stroke_metabolism_列说明.csv"

LABEL_COL = "target_stroke"
EXCLUDE_FROM_FEATURES = {
    "SEQN",
    "MCQ160F",
    LABEL_COL,
    "stroke_risk_tier",
}


def _prepare_feature_frame(
    X: Any,
    feature_columns: list[str],
    medians: dict[str, float] | None = None,
) -> pd.DataFrame:
    """
    让模型对“缺列/缺失值”具有容错：
    - 允许输入 DataFrame / dict / dict 列表
    - 按训练时 feature_columns 对齐列顺序与缺失列
    - 将非数值转为 NaN；缺失列/缺失值保持为 NaN（不用训练中位数填充）
    - medians 参数仅为兼容旧版封装对象，已不再使用
    """
    if isinstance(X, pd.DataFrame):
        df = X.copy()
    elif isinstance(X, dict):
        df = pd.DataFrame([X])
    elif isinstance(X, list) and (not X or isinstance(X[0], dict)):
        df = pd.DataFrame(X)
    else:
        raise TypeError("模型输入 X 必须是 pandas.DataFrame 或 dict 或 dict 列表。")

    # 一步到位对齐训练特征列（避免逐列插入导致 DataFrame 高度碎片化）
    df = df.reindex(columns=feature_columns)

    # 统一数值化 + 缺失处理
    df = df.apply(pd.to_numeric, errors="coerce")
    # 注意：输入 DataFrame 可能来自 dict/list，可能携带 None 导致对象类型；
    # 用 ==np.inf/-np.inf 构造掩码比 np.isinf 更稳。
    df = df.mask((df == np.inf) | (df == -np.inf), np.nan)
    # 保持 float，允许 NaN 进入 StandardScaler + XGBoost（树模型可处理缺失）
    df = df.astype(float)
    return df


class StrokeProbaWrapper:
    """
    用于“让模型文件本身具备容错能力”的封装：
    对输入特征做列对齐；缺失保持 NaN，再调用内部已训练好的 pipeline.predict_proba。
    若某行全部为 NaN（未提供任何特征），树模型/标准化对“全缺失”输入不稳定，正类概率固定为 0（不采用总体先验）。
    """

    def __init__(
        self,
        base_model,
        feature_columns: list[str],
        feature_medians: dict[str, float] | pd.Series | None = None,
        uncertain_prior: float | None = None,
    ):
        self.base_model = base_model
        self._tolerant_feature_columns = list(feature_columns)
        self.is_tolerant_model = True
        # 全缺失样本使用的先验阳性概率（一般用测试集阳性率，接近总体先验）
        self.uncertain_prior = uncertain_prior

        # 旧版本曾保存训练中位数用于填补；当前预测阶段不再使用，仅保留属性以兼容旧 joblib
        if feature_medians is None:
            self._medians_dict = {}
        elif isinstance(feature_medians, pd.Series):
            self._medians_dict = feature_medians.to_dict()
        else:
            self._medians_dict = dict(feature_medians)

    def predict_proba(self, X: Any) -> np.ndarray:
        Xp = _prepare_feature_frame(
            X=X,
            feature_columns=self._tolerant_feature_columns,
        )
        proba = np.asarray(self.base_model.predict_proba(Xp), dtype=float)
        # 全 NaN 行：模型输出不可靠；按产品要求正类概率为 0（阴性概率为 1）
        mat = Xp.to_numpy(dtype=float, copy=False)
        row_all_nan = np.isnan(mat).all(axis=1)
        if row_all_nan.any():
            proba = proba.copy()
            proba[row_all_nan, 0] = 1.0
            proba[row_all_nan, 1] = 0.0
        return proba

    def predict(self, X: Any) -> np.ndarray:
        Xp = _prepare_feature_frame(
            X=X,
            feature_columns=self._tolerant_feature_columns,
        )
        # 让封装尽量兼容 sklearn 接口
        if hasattr(self.base_model, "predict"):
            return self.base_model.predict(Xp)
        # 实在没有 predict，就用 proba 阈值 0.5 兜底
        p = self.base_model.predict_proba(Xp)[:, 1]
        return (p >= 0.5).astype(int)


def _ensure_preprocessed() -> None:
    if DATA_CSV.is_file():
        return
    if not PREPROCESS_SCRIPT.is_file():
        raise FileNotFoundError(
            f"未找到 {DATA_CSV}，且缺少预处理脚本 {PREPROCESS_SCRIPT}"
        )
    spec = importlib.util.spec_from_file_location("stroke_preprocess", PREPROCESS_SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    mod.main()
    if not DATA_CSV.is_file():
        raise FileNotFoundError(f"预处理后仍未生成 {DATA_CSV}")


def _ensure_balanced_preprocessed() -> None:
    if (
        (SELECTED_TRAIN_CSV.is_file() and SELECTED_TEST_CSV.is_file())
        or (BALANCED_TRAIN_CSV.is_file() and BALANCED_TEST_CSV.is_file())
    ):
        return
    if PREPROCESS_BALANCED_SCRIPT.is_file():
        spec = importlib.util.spec_from_file_location(
            "stroke_preprocess_balanced", PREPROCESS_BALANCED_SCRIPT
        )
        mod = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(mod)
        mod.main()
    if BALANCED_TRAIN_CSV.is_file() and BALANCED_TEST_CSV.is_file():
        return
    # 回退到旧流程
    _ensure_preprocessed()


def _pick_latest_existing(*paths: Path) -> Path | None:
    exists = [p for p in paths if p.is_file()]
    if not exists:
        return None
    return max(exists, key=lambda p: p.stat().st_mtime)


def _xy_from_df(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series]:
    if LABEL_COL not in df.columns:
        raise ValueError(f"数据中缺少列 {LABEL_COL}")
    sub = df[df[LABEL_COL].notna()].copy()
    y = sub[LABEL_COL].astype(int)
    feat_cols = [c for c in sub.columns if c not in EXCLUDE_FROM_FEATURES]
    X = sub[feat_cols].copy()
    # 统一数值、处理无穷
    for c in X.columns:
        X.loc[:, c] = pd.to_numeric(X[c], errors="coerce")
    X = X.mask((X == np.inf) | (X == -np.inf), np.nan)
    med = X.median(numeric_only=True)
    X = X.fillna(med)
    # 去掉常数列，避免标准化报错
    nuniq = X.nunique()
    const_cols = nuniq[nuniq <= 1].index.tolist()
    if const_cols:
        X = X.drop(columns=const_cols)
    return X, y


def load_train_test_xy() -> tuple[pd.DataFrame, pd.Series, pd.DataFrame, pd.Series]:
    _ensure_balanced_preprocessed()
    # 优先使用“单因素筛选后”的最终训练/测试集
    selected_train_path = _pick_latest_existing(SELECTED_TRAIN_CSV_NEW, SELECTED_TRAIN_CSV)
    selected_test_path = _pick_latest_existing(SELECTED_TEST_CSV_NEW, SELECTED_TEST_CSV)
    if selected_train_path is not None and selected_test_path is not None:
        df_train = pd.read_csv(selected_train_path, low_memory=False)
        df_test = pd.read_csv(selected_test_path, low_memory=False)
        X_train, y_train = _xy_from_df(df_train)
        X_test, y_test = _xy_from_df(df_test)
        X_test = X_test.reindex(columns=X_train.columns, fill_value=0.0)
        return X_train, y_train, X_test, y_test

    if BALANCED_TRAIN_CSV.is_file() and BALANCED_TEST_CSV.is_file():
        df_train = pd.read_csv(BALANCED_TRAIN_CSV, low_memory=False)
        df_test = pd.read_csv(BALANCED_TEST_CSV, low_memory=False)
        X_train, y_train = _xy_from_df(df_train)
        X_test, y_test = _xy_from_df(df_test)
        # 保证训练/测试列一致（以训练列为准）
        X_test = X_test.reindex(columns=X_train.columns, fill_value=0.0)
        return X_train, y_train, X_test, y_test

    # 回退：只有基础预处理，按原逻辑切分
    df = pd.read_csv(DATA_CSV, low_memory=False)
    X, y = _xy_from_df(df)
    X_train, X_test, y_train, y_test = train_test_split(
        X,
        y,
        test_size=0.2,
        stratify=y,
        random_state=42,
    )
    return X_train, y_train, X_test, y_test


def load_column_zh_map() -> tuple[dict[str, str], dict[str, str]]:
    """从列说明表加载 变量名 -> 中文含义、特征值说明。"""
    name_zh: dict[str, str] = {}
    name_note: dict[str, str] = {}
    if not COLUMN_DESC_CSV.is_file():
        return name_zh, name_note
    desc = pd.read_csv(COLUMN_DESC_CSV, encoding="utf-8-sig")
    col_var = "变量名" if "变量名" in desc.columns else desc.columns[0]
    col_cn = "中文含义" if "中文含义" in desc.columns else None
    col_note = "特征值说明_中文" if "特征值说明_中文" in desc.columns else None
    for _, row in desc.iterrows():
        key = str(row[col_var]).strip()
        if col_cn and pd.notna(row.get(col_cn, np.nan)):
            name_zh[key] = str(row[col_cn]).strip()
        if col_note and pd.notna(row.get(col_note, np.nan)):
            name_note[key] = str(row[col_note]).strip()

    # 强制覆盖：派生特征/编码特征中文含义用于重要特征输出
    name_zh.update(
        {
            "SMQ040": "您现在吸烟吗",
            "DIQ010": "是否确诊糖尿病",
            "DIQ160": "是否糖尿病前期",
            "SLQ_duration": "睡眠时长分级",
            "SLQ_disorder": "睡眠障碍风险",
            "ALQ121": "饮酒频率",
            "CHOL": "胆固醇",
            "MAP": "平均动脉压（MAP, Mean Arterial Pressure）",
        }
    )
    return name_zh, name_note


def attach_zh_columns(df: pd.DataFrame, name_zh: dict[str, str], name_note: dict[str, str]) -> pd.DataFrame:
    out = df.copy()
    out["中文含义"] = out["feature"].map(lambda x: name_zh.get(str(x), ""))
    out["特征值说明_中文"] = out["feature"].map(lambda x: name_note.get(str(x), ""))
    rest = [c for c in out.columns if c not in ("feature", "中文含义", "特征值说明_中文")]
    return out[["feature", "中文含义", "特征值说明_中文"] + rest]


def train_models(
    X_train: pd.DataFrame,
    y_train: pd.Series,
    X_test: pd.DataFrame,
    y_test: pd.Series,
    random_state: int = 42,
    use_smote: bool = False,
    calibration_mode: str = "auto",
):
    def _eval_metrics(y_true: pd.Series, y_score: np.ndarray, threshold: float) -> dict:
        y_pred_local = (y_score >= threshold).astype(int)
        acc_local = float(accuracy_score(y_true, y_pred_local))
        bacc_local = float(balanced_accuracy_score(y_true, y_pred_local))
        denom_local = acc_local + bacc_local
        trusted_local = (
            float(2 * acc_local * bacc_local / denom_local) if denom_local > 1e-12 else 0.0
        )
        return {
            "threshold": float(threshold),
            "accuracy": acc_local,
            "balanced_accuracy": bacc_local,
            "trusted_accuracy": trusted_local,
            "f1": float(f1_score(y_true, y_pred_local, zero_division=0)),
            "confusion_matrix": confusion_matrix(y_true, y_pred_local).tolist(),
            "classification_report": classification_report(
                y_true, y_pred_local, digits=4, output_dict=True
            ),
        }

    feature_cols = list(X_train.columns)
    # 可选 SMOTE 过采样少数类（需 imbalanced-learn；默认关闭，因为已使用平衡训练集）
    if use_smote:
        try:
            from imblearn.over_sampling import SMOTE

            min_cls = int(y_train.value_counts().min())
            k = max(1, min(5, min_cls - 1))
            if min_cls >= 2 and k >= 1:
                sm = SMOTE(random_state=random_state, k_neighbors=k)
                X_train, y_train = sm.fit_resample(X_train, y_train)
                X_train = pd.DataFrame(X_train, columns=feature_cols)
                y_train = pd.Series(y_train)
        except Exception:
            pass

    # 再从训练集中划验证集，用于阈值选择，减轻对训练集的过拟合
    X_fit, X_val, y_fit, y_val = train_test_split(
        X_train,
        y_train,
        test_size=0.2,
        stratify=y_train,
        random_state=random_state,
    )

    _pos = float((y_fit == 1).sum())
    _neg = float((y_fit == 0).sum())
    _scale_pos_weight = float(_neg / _pos) if _pos > 0 else 1.0
    rf = Pipeline(
        [
            ("scaler", StandardScaler()),
            (
                "clf",
                XGBClassifier(
                    n_estimators=200,
                    max_depth=12,
                    min_child_weight=4,
                    learning_rate=0.1,
                    subsample=0.8,
                    colsample_bytree=0.8,
                    scale_pos_weight=_scale_pos_weight,
                    random_state=random_state,
                    n_jobs=-1,
                    eval_metric="logloss",
                ),
            ),
        ]
    )
    rf.fit(X_fit, y_fit)

    proba_train_raw = rf.predict_proba(X_train)[:, 1]

    # 阈值选择：在“未重采样分布”数据上进行，减少分布偏移影响
    X_thr, X_eval, y_thr, y_eval = train_test_split(
        X_test,
        y_test,
        test_size=0.5,
        stratify=y_test,
        random_state=random_state,
    )
    # 概率校准：在未重采样分布子集上拟合，并按 Brier score 选择
    calibration_method = "none"
    model_for_infer = rf
    brier_candidates: dict[str, float] = {}
    prob_uncal = rf.predict_proba(X_thr)[:, 1]
    brier_candidates["none"] = float(brier_score_loss(y_thr, prob_uncal))

    def _fit_calibrator(method: str):
        c = CalibratedClassifierCV(rf, method=method, cv="prefit")
        c.fit(X_thr, y_thr)
        p = c.predict_proba(X_thr)[:, 1]
        return c, float(brier_score_loss(y_thr, p))

    mode = str(calibration_mode).lower().strip()
    if mode not in {"auto", "sigmoid", "isotonic", "none"}:
        mode = "auto"

    if mode in {"auto", "sigmoid"}:
        try:
            cal_sig, brier_sig = _fit_calibrator("sigmoid")
            brier_candidates["sigmoid"] = brier_sig
            if mode == "sigmoid":
                model_for_infer = cal_sig
                calibration_method = "sigmoid_prefit_on_unresampled_threshold_set"
        except Exception:
            pass

    if mode in {"auto", "isotonic"}:
        try:
            cal_iso, brier_iso = _fit_calibrator("isotonic")
            brier_candidates["isotonic"] = brier_iso
            if mode == "isotonic":
                model_for_infer = cal_iso
                calibration_method = "isotonic_prefit_on_unresampled_threshold_set"
        except Exception:
            pass

    if mode == "auto":
        best_name = min(brier_candidates, key=brier_candidates.get)
        if best_name == "sigmoid" and "cal_sig" in locals():
            model_for_infer = cal_sig
            calibration_method = "auto->sigmoid_prefit_on_unresampled_threshold_set"
        elif best_name == "isotonic" and "cal_iso" in locals():
            model_for_infer = cal_iso
            calibration_method = "auto->isotonic_prefit_on_unresampled_threshold_set"
        else:
            model_for_infer = rf
            calibration_method = "auto->none"

    proba_train = model_for_infer.predict_proba(X_train)[:, 1]
    proba_thr = model_for_infer.predict_proba(X_thr)[:, 1]
    y_proba = model_for_infer.predict_proba(X_eval)[:, 1]

    # 在未重采样验证集上分别搜索 F1 最优阈值与 BA 最优阈值
    best_t_f1, best_f1_val = 0.5, -1.0
    best_t_ba, best_ba_val = 0.5, -1.0
    for t in np.linspace(0.02, 0.95, 94):
        pred_thr = (proba_thr >= t).astype(int)
        f1 = f1_score(y_thr, pred_thr, zero_division=0)
        ba = balanced_accuracy_score(y_thr, pred_thr)
        if f1 > best_f1_val:
            best_f1_val = f1
            best_t_f1 = float(t)
        if ba > best_ba_val:
            best_ba_val = ba
            best_t_ba = float(t)

    # 两套阈值均在评估集上报告；主输出采用 BA 最优阈值
    eval_f1 = _eval_metrics(y_eval, y_proba, best_t_f1)
    eval_ba = _eval_metrics(y_eval, y_proba, best_t_ba)
    y_pred = (y_proba >= best_t_ba).astype(int)

    metrics = {
        "roc_auc": float(roc_auc_score(y_eval, y_proba)),
        "pr_auc": float(average_precision_score(y_eval, y_proba)),
        "accuracy": eval_ba["accuracy"],
        "balanced_accuracy": eval_ba["balanced_accuracy"],
        "trusted_accuracy": eval_ba["trusted_accuracy"],
        "threshold_selected": best_t_ba,
        "threshold_ba_val": best_t_ba,
        "ba_val_at_threshold": float(best_ba_val),
        "threshold_f1_val": best_t_f1,
        "f1_val_at_threshold": float(best_f1_val),
        "threshold_compare_on_eval": {
            "f1_threshold": eval_f1,
            "ba_threshold": eval_ba,
        },
        "calibration_method": calibration_method,
        "calibration_mode": mode,
        "calibration_brier_candidates": brier_candidates,
        "n_train_after_smote": int(len(y_train)),
        "n_fit": int(len(y_fit)),
        "n_val_model_fit": int(len(y_val)),
        "n_val_threshold": int(len(y_thr)),
        "n_test": int(len(y_eval)),
        "n_features": int(X_train.shape[1]),
        "positive_rate_train": float(y_train.mean()),
        "positive_rate_test": float(y_eval.mean()),
    }
    metrics["classification_report"] = eval_ba["classification_report"]
    metrics["confusion_matrix"] = eval_ba["confusion_matrix"]

    # 方案C：固定阈值分档（更稳定且便于临床沟通）
    # 档1: p < 0.20；档2: 0.20 <= p < 0.50；档3: 0.50 <= p < 0.80；档4: p >= 0.80
    fixed_thresholds = [0.20, 0.50, 0.80]
    metrics["risk_tier_scheme"] = "fixed_thresholds"
    metrics["risk_fixed_thresholds"] = fixed_thresholds
    # 兼容旧字段名，保留写出
    metrics["risk_quantiles_train"] = fixed_thresholds

    def proba_to_tier(p: np.ndarray) -> np.ndarray:
        p = np.asarray(p, dtype=float)
        t = np.ones(len(p), dtype=int)
        t[p >= fixed_thresholds[0]] = 2
        t[p >= fixed_thresholds[1]] = 3
        t[p >= fixed_thresholds[2]] = 4
        return t

    risk_test = proba_to_tier(y_proba)
    metrics["model_risk_tier_distribution_test"] = (
        pd.Series(risk_test).value_counts().sort_index().to_dict()
    )

    # XGBoost gain 重要度（仅作对照）
    imp = pd.DataFrame(
        {
            "feature": X_train.columns,
            "rf_importance": rf.named_steps["clf"].feature_importances_,
        }
    )

    # ---------- MLP（3 层隐藏层）：基于权重绝对值的特征重要度 ----------
    # 使用 StandardScaler + 3 层 MLP 学习分类权重；通过绝对值权重估计各输入特征的重要性。
    # 注：这里的重要度来自“连接路径的权重绝对值”近似（非因果），用于排序与筛选参考。
    mlp_pipe = Pipeline(
        [
            ("scaler", StandardScaler()),
            (
                "clf",
                MLPClassifier(
                    hidden_layer_sizes=(64, 32, 16),  # 3 层隐藏层
                    activation="relu",
                    alpha=1e-4,
                    batch_size=64,
                    learning_rate_init=1e-3,
                    max_iter=3000,
                    early_stopping=True,
                    n_iter_no_change=30,
                    random_state=random_state,
                ),
            ),
        ]
    )
    mlp_pipe.fit(X_fit, y_fit)
    mlp_clf = mlp_pipe.named_steps["clf"]
    coefs = mlp_clf.coefs_  # 每层权重矩阵；最后一层输出层权重也包含在内
    eff = np.abs(coefs[0])
    for W in coefs[1:]:
        eff = eff.dot(np.abs(W))  # 近似“从输入到输出的所有路径贡献”
    mlp_weight_importance = eff.sum(axis=1) if eff.ndim == 2 else eff.ravel()

    importance = (
        pd.DataFrame(
            {
                "feature": X_train.columns,
                "mlp_weight_abs_importance": mlp_weight_importance,
            }
        )
        .merge(imp, on="feature")
        .sort_values("mlp_weight_abs_importance", ascending=False)
    )

    # ---------- Permutation Importance（排列重要性：打乱特征，看性能下降）----------
    # 对所有特征逐列做排列重要性（打乱该列，其它列保持不变），量化性能下降幅度。
    perm_features = list(X_train.columns)
    thr_for_perf = float(metrics.get("threshold_selected", 0.5))

    baseline_roc_auc = float(metrics["roc_auc"])
    baseline_pr_auc = float(metrics["pr_auc"])
    baseline_acc = float(metrics["accuracy"])
    baseline_bacc = float(metrics["balanced_accuracy"])
    baseline_trusted = float(metrics["trusted_accuracy"])

    perm_rng = np.random.RandomState(random_state)

    perm_rows: list[dict] = []
    for f in perm_features:
        Xp = X_eval.copy()
        # 仅打乱该列，其它列保持不变
        Xp[f] = perm_rng.permutation(Xp[f].to_numpy())
        y_perm_proba = model_for_infer.predict_proba(Xp)[:, 1]

        try:
            roc_p = float(roc_auc_score(y_eval, y_perm_proba))
        except Exception:
            roc_p = np.nan
        try:
            pr_p = float(average_precision_score(y_eval, y_perm_proba))
        except Exception:
            pr_p = np.nan

        # 与主模型输出保持一致：用与基线相同的阈值计算分类指标
        eval_p = _eval_metrics(y_eval, y_perm_proba, threshold=thr_for_perf)
        perm_rows.append(
            {
                "feature": f,
                "perm_roc_auc": roc_p,
                "perm_pr_auc": pr_p,
                "perm_accuracy": float(eval_p["accuracy"]),
                "perm_balanced_accuracy": float(eval_p["balanced_accuracy"]),
                "perm_trusted_accuracy": float(eval_p["trusted_accuracy"]),
                "perm_drop_roc_auc": baseline_roc_auc - roc_p if not np.isnan(roc_p) else np.nan,
                "perm_drop_pr_auc": baseline_pr_auc - pr_p if not np.isnan(pr_p) else np.nan,
                "perm_drop_accuracy": baseline_acc - float(eval_p["accuracy"]),
                "perm_drop_balanced_accuracy": baseline_bacc - float(eval_p["balanced_accuracy"]),
                "perm_drop_trusted_accuracy": baseline_trusted - float(eval_p["trusted_accuracy"]),
            }
        )

    perm_df = pd.DataFrame(perm_rows)
    importance = importance.merge(perm_df, on="feature", how="left")

    # 给出一个“MLP+Permutation”合成排序：MLP 权重强度与性能下降幅度都归一化到 0~1
    mlp_max = float(importance["mlp_weight_abs_importance"].max())
    perm_drop_max = float(
        importance["perm_drop_balanced_accuracy"].max(skipna=True)
    )  # 可能全是 NaN
    mlp_norm = (
        importance["mlp_weight_abs_importance"] / mlp_max if mlp_max > 0 else 0.0
    )
    perm_drop_norm = (
        importance["perm_drop_balanced_accuracy"].fillna(0.0) / perm_drop_max
        if perm_drop_max > 0
        else 0.0
    )
    importance["combined_mlp_perm"] = 0.5 * mlp_norm + 0.5 * perm_drop_norm
    importance = importance.sort_values("combined_mlp_perm", ascending=False)

    # 输出：按 combined_mlp_perm 排序的综合重要性条形图
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    combined_bar_path = MODEL_DIR / "feature_importance_bar_combined.png"
    try:
        import matplotlib as _mpl
        import matplotlib.pyplot as _plt

        # 中文字体设置：保证中文特征名能显示
        import matplotlib.font_manager as _fm

        _cand_fonts = ["STZhongsong", "Microsoft YaHei", "SimHei", "Arial Unicode MS"]
        _picked = None
        for _f in _cand_fonts:
            try:
                _path = _fm.findfont(_f, fallback_to_default=False)
                if _path:
                    _picked = _f
                    break
            except Exception:
                continue
        if _picked is None:
            _picked = "SimHei"
        _mpl.rcParams["font.sans-serif"] = [_picked]
        _mpl.rcParams["axes.unicode_minus"] = False

        top_n = int(min(25, len(importance)))
        imp_top = importance.head(top_n).copy()
        name_zh2, _ = load_column_zh_map()
        labels = [
            f"{name_zh2.get(f, '').strip()}（{f}）" if name_zh2.get(f, "").strip() else str(f)
            for f in imp_top["feature"].tolist()
        ]
        vals = imp_top["combined_mlp_perm"].to_numpy(dtype=float)
        _plt.figure(figsize=(10, max(6, 0.35 * top_n + 1)))
        y = np.arange(top_n)[::-1]
        _plt.barh(y, vals[::-1], color="#1f77b4")
        _plt.yticks(y, labels[::-1])
        _plt.xlabel("combined_mlp_perm (MLP weight abs + Permutation)")
        _plt.title("Feature importance (sorted by combined_mlp_perm)")
        _plt.tight_layout()
        _plt.savefig(combined_bar_path, dpi=150, bbox_inches="tight")
        _plt.close()
        metrics["combined_mlp_importance_plot_bar"] = str(combined_bar_path)
    except Exception:
        pass

    return {
        "rf_pipeline": model_for_infer,
        "rf_base_pipeline": rf,
        "metrics": metrics,
        "importance": importance,
        "X_train": X_train,
        "X_test": X_eval,
        "y_test": y_eval,
        "y_proba_test": y_proba,
        "model_risk_tier_test": risk_test,
        "risk_quantiles_train": fixed_thresholds,
    }


def save_artifacts(result: dict) -> None:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    rf_path = MODEL_DIR / "rf_pipeline.joblib"
    joblib.dump(result["rf_pipeline"], rf_path)

    # 覆盖为“可容错封装版”：列对齐；缺失保持 NaN，不再用训练中位数填补
    feature_columns = list(result["X_train"].columns)
    uncertain_prior = float(result["metrics"].get("positive_rate_test", 0.05))
    rf_wrapped = StrokeProbaWrapper(
        base_model=result["rf_pipeline"],
        feature_columns=feature_columns,
        feature_medians=None,
        uncertain_prior=uncertain_prior,
    )
    joblib.dump(rf_wrapped, rf_path)

    meta = {
        "metrics": result["metrics"],
        "risk_quantiles_train": result["risk_quantiles_train"],
        "feature_columns": list(result["X_train"].columns),
        "uncertain_prior": uncertain_prior,
    }
    with open(MODEL_DIR / "training_meta.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    name_zh, name_note = load_column_zh_map()
    imp_zh = attach_zh_columns(result["importance"], name_zh, name_note)
    imp_zh.to_csv(
        MODEL_DIR / "feature_importance.csv", index=False, encoding="utf-8-sig"
    )

    zh_txt = MODEL_DIR / "指标与特征重要性说明.txt"
    zh_txt.write_text(
        "\n".join(
            [
                "【整体准确率 accuracy】",
                "  正确样本数 / 总样本数。阳性很少时，即使全预测为阴性，准确率也会很高，因此「单看准确率」容易误判模型好坏。",
                "",
                "【平衡准确率 balanced_accuracy】",
                "  (阳性召回率 + 阴性召回率) / 2，对两类更公平，适合不平衡数据。",
                "",
                "【可信准确率 trusted_accuracy】",
                "  accuracy 与 balanced_accuracy 的调和平均：2×acc×bacc/(acc+bacc)。",
                "  两类指标差距大时更偏向较低者，用于「单数字」汇报时比单独看 accuracy 更不易被多数类比例误导。",
                "",
                "【ROC-AUC / PR-AUC】",
                "  ROC-AUC 看排序能力；PR-AUC 在不平衡时往往比准确率更有参考价值。",
                "",
                "【combined_mlp_perm（MLP权重+Permutation 合成排序）】",
                "  将 MLP 权重绝对值重要度（mlp_weight_abs_importance）与排列重要性（perm_drop_balanced_accuracy）归一化后按 0.5:0.5 加权。",
                "  用于把“模型内部权重强度”和“打乱后的性能下降幅度”同时考虑进特征排序。",
                "",
                "【perm_drop_balanced_accuracy（排列重要性）】",
                "  在评估集上对该特征列做随机打乱，其它特征保持不变。",
                "  重算模型预测并计算 balanced_accuracy；drop 越大表示该特征越关键。",
                "",
                "【mlp_weight_abs_importance（MLP权重重要度）】",
                "  基于 3 层 MLP 的权重绝对值估计“从输入到输出”的路径贡献强度，并对每个输入特征求和。",
                "  该指标用于排序与特征筛选参考；不是因果结论。",
                "",
                "【rf_importance（对照）】",
                "  XGBoost gain 重要度（列名沿用 rf_importance），可与 MLP 权重重要度对照，不宜单独作为因果结论。",
                "",
                "【中文列】",
                "  来自 origin/merged_stroke_metabolism_列说明.csv；若变量名在表中没有，则中文含义为空。",
                "",
            ]
        ),
        encoding="utf-8",
    )

    # 测试集预测明细（便于复核风险档）
    out_pred = pd.DataFrame(
        {
            "y_true": result["y_test"].values,
            "stroke_proba": result["y_proba_test"],
            "model_risk_tier": result["model_risk_tier_test"],
        }
    )
    out_pred.to_csv(
        MODEL_DIR / "test_predictions.csv", index=False, encoding="utf-8-sig"
    )


def main():
    parser = argparse.ArgumentParser(description="脑卒中建模与MLP特征重要度")
    parser.add_argument(
        "--calibration",
        default="auto",
        choices=["auto", "sigmoid", "isotonic", "none"],
        help="概率校准方式：auto/sigmoid/isotonic/none",
    )
    args = parser.parse_args()

    print("加载数据…")
    X_train, y_train, X_test, y_test = load_train_test_xy()
    print(
        f"训练集样本: {len(y_train)}, 测试集样本: {len(y_test)}, "
        f"特征数: {X_train.shape[1]}, 训练集阳性率: {y_train.mean():.4f}, 测试集阳性率: {y_test.mean():.4f}"
    )

    print("训练 XGBoost + MLP 特征重要度（权重绝对值+Permutation）…")
    result = train_models(
        X_train,
        y_train,
        X_test,
        y_test,
        calibration_mode=args.calibration,
    )

    print("保存模型与结果…")
    save_artifacts(result)

    m = result["metrics"]
    print("\n=== 验证集指标 ===")
    print(f"准确率 accuracy: {m.get('accuracy', 0):.4f}（不平衡时易虚高，请结合 balanced_accuracy）")
    print(f"平衡准确率 balanced_accuracy: {m.get('balanced_accuracy', 0):.4f}")
    print(
        f"可信准确率 trusted_accuracy（acc 与 bacc 调和平均）: {m.get('trusted_accuracy', 0):.4f}"
    )
    print(f"ROC-AUC: {m['roc_auc']:.4f}")
    print(f"PR-AUC (average precision): {m['pr_auc']:.4f}")
    print(f"概率校准模式: {m.get('calibration_mode', 'auto')}")
    print(f"概率校准方法: {m.get('calibration_method', 'none')}")
    print(f"校准候选 Brier: {m.get('calibration_brier_candidates', {})}")
    print(
        f"验证集 F1 最优阈值 threshold_f1_val: {m.get('threshold_f1_val')}, "
        f"对应验证集 F1: {m.get('f1_val_at_threshold')}"
    )
    print(
        f"验证集 BA 最优阈值 threshold_ba_val: {m.get('threshold_ba_val')}, "
        f"对应验证集 BA: {m.get('ba_val_at_threshold')}"
    )
    cmp = m.get("threshold_compare_on_eval", {})
    if cmp:
        f1m = cmp.get("f1_threshold", {})
        bam = cmp.get("ba_threshold", {})
        print(
            "阈值对比（评估集）："
            f"F1阈值(acc={f1m.get('accuracy', 0):.4f}, bacc={f1m.get('balanced_accuracy', 0):.4f}, f1={f1m.get('f1', 0):.4f})；"
            f"BA阈值(acc={bam.get('accuracy', 0):.4f}, bacc={bam.get('balanced_accuracy', 0):.4f}, f1={bam.get('f1', 0):.4f})"
        )
    print("混淆矩阵:", m["confusion_matrix"])
    print("模型风险档（测试集）分布:", m.get("model_risk_tier_distribution_test"))
    print(f"\n已保存至: {MODEL_DIR}")
    print("  - rf_pipeline.joblib")
    print("  - training_meta.json")
    print("  - feature_importance.csv（含中文含义列）")
    print("  - 指标与特征重要性说明.txt")
    print("  - test_predictions.csv")
    if m.get("combined_mlp_importance_plot_bar"):
        print(f"  - {m['combined_mlp_importance_plot_bar']}")


if __name__ == "__main__":
    main()
