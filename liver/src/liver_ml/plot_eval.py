"""ROC、可靠性曲线、温和校准与 LASSO 相关可视化。"""
from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score, roc_curve

from .matplotlib_zh import configure_matplotlib_chinese

configure_matplotlib_chinese()


def expected_calibration_error(y_true: np.ndarray, y_prob: np.ndarray, n_bins: int = 10) -> float:
    """分箱期望校准误差（ECE），越小越好。"""
    y_true = np.asarray(y_true).astype(int)
    y_prob = np.asarray(y_prob).astype(float)
    bins = np.linspace(0.0, 1.0, n_bins + 1)
    ece = 0.0
    n = len(y_true)
    if n == 0:
        return float("nan")
    for i in range(n_bins):
        m = (y_prob >= bins[i]) & (y_prob < bins[i + 1]) if i < n_bins - 1 else (y_prob >= bins[i]) & (y_prob <= bins[i + 1])
        if not np.any(m):
            continue
        conf = float(np.mean(y_prob[m]))
        acc = float(np.mean(y_true[m]))
        ece += np.sum(m) / n * abs(acc - conf)
    return float(ece)


def confidence_bucket_table(y_true: np.ndarray, y_prob: np.ndarray, n_bins: int = 10) -> pd.DataFrame:
    """按预测概率分箱：样本数、正例率、平均概率（置信度诊断）。"""
    y_true = np.asarray(y_true).astype(int)
    y_prob = np.asarray(y_prob).astype(float)
    qs = np.quantile(y_prob, np.linspace(0, 1, n_bins + 1))
    qs[0] = 0.0
    qs[-1] = 1.0
    rows = []
    for i in range(n_bins):
        lo, hi = qs[i], qs[i + 1]
        if i == n_bins - 1:
            m = (y_prob >= lo) & (y_prob <= hi)
        else:
            m = (y_prob >= lo) & (y_prob < hi)
        if not np.any(m):
            rows.append({"bin": i + 1, "prob_low": lo, "prob_high": hi, "n": 0, "positives": 0, "rate": np.nan, "mean_prob": np.nan})
            continue
        rows.append(
            {
                "bin": i + 1,
                "prob_low": float(lo),
                "prob_high": float(hi),
                "n": int(np.sum(m)),
                "positives": int(np.sum(y_true[m])),
                "rate": float(np.mean(y_true[m])),
                "mean_prob": float(np.mean(y_prob[m])),
            }
        )
    return pd.DataFrame(rows)


def fit_platt_on_logits(y_true: np.ndarray, y_prob: np.ndarray) -> LogisticRegression:
    eps = 1e-6
    p = np.clip(np.asarray(y_prob, dtype=float), eps, 1.0 - eps)
    logits = np.log(p / (1.0 - p)).reshape(-1, 1)
    lr = LogisticRegression(max_iter=2000, class_weight="balanced")
    lr.fit(logits, np.asarray(y_true).astype(int))
    return lr


def apply_platt(lr: LogisticRegression, y_prob: np.ndarray) -> np.ndarray:
    eps = 1e-6
    p = np.clip(np.asarray(y_prob, dtype=float), eps, 1.0 - eps)
    logits = np.log(p / (1.0 - p)).reshape(-1, 1)
    return lr.predict_proba(logits)[:, 1].astype(float)


def blend_with_platt(y_val: np.ndarray, p_val: np.ndarray, p_apply: np.ndarray, mix: float) -> tuple[np.ndarray, LogisticRegression]:
    """在验证集上拟合 Platt，再对任意概率做凸组合：温和校准（mix 越小越接近原始）。"""
    mix = float(np.clip(mix, 0.0, 1.0))
    lr = fit_platt_on_logits(y_val, p_val)
    p_platt = apply_platt(lr, p_apply)
    out = (1.0 - mix) * np.asarray(p_apply, dtype=float) + mix * p_platt
    return np.clip(out, 1e-6, 1.0 - 1e-6), lr


def plot_roc_curve(
    y_true: np.ndarray,
    y_score: np.ndarray,
    out_path: Path,
    title: str,
    label: str | None = None,
) -> None:
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    y_true = np.asarray(y_true).astype(int)
    y_score = np.asarray(y_score).astype(float)
    fig, ax = plt.subplots(figsize=(6, 5))
    if len(np.unique(y_true)) < 2:
        ax.text(0.5, 0.5, "单一类别，无法绘制 ROC", ha="center", va="center", transform=ax.transAxes)
    else:
        fpr, tpr, _ = roc_curve(y_true, y_score)
        auc_v = roc_auc_score(y_true, y_score)
        lab = label or "模型"
        ax.plot(fpr, tpr, lw=2, label=f"{lab}（AUC={auc_v:.3f}）")
        ax.plot([0, 1], [0, 1], "k--", lw=1, alpha=0.5, label="随机")
        ax.legend(loc="lower right", fontsize=9)
    ax.set_xlabel("假阳性率（1-特异度）")
    ax.set_ylabel("真阳性率（灵敏度）")
    ax.set_title(title)
    ax.set_xlim(-0.02, 1.02)
    ax.set_ylim(-0.02, 1.02)
    ax.grid(True, alpha=0.3)
    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close(fig)


def plot_roc_curves_multi(
    curves: list[tuple[str, np.ndarray, np.ndarray]],
    out_path: Path,
    title: str,
) -> None:
    """多条 ROC（同一测试集上多个模型；各元组为名称、y_true、y_score）。"""
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    fig, ax = plt.subplots(figsize=(7, 6))
    ax.plot([0, 1], [0, 1], "k--", lw=1, alpha=0.5, label="随机")
    for name, y_true, y_score in curves:
        y_true = np.asarray(y_true).astype(int)
        y_score = np.asarray(y_score).astype(float)
        if len(np.unique(y_true)) < 2:
            continue
        fpr, tpr, _ = roc_curve(y_true, y_score)
        auc_v = roc_auc_score(y_true, y_score)
        ax.plot(fpr, tpr, lw=2, label=f"{name}（AUC={auc_v:.3f}）")
    ax.set_xlabel("假阳性率（1-特异度）")
    ax.set_ylabel("真阳性率（灵敏度）")
    ax.set_title(title)
    ax.legend(loc="lower right", fontsize=8)
    ax.set_xlim(-0.02, 1.02)
    ax.set_ylim(-0.02, 1.02)
    ax.grid(True, alpha=0.3)
    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close(fig)


def plot_reliability_diagram(
    y_true: np.ndarray,
    y_prob: np.ndarray,
    out_path: Path,
    title: str,
    n_bins: int = 10,
) -> None:
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    y_true = np.asarray(y_true).astype(int)
    y_prob = np.clip(np.asarray(y_prob).astype(float), 1e-6, 1.0 - 1e-6)
    bins = np.linspace(0.0, 1.0, n_bins + 1)
    centers = 0.5 * (bins[:-1] + bins[1:])
    accs, confs, counts = [], [], []
    for i in range(n_bins):
        if i < n_bins - 1:
            m = (y_prob >= bins[i]) & (y_prob < bins[i + 1])
        else:
            m = (y_prob >= bins[i]) & (y_prob <= bins[i + 1])
        counts.append(int(np.sum(m)))
        if np.any(m):
            accs.append(float(np.mean(y_true[m])))
            confs.append(float(np.mean(y_prob[m])))
        else:
            accs.append(np.nan)
            confs.append(np.nan)
    fig, ax = plt.subplots(figsize=(5.5, 5))
    ax.plot([0, 1], [0, 1], "k--", alpha=0.5, label="完美校准")
    w = np.array(counts, dtype=float)
    w = w / max(np.sum(w), 1)
    ax.scatter(confs, accs, s=np.maximum(w * 2000, 8), alpha=0.75, label="分箱（点大小∝样本占比）")
    ax.plot(
        [c for c in confs if not np.isnan(c)],
        [a for a in accs if not np.isnan(a)],
        alpha=0.5,
    )
    ax.set_xlabel("平均预测概率（置信度）")
    ax.set_ylabel("实际正例比例")
    ax.set_title(title + f"\nECE≈{expected_calibration_error(y_true, y_prob, n_bins=n_bins):.4f}")
    ax.legend(loc="upper left", fontsize=8)
    ax.set_xlim(-0.02, 1.02)
    ax.set_ylim(-0.02, 1.02)
    ax.grid(True, alpha=0.3)
    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close(fig)


def plot_lasso_cv_curve(lr_cv: LogisticRegression, out_path: Path) -> None:
    """LogisticRegressionCV（L1）交叉验证得分随 C 变化（LASSO 路径上的模型选择）。"""
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    Cs = np.asarray(lr_cv.Cs_)
    raw_scores = lr_cv.scores_
    if isinstance(raw_scores, dict):
        # 二分类 LogisticRegressionCV 常见结构：{class_label: (n_folds, n_Cs)}
        if 1 in raw_scores:
            scores = np.asarray(raw_scores[1], dtype=float)
        else:
            first_key = next(iter(raw_scores))
            scores = np.asarray(raw_scores[first_key], dtype=float)
    else:
        scores = np.asarray(raw_scores, dtype=float)
    while scores.ndim > 2:
        scores = scores.mean(axis=0)
    if scores.ndim != 2:
        raise ValueError(f"Unexpected shape for LogisticRegressionCV.scores_: {scores.shape}")
    mean_s = scores.mean(axis=0)
    std_s = scores.std(axis=0)
    fig, ax = plt.subplots(figsize=(7, 5))
    x = np.log10(Cs)
    ax.plot(x, mean_s, "o-", lw=2, markersize=4, label="各折平均")
    ax.fill_between(x, mean_s - std_s, mean_s + std_s, alpha=0.2)
    c_sel = float(np.ravel(lr_cv.C_)[0])
    ax.axvline(np.log10(c_sel), color="crimson", ls="--", lw=1.5, label=f"选定 C={c_sel:.4g}")
    ax.set_xlabel("log10(C)（C 越大正则越弱）")
    ax.set_ylabel("交叉验证 ROC-AUC")
    ax.set_title("LASSO（L1 逻辑回归）交叉验证曲线\n（最小绝对收缩和选择算子，模型选择）")
    ax.legend(loc="best", fontsize=9)
    ax.grid(True, alpha=0.3)
    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close(fig)


def plot_logistic_l1_coefficient_path(
    X: np.ndarray,
    y: np.ndarray,
    feature_names: np.ndarray,
    out_path: Path,
    C_values: np.ndarray | None = None,
    max_features_plot: int = 25,
    random_state: int = 42,
) -> None:
    """L1 逻辑回归在不同 C 下的系数轨迹（展示变量随正则强度收缩/入选）。"""
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    y = np.asarray(y).astype(int)
    if C_values is None:
        C_values = np.logspace(-3, 1, 28)
    coefs: list[np.ndarray] = []
    for C in C_values:
        clf = LogisticRegression(
            penalty="l1",
            C=float(C),
            solver="saga",
            class_weight="balanced",
            max_iter=4000,
            random_state=random_state,
        )
        clf.fit(X, y)
        coefs.append(clf.coef_.ravel())
    coef_mat = np.stack(coefs, axis=1)
    imp = np.max(np.abs(coef_mat), axis=1)
    order = np.argsort(-imp)[:max_features_plot]
    fig, ax = plt.subplots(figsize=(8, 6))
    inv_c = 1.0 / C_values
    for j in order:
        ax.plot(np.log10(inv_c), coef_mat[j, :], lw=1.2, label=str(feature_names[j])[:40])
    ax.set_xlabel("log10(1/C)（越大正则越强，系数更易收缩为 0）")
    ax.set_ylabel("系数（变换后特征空间）")
    ax.set_title("LASSO（L1）逻辑回归：变量系数随正则强度变化\n（最小绝对收缩和选择算子）")
    ax.axhline(0.0, color="k", lw=0.5, alpha=0.4)
    ax.legend(loc="center left", bbox_to_anchor=(1.02, 0.5), fontsize=7, ncol=1)
    ax.grid(True, alpha=0.3)
    fig.tight_layout()
    fig.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close(fig)
