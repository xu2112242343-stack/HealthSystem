"""分类指标：含灵敏度、特异度、Brier、AUC 的 bootstrap 置信区间。"""
from __future__ import annotations

import numpy as np
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    brier_score_loss,
    confusion_matrix,
    f1_score,
    roc_auc_score,
)


def auc_bootstrap_ci(
    y_true,
    y_prob,
    n_boot: int = 200,
    random_state: int = 42,
    alpha: float = 0.05,
) -> tuple[float, float]:
    """ROC‑AUC 的 bootstrap 95% CI（百分位法）。"""
    rng = np.random.RandomState(random_state)
    y_true = np.asarray(y_true).astype(int)
    y_prob = np.asarray(y_prob).astype(float)
    n = len(y_true)
    aucs = []
    for _ in range(n_boot):
        idx = rng.randint(0, n, size=n)
        yt = y_true[idx]
        yp = y_prob[idx]
        if len(np.unique(yt)) < 2:
            continue
        aucs.append(roc_auc_score(yt, yp))
    if not aucs:
        return np.nan, np.nan
    lo = np.quantile(aucs, alpha / 2)
    hi = np.quantile(aucs, 1 - alpha / 2)
    return float(lo), float(hi)


def classification_metrics(y_true, y_prob, threshold: float = 0.5, auc_ci: bool = False) -> dict:
    y_true = np.asarray(y_true).astype(int)
    y_prob = np.asarray(y_prob).astype(float)
    y_pred = (y_prob >= threshold).astype(int)
    tn, fp, fn, tp = confusion_matrix(y_true, y_pred, labels=[0, 1]).ravel()
    sens = tp / (tp + fn) if (tp + fn) > 0 else np.nan
    spec = tn / (tn + fp) if (tn + fp) > 0 else np.nan
    auc_val = roc_auc_score(y_true, y_prob) if len(np.unique(y_true)) > 1 else np.nan
    out = {
        "auc": auc_val,
        "ap": average_precision_score(y_true, y_prob) if len(np.unique(y_true)) > 1 else np.nan,
        "accuracy": accuracy_score(y_true, y_pred),
        "sensitivity": sens,
        "specificity": spec,
        "f1": f1_score(y_true, y_pred, zero_division=0),
        "brier": brier_score_loss(y_true, y_prob),
    }
    if auc_ci and len(np.unique(y_true)) > 1 and len(y_true) >= 20:
        lo, hi = auc_bootstrap_ci(y_true, y_prob)
        out["auc_ci_low"] = lo
        out["auc_ci_high"] = hi
    else:
        out["auc_ci_low"] = np.nan
        out["auc_ci_high"] = np.nan
    return out
