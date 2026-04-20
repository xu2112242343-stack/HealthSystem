"""SHAP 全局与局部解释。"""
from __future__ import annotations

import matplotlib

matplotlib.use("Agg")
import joblib
import matplotlib.pyplot as plt
import numpy as np

from .matplotlib_zh import configure_matplotlib_chinese

configure_matplotlib_chinese()
import pandas as pd
import shap
from sklearn.linear_model import LogisticRegression

from .config import MODEL_DIR, REPORT_DIR
from .feature_display import prettify_feature_name, prettify_feature_names


def run_shap_summary(
    X_sample: pd.DataFrame,
    preprocess,
    model,
    feature_names_after_transform: np.ndarray | None = None,
    max_samples: int = 800,
    output_tag: str = "",
    write_top10_text: bool = True,
) -> pd.Series:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    suffix = f"_{output_tag}" if output_tag else ""
    rng = np.random.RandomState(42)
    if len(X_sample) > max_samples:
        idx = rng.choice(len(X_sample), max_samples, replace=False)
        X_sample = X_sample.iloc[idx]

    X_t = preprocess.transform(X_sample)
    if hasattr(X_t, "toarray"):
        X_t = X_t.toarray()
    X_t = np.asarray(X_t, dtype=np.float64)

    if feature_names_after_transform is None:
        feature_names_after_transform = np.asarray(preprocess.get_feature_names_out())

    explainer = shap.TreeExplainer(model)
    shap_values = explainer.shap_values(X_t)

    if isinstance(shap_values, list):
        shap_values = shap_values[1]

    fn_list = feature_names_after_transform.tolist()[: X_t.shape[1]]
    fn_show = [prettify_feature_name(str(x)) for x in fn_list]
    mean_abs = np.abs(shap_values).mean(axis=0)
    importance = pd.Series(mean_abs, index=fn_list)
    importance = importance.sort_values(ascending=False)
    disp = prettify_feature_names(importance.index.tolist())
    pd.DataFrame(
        {
            "feature_raw": importance.index,
            "feature_display_zh": disp,
            "mean_abs_shap": importance.values,
        }
    ).to_csv(
        REPORT_DIR / f"shap_global_importance{suffix}.csv",
        index=False,
        encoding="utf-8-sig",
    )

    def _fallback_barh(series: pd.Series, path: str):
        plt.figure(figsize=(10, 8))
        sub = series.head(20)
        # 横轴用中文名
        labels = [prettify_feature_name(str(x)) for x in sub.index][::-1]
        plt.barh(labels, sub.values[::-1])
        plt.xlabel("mean |SHAP|")
        plt.tight_layout()
        plt.savefig(path, dpi=150, bbox_inches="tight")
        plt.close()

    try:
        shap.summary_plot(shap_values, X_t, feature_names=fn_show, show=False, max_display=20)
        plt.tight_layout()
        plt.savefig(REPORT_DIR / f"shap_summary_bar{suffix}.png", dpi=150, bbox_inches="tight")
        plt.close()
    except Exception as e:
        plt.close()
        _fallback_barh(importance, str(REPORT_DIR / f"shap_summary_bar{suffix}.png"))
        (REPORT_DIR / f"shap_plot_note{suffix}.txt").write_text(f"summary_plot 回退: {e}", encoding="utf-8")

    try:
        shap.summary_plot(shap_values, X_t, feature_names=fn_show, plot_type="dot", show=False, max_display=20)
        plt.tight_layout()
        plt.savefig(REPORT_DIR / f"shap_summary_dot{suffix}.png", dpi=150, bbox_inches="tight")
        plt.close()
    except Exception as e:
        plt.close()
        _fallback_barh(importance, str(REPORT_DIR / f"shap_summary_dot{suffix}.png"))
        (REPORT_DIR / f"shap_plot_note_dot{suffix}.txt").write_text(f"dot 回退: {e}", encoding="utf-8")

    top3 = importance.head(3).index.tolist()
    name_to_j = {n: i for i, n in enumerate(fn_list)}
    for i, fname in enumerate(top3):
        try:
            j = name_to_j.get(fname, 0)
            shap.dependence_plot(j, shap_values, X_t, feature_names=fn_show, show=False)
            plt.tight_layout()
            plt.savefig(REPORT_DIR / f"shap_dependence_{i}{suffix}.png", dpi=150, bbox_inches="tight")
            plt.close()
        except Exception:
            plt.close()
            continue

    if write_top10_text:
        top10 = importance.head(10)
        hints = {
            "num__RIDAGEYR": "年龄：随年龄增长，慢性病与自述肝病风险可能上升。",
            "num__LUXSMED": "肝脏硬度（FibroScan）：升高提示纤维化风险，与肝病负担相关。",
            "num__INDFMPIR": "贫困收入比：社会经济因素与就医、代谢风险相关。",
            "num__BMXHT": "身高：体格协变量，常与其他人体测量共同作用。",
            "num__LBXNEPCT": "中性粒细胞比例：炎症/感染背景可能与全身状态相关。",
            "num__BMXWAIST": "腰围：中心性肥胖与 NAFLD/代谢综合征密切相关。",
            "num__LBDLYMNO": "淋巴细胞绝对值：免疫状态指标。",
            "cat__RIAGENDR_1.0": "性别（男）：与肝病流行病学差异相关。",
            "num__LBXSAPSI": "碱性磷酸酶：胆汁淤积或骨代谢因素需结合临床。",
            "num__LBXSTR": "甘油三酯：与 TyG、代谢性脂肪肝路径一致。",
            "num__BPXSY1": "收缩压：心血管代谢共病背景。",
            "num__ALT_AST_ratio": "ALT/AST：急性肝损伤或酒精性模式时比值变化有提示意义。",
            "num__LBXSASSI": "AST：肝细胞损伤指标。",
            "num__LBXSUA": "尿酸：与代谢综合征、胰岛素抵抗相关。",
            "num__LBXSATSI": "ALT：肝细胞损伤/脂肪肝常用实验室指标。",
            "num__TyG": "TyG 指数：胰岛素抵抗与代谢风险的替代指标。",
        }
        lines = ["=== Top10 特征（|SHAP| 均值）与解读 ===\n"]
        for feat, val in top10.items():
            pretty = prettify_feature_name(str(feat))
            lines.append(f"- {pretty} ({feat}): {val:.4f}")
            lines.append(f"  {hints.get(feat, '结合临床与其他指标综合解读。')}\n")
        (REPORT_DIR / f"top10_features_interpretation{suffix}.txt").write_text("\n".join(lines), encoding="utf-8")

    return importance


def load_and_explain(X_holdout: pd.DataFrame):
    preprocess = joblib.load(MODEL_DIR / "preprocess_tree_nan.joblib")
    model = joblib.load(MODEL_DIR / "xgb_model.joblib")
    fn = np.asarray(preprocess.get_feature_names_out())
    return run_shap_summary(X_holdout, preprocess, model, fn)


def _coerce_shap_values_for_positive_class(shap_values) -> np.ndarray:
    """
    统一把二分类 SHAP 转成形如 (n_samples, n_features) 的 ndarray。
    """
    if isinstance(shap_values, list):
        # 常见：list[0], list[1] 分别对应不同类别的贡献
        shap_values = shap_values[1]
    return np.asarray(shap_values)


def fit_tree_explainer_on_training(
    *,
    X_train: pd.DataFrame,
    preprocess,
    model,
    max_background: int = 200,
    random_state: int = 42,
) -> tuple[shap.TreeExplainer, np.ndarray]:
    """
    在训练集（X_train）上拟合 SHAP 解释器（TreeExplainer）。
    返回：
      1) explainer
      2) 背景集的变换后矩阵 background_X_t（可用于部署端复用）
    """
    X_bg = X_train
    if len(X_bg) > max_background:
        rng = np.random.RandomState(random_state)
        idx = rng.choice(len(X_bg), max_background, replace=False)
        X_bg = X_bg.iloc[idx]

    X_t = preprocess.transform(X_bg)
    if hasattr(X_t, "toarray"):
        X_t = X_t.toarray()
    X_t = np.asarray(X_t, dtype=np.float64)

    # TreeExplainer 对树模型通常不强依赖 background；这里按需求显式使用训练集背景。
    explainer = shap.TreeExplainer(model, X_t)
    return explainer, X_t


def compute_tree_local_shap_topk(
    *,
    X: pd.DataFrame,
    preprocess,
    explainer: shap.TreeExplainer,
    feature_names_after_transform: np.ndarray | None = None,
    top_k: int = 5,
    y_true: np.ndarray | None = None,
    p_nafld: np.ndarray | None = None,
) -> pd.DataFrame:
    """
    对每个样本计算本地 SHAP 值，并抽取 TOP-K（按 |SHAP| 排序）。
    """
    X_t = preprocess.transform(X)
    if hasattr(X_t, "toarray"):
        X_t = X_t.toarray()
    X_t = np.asarray(X_t, dtype=np.float64)

    if feature_names_after_transform is None:
        feature_names_after_transform = np.asarray(preprocess.get_feature_names_out())
    feature_names_after_transform = np.asarray(feature_names_after_transform, dtype=object)

    shap_values = explainer.shap_values(X_t)
    shap_values = _coerce_shap_values_for_positive_class(shap_values)

    n_samples, n_features = shap_values.shape
    top_k_eff = int(min(max(top_k, 1), n_features))

    # 先排序得到每行的 top-k 特征索引
    idx_sorted = np.argsort(np.abs(shap_values), axis=1)[:, ::-1]
    top_idx = idx_sorted[:, :top_k_eff]

    # 预先准备中文化特征名映射
    pretty_map = {str(raw): prettify_feature_name(str(raw)) for raw in feature_names_after_transform}

    base = {
        "row_index": X.index.astype(str).to_numpy(),
        "n_features": np.full(n_samples, n_features, dtype=int),
    }
    if y_true is not None:
        y_true_arr = np.asarray(y_true).reshape(-1)
        base["y_true"] = y_true_arr
    if p_nafld is not None:
        p_arr = np.asarray(p_nafld, dtype=float).reshape(-1)
        base["p_nafld"] = p_arr

    out = pd.DataFrame(base)
    for rank in range(top_k_eff):
        feat_idx = top_idx[:, rank]
        shap_rank_vals = shap_values[np.arange(n_samples), feat_idx]
        feat_raw = feature_names_after_transform[feat_idx]
        feat_pretty = [pretty_map.get(str(fr), str(fr)) for fr in feat_raw]
        out[f"top{rank+1}_feature_raw"] = feat_raw.astype(str)
        out[f"top{rank+1}_feature_zh"] = feat_pretty
        out[f"top{rank+1}_shap"] = shap_rank_vals.astype(float)

    # 若 top_k>n_features，补齐空列便于下游固定表头
    for rank in range(top_k_eff, int(top_k)):
        out[f"top{rank+1}_feature_raw"] = ""
        out[f"top{rank+1}_feature_zh"] = ""
        out[f"top{rank+1}_shap"] = np.nan

    return out


def compute_logreg_local_shap_like_topk(
    *,
    model: LogisticRegression,
    X_meta: np.ndarray,
    feature_names: list[str],
    background_X_meta: np.ndarray | None = None,
    top_k: int = 5,
) -> pd.DataFrame:
    """
    融合端（LogisticRegression 元学习器）本地解释：用线性模型的“SHAP-like”分解
    - baseline 取背景集均值
    - 每个特征的贡献 ~ coef_j * (x_j - baseline_j)

    注意：该实现用于可解释的特征排序与方向判断；输出并非严格复现 shap 包对概率输出的标定。
    """
    X_meta = np.asarray(X_meta, dtype=float)
    if X_meta.ndim != 2:
        raise ValueError("X_meta 必须是二维矩阵")

    coef = np.asarray(model.coef_, dtype=float).reshape(-1)
    if len(coef) != X_meta.shape[1]:
        raise ValueError(f"coef 长度 {len(coef)} 与 X_meta 特征数 {X_meta.shape[1]} 不一致")

    if background_X_meta is None:
        baseline = X_meta.mean(axis=0)
    else:
        baseline = np.asarray(background_X_meta, dtype=float).mean(axis=0)

    shap_like = (X_meta - baseline[None, :]) * coef[None, :]
    n_samples, n_features = shap_like.shape
    top_k_eff = int(min(max(top_k, 1), n_features))

    idx_sorted = np.argsort(np.abs(shap_like), axis=1)[:, ::-1]
    top_idx = idx_sorted[:, :top_k_eff]

    out = pd.DataFrame(
        {
            "row_index": np.arange(n_samples).astype(int),
            "n_features": np.full(n_samples, n_features, dtype=int),
        }
    )
    for rank in range(top_k_eff):
        feat_idx = top_idx[:, rank]
        shap_rank_vals = shap_like[np.arange(n_samples), feat_idx]
        feat_raw = [feature_names[i] for i in feat_idx]
        out[f"top{rank+1}_feature_raw"] = np.asarray(feat_raw, dtype=str)
        out[f"top{rank+1}_feature_zh"] = np.asarray(feat_raw, dtype=str)
        out[f"top{rank+1}_shap"] = shap_rank_vals.astype(float)

    for rank in range(top_k_eff, int(top_k)):
        out[f"top{rank+1}_feature_raw"] = ""
        out[f"top{rank+1}_feature_zh"] = ""
        out[f"top{rank+1}_shap"] = np.nan

    return out
