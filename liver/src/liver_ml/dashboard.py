"""Plotly 交互式 HTML 仪表板：风险分布、指标对比、SHAP 重要性（静态条形）。"""
from __future__ import annotations

from pathlib import Path

import pandas as pd
import plotly.graph_objects as go
from plotly.subplots import make_subplots

from .config import FIG_DIR, OUTPUT_DIR, REPORT_DIR


def build_dashboard_html():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    FIG_DIR.mkdir(parents=True, exist_ok=True)

    imp_path = REPORT_DIR / "shap_global_importance.csv"
    tier_path = REPORT_DIR / "risk_tiers_probability_method.csv"

    fig = make_subplots(
        rows=2,
        cols=2,
        subplot_titles=("测试集预测概率分布", "SHAP 全局重要性 Top15", "风险等级计数", "说明"),
        specs=[[{"type": "histogram"}, {"type": "bar"}], [{"type": "bar"}, {"type": "table"}]],
    )

    if tier_path.exists():
        t = pd.read_csv(tier_path)
        fig.add_trace(
            go.Histogram(x=t["prob"], nbinsx=30, name="prob"),
            row=1,
            col=1,
        )
        vc = t["tier"].value_counts()
        fig.add_trace(
            go.Bar(x=vc.index.astype(str), y=vc.values, name="tier"),
            row=2,
            col=1,
        )

    if imp_path.exists():
        imp = pd.read_csv(imp_path)
        if "mean_abs_shap" in imp.columns:
            imp = imp.sort_values("mean_abs_shap", ascending=False).head(15)
            ycol = "feature_display_zh" if "feature_display_zh" in imp.columns else (
                "feature_raw" if "feature_raw" in imp.columns else "feature"
            )
            fig.add_trace(
                go.Bar(
                    x=imp["mean_abs_shap"].values,
                    y=imp[ycol].astype(str),
                    orientation="h",
                    name="|SHAP|",
                ),
                row=1,
                col=2,
            )

    fig.add_trace(
        go.Table(
            header=dict(values=["项目", "说明"]),
            cells=dict(
                values=[
                    ["数据来源", "标签", "风险分层", "SHAP"],
                    [
                        "merged_liver_research + merged_stroke_metabolism（HDL/ALQ 等）",
                        "NAFLD：CAP 中位数 ≥248 dB/m；MCQ 仅作敏感度分析",
                        "p<0.2 低；0.2–0.6 中；≥0.6 高（可改阈值）",
                        "基于 XGBoost（树管道）与 TreeExplainer",
                    ],
                ]
            ),
        ),
        row=2,
        col=2,
    )

    fig.update_layout(height=900, showlegend=False, title_text="肝病风险分析仪表板（示意）")
    out = FIG_DIR / "dashboard.html"
    fig.write_html(out)
    return out


if __name__ == "__main__":
    p = build_dashboard_html()
    print("已写入:", p)
