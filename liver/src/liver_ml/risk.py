"""风险分层、高危亚型聚类、推荐文案。"""
from __future__ import annotations

import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler

from .config import MODEL_DIR, REPORT_DIR


def health_score_from_prob(p: float | np.ndarray) -> float | np.ndarray:
    """
    肝病健康评分（越高越健康）：
    health = (1 - P(NAFLD)) * 100
    """
    p_arr = np.asarray(p, dtype=float)
    score = (1.0 - p_arr) * 100.0
    score = np.clip(score, 0.0, 100.0)
    if np.isscalar(p):
        return float(score)
    return score


def prob_to_tier(p: float, low: float = 0.2, high: float = 0.6) -> str:
    if p < low:
        return "低风险"
    if p < high:
        return "中风险"
    return "高风险"


def clinical_flags(row: pd.Series) -> dict:
    """辅助临床阈值（示意，非诊断）。"""
    flags = {}
    alt = pd.to_numeric(row.get("LBXSATSI"), errors="coerce")
    if pd.notna(alt) and alt > 40:
        flags["ALT>40"] = True
    ggt = pd.to_numeric(row.get("LBXSGTSI"), errors="coerce")
    if pd.notna(ggt) and ggt > 51:
        flags["GGT>51"] = True
    return flags


def risk_method_prob(
    y_test: pd.Series,
    p_test: np.ndarray,
    low: float = 0.2,
    high: float = 0.6,
) -> pd.DataFrame:
    tiers = [prob_to_tier(p, low, high) for p in p_test]
    out = pd.DataFrame({"y_true": y_test.values, "prob": p_test, "tier": tiers})
    out["health_score"] = health_score_from_prob(p_test)
    out.to_csv(REPORT_DIR / "risk_tiers_probability_method.csv", index=False)
    return out


def kmeans_high_risk_subtypes(
    X: pd.DataFrame,
    p: np.ndarray,
    thr: float = 0.6,
    n_clusters: int = 3,
    seed: int = 42,
) -> pd.DataFrame:
    """对预测高危样本做 K-means 亚型。"""
    cols = [c for c in ["TyG", "LBXSATSI", "LBXSGTSI", "BMXBMI", "BMXWAIST", "TC_HDL_ratio", "BRI"] if c in X.columns]
    if len(cols) < 2:
        return pd.DataFrame()

    if len(X) != len(p):
        raise ValueError("X 与预测概率长度不一致")

    m = pd.Series(p >= thr, index=X.index)
    sub = X.loc[m, cols].apply(pd.to_numeric, errors="coerce")
    sub = sub.dropna(how="all")
    if len(sub) < n_clusters + 2:
        return pd.DataFrame()

    pp = pd.Series(p, index=X.index).loc[sub.index]
    Z = StandardScaler().fit_transform(sub.fillna(sub.median()))
    km = KMeans(n_clusters=n_clusters, random_state=seed, n_init=10)
    lab = km.fit_predict(Z)
    res = sub.copy()
    res["cluster"] = lab
    res["pred_prob"] = pp.values
    res.to_csv(REPORT_DIR / "high_risk_kmeans_clusters.csv", encoding="utf-8-sig")
    return res


RECOMMENDATIONS = {
    "TyG": "甘油三酯-葡萄糖指数偏高：建议控制精制碳水与含糖饮料，适度有氧运动，复查血脂与空腹血糖。",
    "LBXSATSI": "ALT 升高：避免饮酒与肝毒性药物，建议消化/肝病专科评估并复查肝功能。",
    "LBXSGTSI": "GGT 升高：需关注酒精摄入与代谢因素，建议戒酒或减少饮酒并随访。",
    "BMXBMI": "体重指数偏高：建议循序渐进减重（饮食+运动），目标为可持续的生活方式改变。",
    "TC_HDL_ratio": "总胆固醇/HDL 比值偏高：建议优化血脂谱，减少饱和脂肪并规律运动。",
    "BRI": "身体围度指数提示中心性肥胖风险：建议综合控制体重与腰围。",
    "BMXWAIST": "腰围偏大：中心性肥胖与代谢风险相关，建议腰围管理与全身运动。",
    "LBXGH": "糖化血红蛋白偏高：建议内分泌科随访，优化饮食与血糖监测。",
    "BPXSY1": "收缩压偏高：建议低盐饮食、规律运动，必要时心血管科评估。",
}


def personalized_advice(
    feature_name: str,
    shap_value: float,
    top_k: int = 3,
) -> list[str]:
    if shap_value <= 0:
        return []
    text = RECOMMENDATIONS.get(feature_name, f"{feature_name} 对模型风险贡献为正，建议结合临床复查相关指标。")
    return [text]


def compare_tier_methods(
    df_prob: pd.DataFrame,
    df_cluster: pd.DataFrame,
) -> None:
    summary = {
        "prob_method_distribution": df_prob["tier"].value_counts().to_dict() if len(df_prob) else {},
        "kmeans_high_risk_n": int(len(df_cluster)) if len(df_cluster) else 0,
        "note": "概率分层适用于全体；K-means 仅刻画预测高危人群的代谢/炎症特征亚型。",
    }
    (REPORT_DIR / "risk_methods_comparison.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
