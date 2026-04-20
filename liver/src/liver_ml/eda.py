"""探索性分析：组间检验（Mann‑Whitney / χ²）与 Spearman 相关性热图。"""
from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from .matplotlib_zh import configure_matplotlib_chinese

configure_matplotlib_chinese()
import pandas as pd
import seaborn as sns
from scipy import stats


def _rank_biserial_r(n0: int, n1: int, u_stat: float) -> float:
    """Mann‑Whitney U 的 rank-biserial 效应量。"""
    return 1.0 - 2.0 * u_stat / (n0 * n1)


def run_eda(
    X: pd.DataFrame,
    y: pd.Series,
    numeric_cols: list[str],
    fig_dir: Path,
) -> pd.DataFrame:
    fig_dir.mkdir(parents=True, exist_ok=True)
    df = X.copy()
    df["_y"] = y.values

    rows = []
    for c in numeric_cols:
        if c not in df.columns:
            continue
        v = pd.to_numeric(df[c], errors="coerce")
        g0 = v[df["_y"] == 0].dropna()
        g1 = v[df["_y"] == 1].dropna()
        if len(g0) < 3 or len(g1) < 3:
            continue
        u_stat, p_mw = stats.mannwhitneyu(g0, g1, alternative="two-sided")
        r_rb = _rank_biserial_r(len(g0), len(g1), u_stat)
        rows.append(
            {
                "feature": c,
                "test": "mannwhitney",
                "statistic": u_stat,
                "p_value": p_mw,
                "median_0": g0.median(),
                "median_1": g1.median(),
                "effect_rank_biserial_r": r_rb,
                "cramers_v": np.nan,
            }
        )

    cat_cols = [c for c in df.columns if c != "_y" and str(df[c].dtype) in ("object", "string")]
    for c in cat_cols[:40]:
        ct = pd.crosstab(df[c].astype(str), df["_y"])
        if ct.shape[0] < 2 or ct.shape[1] < 2:
            continue
        chi2, p, dof, _ = stats.chi2_contingency(ct)
        n = ct.values.sum()
        cramers_v = np.sqrt(chi2 / (n * (min(ct.shape) - 1))) if n > 0 and min(ct.shape) > 1 else np.nan
        rows.append(
            {
                "feature": c,
                "test": "chi2",
                "statistic": chi2,
                "p_value": p,
                "median_0": np.nan,
                "median_1": np.nan,
                "effect_rank_biserial_r": np.nan,
                "cramers_v": cramers_v,
            }
        )

    tab = pd.DataFrame(rows)
    tab = tab.sort_values("p_value")
    report_dir = fig_dir.parent / "reports"
    report_dir.mkdir(parents=True, exist_ok=True)
    tab.to_csv(report_dir / "eda_group_tests.csv", index=False)

    num_for_corr = [c for c in numeric_cols if c in df.columns][:50]
    if len(num_for_corr) >= 3:
        sub = df[num_for_corr].apply(pd.to_numeric, errors="coerce")
        corr = sub.corr(method="spearman")
        plt.figure(figsize=(14, 12))
        sns.heatmap(corr, cmap="vlag", center=0, square=False)
        plt.title("Spearman 相关系数热图（数值特征）")
        plt.tight_layout()
        plt.savefig(fig_dir / "correlation_heatmap_spearman.png", dpi=150)
        plt.close()
        corr.to_csv(report_dir / "correlation_spearman_matrix.csv", encoding="utf-8-sig")

    plot_distribution_summary(X, y, numeric_cols, fig_dir)
    return tab


def plot_distribution_summary(
    X: pd.DataFrame,
    y: pd.Series,
    numeric_cols: list[str],
    fig_dir: Path,
    max_hist_features: int = 12,
) -> None:
    """数据分布概览：标签比例、缺失率、核心数值特征按结局分组的分布（直方图）。"""
    fig_dir.mkdir(parents=True, exist_ok=True)
    df = X.copy()
    df["_y"] = y.values

    fig, ax = plt.subplots(figsize=(5, 4))
    vc = pd.Series(y.values).value_counts().sort_index()
    ax.bar([str(i) for i in vc.index], vc.values, color=["steelblue", "coral"][: len(vc)])
    ax.set_xlabel("结局（0/1）")
    ax.set_ylabel("样本量")
    ax.set_title("标签分布（类别不平衡可见性）")
    fig.tight_layout()
    fig.savefig(fig_dir / "distribution_label_counts.png", dpi=150)
    plt.close(fig)

    miss = df.drop(columns=["_y"], errors="ignore").isna().mean().sort_values(ascending=False).head(30)
    fig, ax = plt.subplots(figsize=(8, 6))
    miss.plot(kind="barh", ax=ax, color="slategray")
    ax.set_xlabel("缺失比例")
    ax.set_title("缺失率 Top 30 列")
    fig.tight_layout()
    fig.savefig(fig_dir / "distribution_missingness_top30.png", dpi=150)
    plt.close(fig)

    num_ok = [c for c in numeric_cols if c in df.columns][:max_hist_features]
    if not num_ok:
        return
    ncols = 3
    nrows = int(np.ceil(len(num_ok) / ncols))
    fig, axes = plt.subplots(nrows, ncols, figsize=(11, 3.2 * nrows))
    axes = np.atleast_2d(axes)
    for i, col in enumerate(num_ok):
        r, c = divmod(i, ncols)
        ax = axes[r, c]
        v = pd.to_numeric(df[col], errors="coerce")
        for lab, color in [(0, "#4a90d9"), (1, "#e07a5f")]:
            sub = v[df["_y"] == lab].dropna()
            if len(sub) < 2:
                continue
            ax.hist(sub, bins=28, alpha=0.45, label=f"y={lab}", color=color, density=True)
        ax.set_title(col[:28], fontsize=9)
        ax.legend(fontsize=7)
    for j in range(len(num_ok), nrows * ncols):
        r, c = divmod(j, ncols)
        axes[r, c].axis("off")
    fig.suptitle("数值特征按结局分组的分布（密度直方图）", fontsize=12, y=1.01)
    fig.tight_layout()
    fig.savefig(fig_dir / "distribution_numeric_by_outcome.png", dpi=150, bbox_inches="tight")
    plt.close(fig)
