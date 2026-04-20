"""简易命令行：输入特征 → 风险等级、关键因子、建议。"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import shap

from .config import MODEL_DIR, NUMERIC_FEATURES, CATEGORICAL_FEATURES, PA_BINARY
from .preprocess import build_feature_matrix, feature_engineering, replace_sentinels
from .risk import clinical_flags, health_score_from_prob, personalized_advice, prob_to_tier
from .shap_tools import compute_tree_local_shap_topk


def predict_row(row_dict: dict, *, return_features_for_shap: bool = False):
    # 与训练一致：XGBoost 使用树管道（保留缺失值）
    preprocess = joblib.load(MODEL_DIR / "preprocess_tree_nan.joblib")
    model = joblib.load(MODEL_DIR / "xgb_model.joblib")
    df = pd.DataFrame([row_dict])
    df = replace_sentinels(df)
    df = feature_engineering(df)
    X, _, _ = build_feature_matrix(df, NUMERIC_FEATURES, CATEGORICAL_FEATURES, PA_BINARY)
    Xt = preprocess.transform(X)
    p = float(model.predict_proba(Xt)[0, 1])
    tier = prob_to_tier(p)
    flags = clinical_flags(pd.Series(row_dict))
    out = {"prob": p, "tier": tier, "clinical_flags": flags, "health_score": health_score_from_prob(p)}
    if return_features_for_shap:
        return out, {"X_for_shap": X, "preprocess": preprocess, "model": model}
    return out


def main():
    parser = argparse.ArgumentParser(description="肝病风险 CLI（需先运行训练生成模型）")
    parser.add_argument("--json", type=str, help="单行 JSON 特征（键与合并表列名一致）")
    parser.add_argument("--shap-topk", type=int, default=0, help="开启个体 SHAP 推荐：输出 TOP-K 特征（例如 5）；<=0 则不计算")
    args = parser.parse_args()

    if args.json:
        row = json.loads(args.json)
    else:
        print("交互模式：输入数值（留空则缺失）。结局为 CAP 定义的 NAFLD，预测勿填 CAP。示例：RIDAGEYR, RIAGENDR(1/2), BMXBMI, LBXSATSI, LBXGLU, LBXSTR, BMXWAIST ...")
        keys = [
            "RIDAGEYR",
            "RIAGENDR",
            "BMXBMI",
            "BMXWAIST",
            "BPXSY1",
            "BPXDI1",
            "LBXSATSI",
            "LBXSASSI",
            "LBXSGTSI",
            "LBXGLU",
            "LBXTR",
            "LBDHDD",
            "LBXGH",
            "ALQ111",
            "SMQ020",
        ]
        row = {}
        for k in keys:
            s = input(f"{k}: ").strip()
            if s:
                try:
                    row[k] = float(s)
                except ValueError:
                    row[k] = s

    if args.shap_topk > 0:
        out, explain_pack = predict_row(row, return_features_for_shap=True)
        X_for_shap = explain_pack["X_for_shap"]
        preprocess = explain_pack["preprocess"]
        model = explain_pack["model"]

        # 尽量使用训练阶段缓存的背景集；若不存在则退化为无背景解释器
        bg_path = MODEL_DIR / "shap_tree_background_t.joblib"
        if bg_path.exists():
            background_X_t = joblib.load(bg_path)
            explainer = shap.TreeExplainer(model, background_X_t)
        else:
            explainer = shap.TreeExplainer(model)

        feature_names = np.asarray(preprocess.get_feature_names_out())
        top_df = compute_tree_local_shap_topk(
            X=X_for_shap,
            preprocess=preprocess,
            explainer=explainer,
            feature_names_after_transform=feature_names,
            top_k=int(args.shap_topk),
            p_nafld=np.asarray([out["prob"]], dtype=float),
        )
        row0 = top_df.iloc[0]
        topk_list = []
        for r in range(1, int(args.shap_topk) + 1):
            f_raw = row0.get(f"top{r}_feature_raw", "")
            f_zh = row0.get(f"top{r}_feature_zh", "")
            f_shap = row0.get(f"top{r}_shap", np.nan)
            if not isinstance(f_raw, str) or f_raw == "":
                continue
            topk_list.append(
                {
                    "rank": r,
                    "feature_raw": f_raw,
                    "feature_zh": f_zh,
                    "shap": float(f_shap) if pd.notna(f_shap) else None,
                }
            )
        out["shap_topk"] = topk_list

    else:
        out = predict_row(row)

    print(json.dumps(out, ensure_ascii=False, indent=2))
    adv = []
    for k in ["LBXSATSI", "TyG", "BMXBMI", "BMXWAIST", "LBXSGTSI"]:
        if k in row and pd.notna(row.get(k)):
            adv.extend(personalized_advice(k, 1.0))
    if adv:
        print("建议（示意）：")
        for a in adv[:5]:
            print("-", a)


if __name__ == "__main__":
    main()
