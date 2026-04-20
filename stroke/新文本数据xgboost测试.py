# -*- coding: utf-8 -*-
"""
脑卒中模型预测测试

目标：
- 使用 `models/stroke/rf_pipeline.joblib`（训练脚本为 新文本数据xgboost.py，主模型为 XGBoost，文件名沿用 rf_pipeline）
- 输出脑卒中（target=1）的概率；缺列/缺失值保持 NaN，不对特征做训练中位数填补
- 若一行全部未填（全 NaN），封装内将脑卒中（正类）概率置为 0（不采用先验）
- 从 balanced_train_stroke.csv 抽样真实阳性/阴性行（30 维对齐），对比「原始」与「仅微调年龄/BMI」的预测概率
- 交互预测：按 `feature_importance.csv` 全部特征、重要性从高到低逐项输入（非仅前 N 个）
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd

from 新文本数据xgboost import StrokeProbaWrapper


ROOT = Path(__file__).resolve().parent
MODEL_DIR = ROOT / "models" / "stroke"
TRAIN_CSV = ROOT / "origin" / "balanced_train_stroke.csv"
FEATURE_IMPORTANCE_CSV = MODEL_DIR / "feature_importance.csv"

RF_MODEL_PATH = MODEL_DIR / "rf_pipeline.joblib"
META_PATH = MODEL_DIR / "training_meta.json"

LABEL_COL = "target_stroke"


def load_meta(meta_path: Path) -> dict[str, Any]:
    with meta_path.open("r", encoding="utf-8") as f:
        return json.load(f)


def load_model(model_kind: str = "rf"):
    """主模型文件名为 rf_pipeline.joblib，与训练脚本一致；model_kind 的 xgb/main 与 rf 同义。"""
    if model_kind in ("rf", "xgb", "main"):
        model_path = RF_MODEL_PATH
    else:
        raise ValueError("model_kind 仅支持 'rf' / 'xgb' / 'main'（主模型）")

    if not model_path.is_file():
        raise FileNotFoundError(f"未找到模型文件：{model_path}")
    return joblib.load(model_path)


def align_features_no_impute(
    df: pd.DataFrame,
    feature_columns: list[str],
) -> pd.DataFrame:
    """与训练特征列对齐；缺失列/缺失值保持为 NaN，不做中位数或常数填充。"""
    out = df.reindex(columns=feature_columns)
    out = out.apply(pd.to_numeric, errors="coerce")
    out = out.replace([np.inf, -np.inf], np.nan)
    return out.astype(float)


def proba_to_tier(p: np.ndarray, qs: list[float]) -> np.ndarray:
    """与 新文本数据xgboost.py 中固定分档一致：用 >= 比较阈值。"""
    t = np.ones(len(p), dtype=int)
    if len(qs) >= 1:
        t[p >= qs[0]] = 2
    if len(qs) >= 2:
        t[p >= qs[1]] = 3
    if len(qs) >= 3:
        t[p >= qs[2]] = 4
    return t


def predict_proba_from_features(
    model,
    df_features: pd.DataFrame,
    feature_columns: list[str],
    risk_quantiles_train: list[float] | None = None,
) -> pd.DataFrame:
    if getattr(model, "is_tolerant_model", False):
        proba = model.predict_proba(df_features)[:, 1]
    else:
        X = align_features_no_impute(df_features, feature_columns)
        proba = model.predict_proba(X)[:, 1]

    out = pd.DataFrame({"stroke_proba": proba})
    if risk_quantiles_train:
        out["model_risk_tier"] = proba_to_tier(proba, risk_quantiles_train).astype(int)
    return out


def local_importance_by_nan_drop(
    *,
    model,
    X_one_aligned: pd.DataFrame,
    feature_columns: list[str],
    base_proba: float,
    risk_quantiles_train: list[float] | None = None,
    top_k: int = 10,
    name_zh: dict[str, str] | None = None,
) -> pd.DataFrame:
    """
    局部重要性（针对“本次输入”）：
    对本次输入中“非缺失”的每个特征，分别将该列置为 NaN（不填补），重新预测，
    以 |Δp| = |p_base - p_drop| 衡量该特征对当前样本预测概率的影响强度。
    """
    if X_one_aligned.shape[0] != 1:
        raise ValueError("X_one_aligned 必须为单行 DataFrame。")

    X0 = align_features_no_impute(X_one_aligned, feature_columns)
    filled = X0.notna().iloc[0]
    filled_features = [c for c in feature_columns if bool(filled.get(c, False))]
    if not filled_features:
        return pd.DataFrame(
            columns=[
                "feature",
                "中文含义",
                "value",
                "p_base",
                "p_drop_to_nan",
                "delta_p",
                "abs_delta_p",
            ]
        )

    rows: list[dict[str, Any]] = []
    for f in filled_features:
        Xd = X0.copy()
        Xd.loc[:, f] = np.nan
        p_drop = float(
            predict_proba_from_features(
                model=model,
                df_features=Xd,
                feature_columns=feature_columns,
                risk_quantiles_train=risk_quantiles_train,
            )["stroke_proba"].iloc[0]
        )
        delta = float(base_proba - p_drop)
        rows.append(
            {
                "feature": f,
                "中文含义": (name_zh or {}).get(f, ""),
                "value": float(X0[f].iloc[0]) if pd.notna(X0[f].iloc[0]) else np.nan,
                "p_base": float(base_proba),
                "p_drop_to_nan": float(p_drop),
                "delta_p": delta,
                "abs_delta_p": abs(delta),
            }
        )

    out = pd.DataFrame(rows).sort_values("abs_delta_p", ascending=False)
    return out.head(int(max(1, min(top_k, len(out))))) if len(out) else out


def _apply_age_bmi_delta(
    X: pd.DataFrame,
    d_age: float = 0.0,
    d_bmi: float = 0.0,
) -> pd.DataFrame:
    """在单行特征表上仅改 RIDAGEYR / BMXBMI（若存在且非 NaN）。"""
    out = X.copy()
    if "RIDAGEYR" in out.columns and pd.notna(out["RIDAGEYR"].iloc[0]) and d_age != 0.0:
        out["RIDAGEYR"] = float(
            np.clip(float(out["RIDAGEYR"].iloc[0]) + d_age, 18.0, 99.0)
        )
    if "BMXBMI" in out.columns and pd.notna(out["BMXBMI"].iloc[0]) and d_bmi != 0.0:
        out["BMXBMI"] = float(
            np.clip(float(out["BMXBMI"].iloc[0]) + d_bmi, 12.0, 70.0)
        )
    return out


def run_trainset_ablation_demo(
    df: pd.DataFrame,
    model,
    feature_columns: list[str],
    risk_quantiles_train: list[float] | None,
    *,
    n_each: int = 3,
    random_state: int = 42,
) -> None:
    """
    从平衡训练集抽取真实阳性/阴性行，30 维与模型对齐；报告：
    - 原始行脑卒中概率
    - 仅年龄 +15 岁（RIDAGEYR）
    - 仅 BMI +5（BMXBMI）
    用于与「手填交互」对照，分布与训练一致。
    """
    if LABEL_COL not in df.columns:
        print("\n=== 训练集真实行对比（跳过：无 target_stroke 列）===")
        return

    sub = df[df[LABEL_COL].notna()].copy()
    if sub.empty:
        print("\n=== 训练集真实行对比（跳过：标签全空）===")
        return

    yv = sub[LABEL_COL].astype(int)
    pos_ix = sub.index[yv == 1].to_numpy()
    neg_ix = sub.index[yv == 0].to_numpy()

    rng = np.random.RandomState(random_state)

    def _pick(ix: np.ndarray) -> np.ndarray:
        if len(ix) == 0:
            return np.array([], dtype=int)
        k = min(n_each, len(ix))
        return rng.choice(ix, size=k, replace=len(ix) < n_each)

    pos_pick = _pick(pos_ix)
    neg_pick = _pick(neg_ix)

    rows_out: list[dict[str, Any]] = []

    def _one_block(name: str, indices: np.ndarray) -> None:
        for idx in indices:
            y_true = int(sub.loc[idx, LABEL_COL])
            X0 = align_features_no_impute(sub.loc[[idx]], feature_columns)
            pr0 = predict_proba_from_features(
                model=model,
                df_features=X0,
                feature_columns=feature_columns,
                risk_quantiles_train=risk_quantiles_train,
            )
            p0 = float(pr0["stroke_proba"].iloc[0])
            X_age = _apply_age_bmi_delta(X0, d_age=15.0, d_bmi=0.0)
            pa = float(
                predict_proba_from_features(
                    model=model,
                    df_features=X_age,
                    feature_columns=feature_columns,
                    risk_quantiles_train=risk_quantiles_train,
                )["stroke_proba"].iloc[0]
            )
            X_bmi = _apply_age_bmi_delta(X0, d_age=0.0, d_bmi=5.0)
            pb = float(
                predict_proba_from_features(
                    model=model,
                    df_features=X_bmi,
                    feature_columns=feature_columns,
                    risk_quantiles_train=risk_quantiles_train,
                )["stroke_proba"].iloc[0]
            )
            rows_out.append(
                {
                    "组别": name,
                    "csv行索引": int(idx),
                    "target_stroke": y_true,
                    "p_原始": p0,
                    "p_仅年龄+15": pa,
                    "p_仅BMI+5": pb,
                }
            )

    print("\n=== 训练集真实行对比（30 维对齐；抽样可复现 random_state=%d）===" % random_state)
    print(
        "说明：从 balanced_train_stroke 各抽若干阳性/阴性真实行；"
        "在保持其余特征不变下，仅把 RIDAGEYR +15 或 BMXBMI +5，观察概率变化。"
    )
    if len(pos_pick) == 0:
        print("（无阳性样本，跳过阳性组。）")
    else:
        _one_block("阳性", pos_pick)
    if len(neg_pick) == 0:
        print("（无阴性样本，跳过阴性组。）")
    else:
        _one_block("阴性", neg_pick)

    if not rows_out:
        print("无可用样本，未输出表格。")
        return

    demo_df = pd.DataFrame(rows_out)
    print(demo_df.to_string(index=False))
    demo_path = MODEL_DIR / "trainset_ablation_demo.csv"
    try:
        demo_df.to_csv(demo_path, index=False, encoding="utf-8-sig")
        print(f"\n已保存：{demo_path}")
    except Exception:
        pass


def main() -> None:
    if not TRAIN_CSV.is_file():
        raise FileNotFoundError(f"未找到训练集 CSV：{TRAIN_CSV}")
    if not META_PATH.is_file():
        raise FileNotFoundError(f"未找到训练元数据：{META_PATH}")

    meta = load_meta(META_PATH)
    feature_columns = list(meta.get("feature_columns", []))
    if not feature_columns:
        raise RuntimeError("training_meta.json 中未找到 feature_columns")

    risk_quantiles_train = meta.get("risk_quantiles_train", None)
    uncertain_prior = float(
        meta.get("uncertain_prior")
        or meta.get("metrics", {}).get("positive_rate_test", 0.05)
    )

    # 加载主模型（XGBoost pipeline，文件仍为 rf_pipeline.joblib）：若未封装容错则封装后写回
    model = load_model("rf")

    df = pd.read_csv(TRAIN_CSV, low_memory=False)

    if not getattr(model, "is_tolerant_model", False):
        wrapped = StrokeProbaWrapper(
            base_model=model,
            feature_columns=feature_columns,
            feature_medians=None,
            uncertain_prior=uncertain_prior,
        )
        joblib.dump(wrapped, RF_MODEL_PATH)
        model = wrapped
    elif getattr(model, "uncertain_prior", None) is None:
        # 旧版封装对象未保存先验，运行时补上
        model.uncertain_prior = uncertain_prior

    wc = getattr(model, "_tolerant_feature_columns", None)
    if wc is not None and list(wc) != list(feature_columns):
        print(
            "警告：training_meta.json 的 feature_columns 与模型内保存的特征列不一致，"
            "交互输入可能对不齐列名，预测会异常；请重新训练并保存模型或同步 meta。"
        )

    # 对整个训练集预测
    pred = predict_proba_from_features(
        model=model,
        df_features=df,
        feature_columns=feature_columns,
        risk_quantiles_train=risk_quantiles_train,
    )

    head_n = min(10, len(df))
    preview_dict: dict[str, Any] = {
        "stroke_proba": pred["stroke_proba"].iloc[:head_n].values,
    }
    if "model_risk_tier" in pred.columns:
        preview_dict["model_risk_tier"] = pred["model_risk_tier"].iloc[:head_n].values
    if LABEL_COL in df.columns:
        preview_dict["target_stroke"] = df[LABEL_COL].iloc[:head_n].values

    preview = pd.DataFrame(preview_dict)

    print("=== 模型预测：脑卒中概率（target=1）===")
    print(f"特征列数（训练集对齐后）：{len(feature_columns)}")
    print(
        "stroke_proba: "
        f"mean={pred['stroke_proba'].mean():.6f}, "
        f"min={pred['stroke_proba'].min():.6f}, "
        f"max={pred['stroke_proba'].max():.6f}"
    )
    print("前几行预测：")
    print(preview.to_string(index=False))

    # 演示：删掉部分特征列 + 部分置空缺失值，直接预测仍能正常输出
    sample_row = df.iloc[0].to_dict()
    missing_keys = ["CHOL", "ALQ121", "SLQ_duration"]
    for k in missing_keys:
        sample_row.pop(k, None)
    set_nan_keys = ["BMXBMI"]
    for k in set_nan_keys:
        if k in sample_row:
            sample_row[k] = None

    sample_df = pd.DataFrame([sample_row])
    sample_pred = predict_proba_from_features(
        model=model,
        df_features=sample_df,
        feature_columns=feature_columns,
        risk_quantiles_train=risk_quantiles_train,
    )
    print("\n=== 演示：部分/缺失特征输入也能预测 ===")
    print(sample_pred.to_string(index=False))

    # 演示：交互时全部回车（不填任何特征）— 全列为 NaN，不填补；全缺失时正类概率为 0
    empty_all = predict_proba_from_features(
        model=model,
        df_features=pd.DataFrame([{}]),
        feature_columns=feature_columns,
        risk_quantiles_train=risk_quantiles_train,
    )
    print("\n=== 演示：全部不填（全缺失，NaN，不填补）仍预测 ===")
    print(
        "说明：缺失保持 NaN；若整行全缺失，封装将脑卒中概率置为 0（非先验、非中位数填补）。"
    )
    print(empty_all.to_string(index=False))

    run_trainset_ablation_demo(
        df=df,
        model=model,
        feature_columns=feature_columns,
        risk_quantiles_train=risk_quantiles_train,
        n_each=3,
        random_state=42,
    )

    # 输出到文件
    out_path = MODEL_DIR / "trainset_pred_proba.csv"
    pred_out = pred.copy()
    if LABEL_COL in df.columns:
        pred_out[LABEL_COL] = df[LABEL_COL].values
    pred_out.to_csv(out_path, index=False, encoding="utf-8-sig")
    print(f"\n已保存预测结果：{out_path}")

    # 交互式：按 feature_importance.csv 中「全部特征」、重要性从高到低逐项输入并预测
    if not FEATURE_IMPORTANCE_CSV.is_file():
        print("\n未找到 feature_importance.csv，跳过交互输入预测。")
        return

    fi = pd.read_csv(FEATURE_IMPORTANCE_CSV, encoding="utf-8-sig")
    if "feature" not in fi.columns:
        print("\nfeature_importance.csv 列结构异常，跳过交互输入预测。")
        return

    # 兼容新旧版本：
    # - 新版：combined_mlp_perm（MLP权重 + Permutation）
    # - 旧版：combined_shap_perm / combined_importance / shap_mean_abs（仅 SHAP）
    if "combined_mlp_perm" in fi.columns:
        sort_col = "combined_mlp_perm"
    elif "combined_shap_perm" in fi.columns:
        sort_col = "combined_shap_perm"
    elif "combined_importance" in fi.columns:
        sort_col = "combined_importance"
    elif "shap_mean_abs" in fi.columns:
        sort_col = "shap_mean_abs"
    else:
        print("\nfeature_importance.csv 缺少可排序的重要性列，跳过交互输入预测。")
        return
    rows_sorted = (
        fi.sort_values(by=sort_col, ascending=False)
        .drop_duplicates(subset=["feature"], keep="first")
        .reset_index(drop=True)
    )
    n_prompt = len(rows_sorted)
    name_zh_map = (
        rows_sorted.set_index("feature")["中文含义"].dropna().astype(str).to_dict()
        if "中文含义" in rows_sorted.columns
        else {}
    )

    # 基于训练集生成“如何输入”的提示：
    # - 少量离散取值（且近似整数）=> 提示按编码输入（显示训练集中出现过的取值）
    # - 连续型 => 提示大致范围（1%~99% 分位）与中位数，帮助判断量纲
    KNOWN_CODE_MEANINGS: dict[str, dict[float, str]] = {
        # 来自 文本数据预处理1.py 的合并逻辑
        "CHOL": {1.0: "高胆固醇", 2.0: "正常", 7.0: "拒绝", 9.0: "不知道"},
        # 常见人口学编码
        "RIAGENDR": {1.0: "男", 2.0: "女"},
    }

    def _train_hint_for_feature(col: str) -> str:
        if col not in df.columns:
            return "（训练集中缺少该列；可回车，缺失保持 NaN，不作填补）"
        s = pd.to_numeric(df[col], errors="coerce").dropna()
        if s.empty:
            return "（该列在训练集中全缺失/不可用，可回车）"

        uniq = np.sort(pd.unique(s.values))
        nuniq = len(uniq)
        is_int_like = bool(np.all(np.isclose(uniq, np.round(uniq))))
        if nuniq <= 10 and is_int_like:
            allowed = ", ".join(str(int(round(x))) for x in uniq.tolist())
            mapping = KNOWN_CODE_MEANINGS.get(col, {})
            if mapping:
                parts = []
                for x in uniq.tolist():
                    txt = mapping.get(float(x))
                    if txt:
                        parts.append(f"{int(round(x))}={txt}")
                if parts:
                    return f"（训练集取值：{allowed}；含义：{'，'.join(parts)}）"
            return f"（训练集取值：{allowed}；按编码输入；不知道可回车，缺失为 NaN、不填补）"

        q01 = float(s.quantile(0.01))
        q99 = float(s.quantile(0.99))
        med = float(s.median())
        return f"（连续值；训练参考：中位数≈{med:.3g}，常见范围≈[{q01:.3g}, {q99:.3g}]）"

    print("\n=== 交互输入：按 feature_importance.csv 全部特征、重要性从高到低预测 ===")
    print(
        f"共 {n_prompt} 个特征（排序列：{sort_col}），提示顺序为重要性降序；"
        "若与当前模型 feature_columns 不一致的项将自动跳过。\n"
        "回车表示该项缺失：对应特征为 NaN，不会用训练中位数或其它值填补后再预测。\n"
        "连续型特征请输入数字（如 110 或 3.2）；分类/编码特征请输入对应的数字编码（如 1/2/7/9）。\n"
        "若全部回车，则等价于「全不填」，仍可得到预测（全缺失时见上文演示）。"
    )
    if not sys.stdin.isatty():
        print("\n检测到非交互环境（stdin 不是终端），已跳过交互输入。")
        return

    go = input("是否开始输入？(回车=是 / 输入 n 跳过)：").strip().lower()
    if go in {"n", "no", "skip"}:
        print("已跳过交互输入。")
        return

    sample_row: dict[str, Any] = {}
    for idx_loop, (_, r) in enumerate(rows_sorted.iterrows(), start=1):
        feat = str(r["feature"]).strip()
        if feat not in feature_columns:
            print(
                f"[{idx_loop}/{n_prompt}] 跳过「{feat}」：不在当前模型 feature_columns 中。"
            )
            continue
        cn = str(r.get("中文含义", "")).strip()
        val_note = str(r.get("特征值说明_中文", "")).strip()
        val_note_ok = bool(val_note) and val_note != "nan"
        train_hint = _train_hint_for_feature(feat)

        # 过滤掉你不想要的“连续型实验室结果/单位与含义见/缺失多为未测/不适用”这类通用说明
        # 只在它看起来像“编码/可取值格式”（例如包含 `1=... 2=... 7=... 9=...`）时才展示。
        if val_note_ok:
            bad_markers = [
                "连续型实验室结果",
                "单位与含义见",
                "缺失多为未测",
                "缺失多为未测/不适用",
                "缺失多为未测/不适用",
            ]
            if any(m in val_note for m in bad_markers):
                val_note = ""
                val_note_ok = False
            # 如果不是编码形式（通常含 `=`），也不展示
            elif "=" not in val_note:
                val_note = ""
                val_note_ok = False

        # 避免提示过长，做一个适度截断
        if val_note and val_note != "nan" and len(val_note) > 80:
            val_note = val_note[:77] + "..."

        prefix = f"[{idx_loop}/{n_prompt}] "
        if cn and cn != "nan":
            if val_note_ok:
                prompt = prefix + f"请输入 {feat}（{cn}；{val_note}）的值{train_hint}："
            else:
                prompt = prefix + f"请输入 {feat}（{cn}）的值{train_hint}，不知道请回车："
        else:
            if val_note_ok:
                prompt = prefix + f"请输入 {feat}（{val_note}）的值{train_hint}："
            else:
                prompt = prefix + f"请输入 {feat} 的值{train_hint}，不知道请回车："

        s = input(prompt).strip()
        if s == "" or s.lower() in {"nan", "none", "null"}:
            continue
        try:
            sample_row[feat] = float(s)
        except ValueError:
            if val_note_ok:
                print(
                    f"输入 '{s}' 无法转换为数字，将视为缺失。"
                    f"该特征提示可取值/编码为：{val_note}"
                )
            else:
                print(f"输入 '{s}' 无法转换为数字，将视为缺失。该特征需要连续数值（如 4.2）。")

    if not sample_row:
        print("\n（未输入任何特征：全部按缺失 NaN 处理，不使用训练中位数填补。）")

    X_one = align_features_no_impute(pd.DataFrame([sample_row]), feature_columns)
    n_filled = int(X_one.notna().sum(axis=1).iloc[0])
    print(
        f"\n（诊断）对齐训练特征列后，本行非缺失特征数：{n_filled} / {len(feature_columns)}。"
        "若你填了多项但此处仍很少，说明列名与模型不一致或输入被跳过。"
    )

    # 与训练封装一致：DataFrame 行对齐特征列，缺失为 NaN；支持「全不填」sample_row == {}
    pred_one_df = predict_proba_from_features(
        model=model,
        df_features=pd.DataFrame([sample_row]),
        feature_columns=feature_columns,
        risk_quantiles_train=risk_quantiles_train,
    )
    stroke_proba = float(pred_one_df["stroke_proba"].iloc[0])
    risk_tier = None
    if "model_risk_tier" in pred_one_df.columns:
        risk_tier = int(pred_one_df["model_risk_tier"].iloc[0])

    print("\n=== 预测结果 ===")
    print(f"脑卒中概率（target=1）：{stroke_proba:.6f}")

    # 本次输入的“局部重要性”：对已填写的特征逐个置为 NaN，看概率变化幅度
    local_imp = local_importance_by_nan_drop(
        model=model,
        X_one_aligned=X_one,
        feature_columns=feature_columns,
        base_proba=stroke_proba,
        risk_quantiles_train=risk_quantiles_train,
        top_k=10,
        name_zh=name_zh_map,
    )
    if len(local_imp):
        print("\n=== 本次输入：局部重要性 Top10（将单个特征置 NaN 的 |Δp|）===")
        show_cols = [c for c in ["feature", "中文含义", "value", "p_drop_to_nan", "delta_p", "abs_delta_p"] if c in local_imp.columns]
        print(local_imp[show_cols].to_string(index=False))
        try:
            out_local = MODEL_DIR / "local_importance_last_input.csv"
            local_imp.to_csv(out_local, index=False, encoding="utf-8-sig")
            print(f"\n已保存：{out_local}")
        except Exception:
            pass
    else:
        print("\n=== 本次输入：局部重要性 ===")
        print("未填写任何特征，无法计算局部重要性。")

    if risk_tier is not None:
        print(f"模型风险档（1~4）：{risk_tier}")
        if risk_quantiles_train and len(risk_quantiles_train) >= 3:
            q = risk_quantiles_train
            print(
                f"  分档规则（与训练脚本一致）："
                f"p < {q[0]:.2f} → 档1；{q[0]:.2f}≤p < {q[1]:.2f} → 档2；"
                f"{q[1]:.2f}≤p < {q[2]:.2f} → 档3；p ≥ {q[2]:.2f} → 档4。"
            )
            if stroke_proba < q[0]:
                print(
                    "  说明：当前概率低于第一档阈值，故风险档为 1。"
                    "若自填值看起来「很异常」但概率仍低，常见原因：① 仍有大量特征为缺失（见上方非缺失计数），"
                    "树模型多走缺失分支；② 连续型化验误填成 1/2 等，与训练时真实量纲不符，不等于「临床高危编码」；"
                    "③ 模型输出的是「脑卒中史」概率，与其它心血管病「是/否」并不一一对应。"
                )


if __name__ == "__main__":
    main()

