"""
多模态后融合：表格模型（NHANES 上训练的树模型）与图像模型概率在患者级拼接与集成。

- 结局统一：CAP ≥ 248 为阳性（与 config.CAP_NAFLD_THRESHOLD 一致）。
- 划分：按患者 ID 分组的分层 K 折，避免同一患者泄露。
- 融合：简单平均、网格搜索加权、乘积归一化、Stacking（逻辑回归，强正则防过拟合）。
- 可选：在折内训练集上拟合 Platt / 等渗回归校准后再融合。
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import joblib
import numpy as np
import pandas as pd
import torch
from PIL import Image
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import f1_score
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import StratifiedGroupKFold

from .config import (
    CAP_NAFLD_THRESHOLD,
    CATEGORICAL_FEATURES,
    MODEL_DIR,
    NUMERIC_FEATURES,
    PA_BINARY,
    RANDOM_STATE,
    ROOT,
)
from .image_train import build_model, build_transforms
from .metrics_tools import classification_metrics
from .plot_eval import apply_platt, fit_platt_on_logits
from .preprocess import build_feature_matrix, feature_engineering, replace_sentinels
from .risk import health_score_from_prob
from .shap_tools import compute_logreg_local_shap_like_topk

MergeValidPaths = tuple[Path, Path, Path]


def default_merge_valid_paths(root: Path | None = None) -> MergeValidPaths:
    root = root or ROOT
    base = root / "data" / "merge_valid"
    return base / "Demo_data.csv", base / "image_Data", root / "outputs" / "reports" / "multimodal"


def demo_row_to_nhanes_frame(demo: pd.DataFrame) -> pd.DataFrame:
    """将 merge_valid 的 Demo_data 列名映射为与训练一致的 NHANES 风格列名（lite 特征集）。"""
    out = pd.DataFrame(index=demo.index)
    out["patient_id"] = demo["Patient ID"].astype(str).str.strip()

    sex = demo["sex"].astype(str).str.upper().str.strip()
    out["RIAGENDR"] = np.where(sex.str.startswith("M"), 1.0, np.where(sex.str.startswith("F"), 2.0, np.nan))

    out["RIDAGEYR"] = pd.to_numeric(demo["Age"], errors="coerce")
    out["BMXHT"] = pd.to_numeric(demo["Height"], errors="coerce")
    out["BMXWT"] = pd.to_numeric(demo["Weight"], errors="coerce")
    out["BMXBMI"] = pd.to_numeric(demo["BMI"], errors="coerce")
    out["BMXWAIST"] = pd.to_numeric(demo["waist"], errors="coerce")
    out["LBXGLU"] = pd.to_numeric(demo["Fasting Blood sugar"], errors="coerce")
    out["LBXSATSI"] = pd.to_numeric(demo["ALT (SGPT)"], errors="coerce")
    out["LBXSASSI"] = pd.to_numeric(demo["AST (SGOT)"], errors="coerce")
    out["LBXSGTSI"] = pd.to_numeric(demo["GGT"], errors="coerce")
    out["LBXSTB"] = pd.to_numeric(demo["Bilirubin total"], errors="coerce")
    out["LBXSAL"] = pd.to_numeric(demo["Albumin"], errors="coerce")
    out["LBXGH"] = pd.to_numeric(demo["HbA1c"], errors="coerce")
    out["LBDHDD"] = pd.to_numeric(demo["HDL"], errors="coerce")
    out["LBXTR"] = pd.to_numeric(demo["Triglyceride"], errors="coerce")
    out["LBDLDL"] = pd.to_numeric(demo["LDL"], errors="coerce")
    out["LBXSUA"] = pd.to_numeric(demo["Uric Acid"], errors="coerce")
    out["LBXSCH"] = pd.to_numeric(demo["Cholestrol"], errors="coerce")
    # 与 NHANES 衍生特征一致；无实验室 SI 列时占位为 NaN，避免 feature_engineering 中 Series/标量混用
    out["LBDSALSI"] = np.nan
    out["LBDSGBSI"] = np.nan
    out["LBDHCI"] = np.nan
    # 问卷列在 Demo 中常缺失；树管道中保留为 NaN
    out["ALQ111"] = np.nan
    out["SMQ020"] = np.nan
    out["BPXSY1"] = np.nan
    out["BPXDI1"] = np.nan

    cap = pd.to_numeric(demo["CAP score"], errors="coerce")
    out["cap_score"] = cap
    out["y_cap"] = np.where(cap >= CAP_NAFLD_THRESHOLD, 1, np.where(cap.notna() & (cap >= 0), 0, np.nan))
    return out


def collect_patient_image_paths(image_root: Path, patient_ids: set[str]) -> dict[str, list[Path]]:
    """每个患者目录下收集常见超声文件名（不区分大小写）。"""
    names = {"image.jpg", "image1.jpg", "image.jpeg", "image1.jpeg", "image.png", "image1.png"}
    result: dict[str, list[Path]] = {pid: [] for pid in patient_ids}
    image_root = Path(image_root)
    if not image_root.is_dir():
        return result
    for pid in patient_ids:
        folder = image_root / pid
        if not folder.is_dir():
            continue
        for p in sorted(folder.iterdir()):
            if not p.is_file():
                continue
            if p.name.lower() in names or p.suffix.lower() in {".jpg", ".jpeg", ".png"}:
                result[pid].append(p)
        # 去重、稳定排序
        result[pid] = sorted(set(result[pid]), key=lambda x: x.name.lower())
    return result


def fan_geometry_mask(image: Image.Image, top_strip: float = 0.12) -> Image.Image:
    """先去顶部文字条，再保留中下部扇形几何区域。"""
    arr = np.asarray(image.convert("RGB"), dtype=np.uint8)
    h, w = arr.shape[:2]
    y0 = int(round(h * float(np.clip(top_strip, 0.0, 0.35))))
    yy, xx = np.mgrid[0:h, 0:w]
    cx = w / 2.0
    cy = y0 - 0.10 * h
    dx = xx - cx
    dy = yy - cy
    r = np.sqrt(dx * dx + dy * dy)
    theta = np.abs(np.arctan2(dx, dy + 1e-6))
    m = (theta < np.deg2rad(34.0)) & (r > 0.05 * h) & (r < 1.15 * h) & (yy >= y0)
    out = np.zeros_like(arr)
    out[m] = arr[m]
    return Image.fromarray(out)


@torch.no_grad()
def image_probs_per_patient(
    checkpoint_path: Path,
    patient_to_paths: dict[str, list[Path]],
    patient_order: list[str],
    device: str | None = None,
    image_preprocess: Literal["baseline", "fan_geom"] = "baseline",
    fan_top_strip: float = 0.12,
) -> np.ndarray:
    """对患者多张图取预测概率的算术平均（患者级）。"""
    checkpoint_path = Path(checkpoint_path)
    checkpoint = torch.load(checkpoint_path, map_location="cpu")
    model_name = checkpoint["model_name"]
    image_size = int(checkpoint.get("image_size", 224))
    device = device or ("cuda" if torch.cuda.is_available() else "cpu")

    model = build_model(model_name).to(device)
    model.load_state_dict(checkpoint["state_dict"])
    model.eval()
    _, eval_tf = build_transforms(image_size)

    probs = []
    for pid in patient_order:
        paths = patient_to_paths.get(pid, [])
        if not paths:
            probs.append(np.nan)
            continue
        slice_probs = []
        for img_path in paths:
            image = Image.open(img_path).convert("RGB")
            if image_preprocess == "fan_geom":
                image = fan_geometry_mask(image, top_strip=fan_top_strip)
            tensor = eval_tf(image).unsqueeze(0).to(device)
            p = float(torch.sigmoid(model(tensor).reshape(-1)).cpu().item())
            slice_probs.append(p)
        probs.append(float(np.mean(slice_probs)))
    return np.asarray(probs, dtype=float)


def tabular_probs_batch(mapped_df: pd.DataFrame, preprocess, model) -> np.ndarray:
    """对映射后的特征表批量输出表格模型阳性概率。"""
    df = mapped_df.copy()
    df = replace_sentinels(df)
    df = feature_engineering(df)
    X, _, _ = build_feature_matrix(df, NUMERIC_FEATURES, CATEGORICAL_FEATURES, PA_BINARY)
    Xt = preprocess.transform(X)
    return model.predict_proba(Xt)[:, 1].astype(float)


def product_fusion_normalized(p_tab: np.ndarray, p_img: np.ndarray) -> np.ndarray:
    """乘积融合并归一化：等价于独立假设下的后验 odds 乘积。"""
    p_tab = np.clip(np.asarray(p_tab, dtype=float), 1e-6, 1.0 - 1e-6)
    p_img = np.clip(np.asarray(p_img, dtype=float), 1e-6, 1.0 - 1e-6)
    num = p_tab * p_img
    den = num + (1.0 - p_tab) * (1.0 - p_img)
    return num / np.maximum(den, 1e-12)


def grid_best_weight(p_tab: np.ndarray, p_img: np.ndarray, y: np.ndarray, n_grid: int = 201) -> float:
    """在训练索引上搜索使 AUC 最大的 w：w*P_tab + (1-w)*P_img。"""
    m = np.isfinite(p_tab) & np.isfinite(p_img)
    if np.sum(m) < 3:
        return 0.5
    pt, pi, yy = p_tab[m], p_img[m], y[m]
    if len(np.unique(yy)) < 2:
        return 0.5
    best_w, best_auc = 0.5, -1.0
    for w in np.linspace(0.0, 1.0, n_grid):
        fused = w * pt + (1.0 - w) * pi
        auc = roc_auc_score(yy, fused)
        if auc > best_auc:
            best_auc, best_w = auc, float(w)
    return best_w


def calibrate_probs(
    y_train: np.ndarray,
    p_train: np.ndarray,
    p_apply: np.ndarray,
    method: Literal["none", "platt", "isotonic"],
) -> np.ndarray:
    if method == "none":
        return np.asarray(p_apply, dtype=float)
    m = np.isfinite(p_train) & np.isfinite(y_train)
    if np.sum(m) < 8:
        return np.asarray(p_apply, dtype=float)
    y_t = y_train[m].astype(int)
    p_t = np.clip(p_train[m].astype(float), 1e-6, 1.0 - 1e-6)
    p_a = np.asarray(p_apply, dtype=float)
    out = p_a.copy()
    mask_apply = np.isfinite(p_a)
    if method == "platt":
        lr = fit_platt_on_logits(y_t, p_t)
        out[mask_apply] = apply_platt(lr, p_a[mask_apply])
    elif method == "isotonic":
        iso = IsotonicRegression(out_of_bounds="clip")
        iso.fit(p_t, y_t)
        out[mask_apply] = iso.predict(p_a[mask_apply])
    return np.clip(out, 1e-6, 1.0 - 1e-6)


def _auc_safe(y: np.ndarray, p: np.ndarray) -> float:
    m = np.isfinite(p)
    if np.sum(m) < 2 or len(np.unique(y[m])) < 2:
        return float("nan")
    return float(roc_auc_score(y[m], p[m]))


@dataclass
class FusionFoldResult:
    fold: int
    metrics: dict[str, float]
    best_w: float


def _metric_bundle(y_true: np.ndarray, y_prob: np.ndarray, threshold: float = 0.5) -> dict[str, float]:
    y_true = np.asarray(y_true, dtype=int)
    y_prob = np.asarray(y_prob, dtype=float)
    out = classification_metrics(y_true, y_prob, threshold=threshold, auc_ci=False)
    y_pred = (y_prob >= threshold).astype(int)
    out["f1_macro"] = float(np.nan if len(y_true) == 0 else f1_score(y_true, y_pred, average="macro", zero_division=0))
    out["f1_weighted"] = float(
        np.nan if len(y_true) == 0 else f1_score(y_true, y_pred, average="weighted", zero_division=0)
    )
    return out


def run_stratified_group_cv(
    patient_ids: list[str],
    y: np.ndarray,
    p_tab: np.ndarray,
    p_img: np.ndarray,
    n_splits: int,
    calibration: Literal["none", "platt", "isotonic"],
    random_state: int,
    stack_C: float = 0.3,
    threshold: float = 0.5,
) -> tuple[list[FusionFoldResult], dict[str, float], pd.DataFrame]:
    """分层 Group K 折：每折在训练患者上拟合校准与 Stacking，在验证患者上评估。"""
    groups = np.asarray(patient_ids)
    y = np.asarray(y).astype(int)
    sgkf = StratifiedGroupKFold(n_splits=n_splits, shuffle=True, random_state=random_state)

    fold_rows: list[FusionFoldResult] = []
    all_oof: dict[str, list[np.ndarray]] = {
        k: [] for k in ["y", "p_tab", "p_img", "mean", "weighted", "product", "stack", "max"]
    }
    fold_ids: list[np.ndarray] = []

    for fold, (tr, va) in enumerate(sgkf.split(np.zeros(len(y)), y, groups)):
        y_tr, y_va = y[tr], y[va]
        pt_tr, pt_va = p_tab[tr], p_tab[va]
        pi_tr, pi_va = p_img[tr], p_img[va]

        pt_tr_c = calibrate_probs(y_tr, pt_tr, pt_tr, calibration)
        pt_va_c = calibrate_probs(y_tr, pt_tr, pt_va, calibration)
        pi_tr_c = calibrate_probs(y_tr, pi_tr, pi_tr, calibration)
        pi_va_c = calibrate_probs(y_tr, pi_tr, pi_va, calibration)

        w = grid_best_weight(pt_tr_c, pi_tr_c, y_tr)
        fused_w = w * pt_va_c + (1.0 - w) * pi_va_c
        fused_m = 0.5 * (pt_va_c + pi_va_c)
        fused_p = product_fusion_normalized(pt_va_c, pi_va_c)
        fused_x = np.maximum(pt_va_c, pi_va_c)

        X_meta_tr = np.column_stack([pt_tr_c, pi_tr_c])
        stack = LogisticRegression(
            max_iter=2000,
            C=stack_C,
            class_weight="balanced",
            random_state=random_state,
        )
        stack.fit(X_meta_tr, y_tr)
        fused_s = stack.predict_proba(np.column_stack([pt_va_c, pi_va_c]))[:, 1]

        metrics = {
            "auc_tab": _auc_safe(y_va, pt_va_c),
            "auc_img": _auc_safe(y_va, pi_va_c),
            "auc_mean": _auc_safe(y_va, fused_m),
            "auc_weighted": _auc_safe(y_va, fused_w),
            "auc_product": _auc_safe(y_va, fused_p),
            "auc_stack_lr": _auc_safe(y_va, fused_s),
            "auc_max": _auc_safe(y_va, fused_x),
        }
        fold_rows.append(FusionFoldResult(fold=fold, metrics=metrics, best_w=w))

        all_oof["y"].append(y_va)
        all_oof["p_tab"].append(pt_va_c)
        all_oof["p_img"].append(pi_va_c)
        all_oof["mean"].append(fused_m)
        all_oof["weighted"].append(fused_w)
        all_oof["product"].append(fused_p)
        all_oof["stack"].append(fused_s)
        all_oof["max"].append(fused_x)
        fold_ids.append(np.full(len(y_va), fold, dtype=int))

    y_all = np.concatenate(all_oof["y"])
    mean_aucs = {}
    for name in ["p_tab", "p_img", "mean", "weighted", "product", "stack", "max"]:
        p_all = np.concatenate(all_oof[name])
        key = {
            "p_tab": "cv_mean_auc_tab",
            "p_img": "cv_mean_auc_img",
            "mean": "cv_mean_auc_mean",
            "weighted": "cv_mean_auc_weighted",
            "product": "cv_mean_auc_product",
            "stack": "cv_mean_auc_stack_lr",
            "max": "cv_mean_auc_max",
        }[name]
        mean_aucs[key] = _auc_safe(y_all, p_all)
    oof_df = pd.DataFrame(
        {
            "fold": np.concatenate(fold_ids),
            "y_true": y_all,
            "p_tab": np.concatenate(all_oof["p_tab"]),
            "p_img": np.concatenate(all_oof["p_img"]),
            "p_mean": np.concatenate(all_oof["mean"]),
            "p_weighted": np.concatenate(all_oof["weighted"]),
            "p_product": np.concatenate(all_oof["product"]),
            "p_stack_lr": np.concatenate(all_oof["stack"]),
            "p_max": np.concatenate(all_oof["max"]),
        }
    )
    return fold_rows, mean_aucs, oof_df


def build_comparison_table(fold_rows: list[FusionFoldResult], oof_df: pd.DataFrame, threshold: float = 0.5) -> pd.DataFrame:
    """方法 × 指标：各折AUC均值/标准差 + OOF 全量分类指标。"""
    methods = [
        ("表格单模态", "auc_tab", "p_tab"),
        ("图像单模态", "auc_img", "p_img"),
        ("简单平均", "auc_mean", "p_mean"),
        ("加权平均（折内网格搜索 w）", "auc_weighted", "p_weighted"),
        ("乘积融合（归一化）", "auc_product", "p_product"),
        ("最大值融合 max(P_tab,P_img)", "auc_max", "p_max"),
        ("Stacking（逻辑回归元学习器）", "auc_stack_lr", "p_stack_lr"),
    ]
    rows = []
    y = oof_df["y_true"].to_numpy(dtype=int)
    for label, key, p_col in methods:
        vals = [fr.metrics[key] for fr in fold_rows if np.isfinite(fr.metrics[key])]
        bundle = _metric_bundle(y, oof_df[p_col].to_numpy(dtype=float), threshold=threshold)
        rows.append(
            {
                "方法": label,
                "各折AUC均值": float(np.nanmean(vals)) if vals else float("nan"),
                "各折AUC标准差": float(np.nanstd(vals)) if vals else float("nan"),
                "OOF总体AUC": bundle["auc"],
                "OOF_AP": bundle["ap"],
                "OOF_Accuracy": bundle["accuracy"],
                "OOF_Sensitivity": bundle["sensitivity"],
                "OOF_Specificity": bundle["specificity"],
                "OOF_F1": bundle["f1"],
                "OOF_F1_weighted": bundle["f1_weighted"],
                "OOF_Brier": bundle["brier"],
            }
        )
    return pd.DataFrame(rows)


def highlight_best(df: pd.DataFrame, similarity_eps: float = 0.01) -> tuple[str, str]:
    """返回摘要和最终推荐策略（综合 AUC，含 max 相近优先规则）。"""
    d = df.dropna(subset=["OOF总体AUC"])
    if d.empty:
        return "样本量或折数不足，无法可靠比较 AUC。\n", "undetermined"
    best = d.loc[d["OOF总体AUC"].idxmax()]
    tab = d[d["方法"] == "表格单模态"]["OOF总体AUC"]
    img = d[d["方法"] == "图像单模态"]["OOF总体AUC"]
    auc_tab = float(tab.iloc[0]) if len(tab) else float("nan")
    auc_img = float(img.iloc[0]) if len(img) else float("nan")
    base = max(auc_tab, auc_img) if np.isfinite(auc_tab) and np.isfinite(auc_img) else float("nan")
    lift = float(best["OOF总体AUC"] - base) if np.isfinite(base) else float("nan")
    note = ""
    if best["方法"] == "加权平均（折内网格搜索 w）" and abs(lift) < 1e-4:
        note = "（与较强单模态 AUC 实质相同，折内最优 w 可能接近 0 或 1，即近似单模态。）"
    summary = (
        f"最优方法（按 OOF 总体 AUC）：{best['方法']}，AUC={best['OOF总体AUC']:.4f}；"
        f"相对较强单模态（表格与图像的 OOF AUC 较大者）变化约 {lift:+.4f}。{note}\n"
    )
    recommended = str(best["方法"])
    single_best = "表格单模态" if auc_tab >= auc_img else "图像单模态"
    single_best_auc = max(auc_tab, auc_img)
    max_row = d[d["方法"] == "最大值融合 max(P_tab,P_img)"]
    if len(max_row):
        max_auc = float(max_row.iloc[0]["OOF总体AUC"])
        # 若单模态最佳且 max 融合性能相近（或略优），推荐 max 融合策略
        if recommended == single_best and np.isfinite(max_auc) and (single_best_auc - max_auc) <= similarity_eps:
            recommended = "最大值融合 max(P_tab,P_img)"
            summary += (
                f"推荐策略：{recommended}（与单模态最优 AUC 差 <= {similarity_eps:.3f}，"
                "且可在双模态可用时优先融合，满足稳健部署诉求）。\n"
            )
        else:
            summary += f"推荐策略：{recommended}。\n"
    else:
        summary += f"推荐策略：{recommended}。\n"
    return summary, recommended


def fuse_posterior_dynamic(
    p_tab: float | None,
    p_img: float | None,
    *,
    mode: Literal["mean", "weighted", "product", "stack_lr"],
    w: float = 0.5,
    stack_lr: LogisticRegression | None = None,
) -> tuple[float | None, str]:
    """
    按输入动态选择预测方式：仅表格 / 仅图像 / 双模态融合。
    mode 为 stack_lr 时需传入已拟合的 stack_lr（特征列顺序 [P_tab, P_img]）。
    """
    if p_tab is not None and p_img is not None:
        pt, pi = float(p_tab), float(p_img)
        if mode == "mean":
            return (pt + pi) / 2.0, "fused_mean"
        if mode == "weighted":
            w = float(np.clip(w, 0.0, 1.0))
            return w * pt + (1.0 - w) * pi, "fused_weighted"
        if mode == "product":
            return float(product_fusion_normalized(np.array([pt]), np.array([pi]))[0]), "fused_product"
        if mode == "stack_lr":
            if stack_lr is None:
                raise ValueError("stack_lr 模式需要传入已训练的逻辑回归元学习器")
            X = np.array([[pt, pi]], dtype=float)
            return float(stack_lr.predict_proba(X)[0, 1]), "fused_stack_lr"
    if p_tab is not None:
        return float(p_tab), "tabular_only"
    if p_img is not None:
        return float(p_img), "image_only"
    return None, "no_input"


def refit_full_artifacts(
    y: np.ndarray,
    p_tab: np.ndarray,
    p_img: np.ndarray,
    calibration: Literal["none", "platt", "isotonic"],
    stack_C: float,
    random_state: int,
) -> dict:
    """在全量双模态患者上重训校准与元学习器，供部署（注意：若用于论文报告应优先采用 CV 结果）。"""
    y = np.asarray(y).astype(int)
    pt_c = calibrate_probs(y, p_tab, p_tab, calibration)
    pi_c = calibrate_probs(y, p_img, p_img, calibration)
    w = grid_best_weight(pt_c, pi_c, y)
    stack = LogisticRegression(
        max_iter=2000,
        C=stack_C,
        class_weight="balanced",
        random_state=random_state,
    )
    stack.fit(np.column_stack([pt_c, pi_c]), y)
    return {
        "calibration": calibration,
        "weight_tabular": w,
        "stack_lr": stack,
        "platt_tab_fitted_on": "use calibrate_probs inline; redeploy via joblib bundle",
    }


def task2_split_recommendation(n_patients_with_images: int, min_patients: int = 25) -> dict:
    """
    任务二：若图像侧患者足够，可划一部分参与图像模型训练；否则作外部验证集。
    外部验证需注意屏幕文字、标尺等叠加噪声，建议裁剪扇形 ROI 或训练时混入同类增强。
    """
    if n_patients_with_images >= min_patients:
        return {
            "decision": "split_ok",
            "message": (
                f"同时有图的患者数 {n_patients_with_images} ≥ {min_patients}，可考虑分层划出约 15%–20% 患者 "
                "加入主图像训练集（须按患者 ID 分层，且勿与 merge_valid 融合评估折重叠）。"
                "若保留部分患者作纯外部验证，请注意仪器参数/时间戳等文字叠加；推理前宜扇区掩膜或边缘裁剪，"
                "或在训练中做类似干扰增强。"
            ),
        }
    return {
        "decision": "external_only",
        "message": (
            f"同时有图的患者数 {n_patients_with_images} < {min_patients}，不建议再拆分训练；"
            "宜将 merge_valid 图像作为外部验证集。注意：外部图像常含仪器参数、时间戳等文字叠加，"
            "建议在推理前做扇区掩膜/边缘裁剪，或在训练数据中加入类似文字区域增强以降低捷径学习。"
        ),
    }


def run_multimodal_report(
    demo_csv: Path | None = None,
    image_root: Path | None = None,
    tabular_preprocess_path: Path | None = None,
    tabular_model_path: Path | None = None,
    image_checkpoint: Path | None = None,
    output_dir: Path | None = None,
    n_splits: int = 5,
    calibration: Literal["none", "platt", "isotonic"] = "platt",
    stack_C: float = 0.3,
    random_state: int = RANDOM_STATE,
    refit_full: bool = False,
    image_preprocess: Literal["baseline", "fan_geom"] = "baseline",
    fan_top_strip: float = 0.12,
    behsof_new_thr: float = 1.0,
    behsof_original_thr: float = 2.0,
    similarity_eps: float = 0.01,
    *,
    with_health_score: bool = True,
    with_personalized_shap: bool = False,
    shap_topk: int = 5,
    shap_sample_n: int = 80,
) -> dict:
    """端到端：读 Demo、发现图像、跑 CV、写报告与元数据。"""
    demo_csv = demo_csv or default_merge_valid_paths()[0]
    image_root = image_root or default_merge_valid_paths()[1]
    output_dir = output_dir or default_merge_valid_paths()[2]
    tabular_preprocess_path = tabular_preprocess_path or (MODEL_DIR / "preprocess_tree_nan.joblib")
    tabular_model_path = tabular_model_path or (MODEL_DIR / "xgb_tree_nan.joblib")
    if image_checkpoint is None:
        image_checkpoint = MODEL_DIR / "image" / "efficientnet_b0.pt"

    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    demo = pd.read_csv(demo_csv, low_memory=False)
    mapped = demo_row_to_nhanes_frame(demo).reset_index(drop=True)
    patient_ids = mapped["patient_id"].astype(str).tolist()

    preprocess = joblib.load(tabular_preprocess_path)
    tab_model = joblib.load(tabular_model_path)
    p_tab = tabular_probs_batch(mapped, preprocess, tab_model)

    pid_set = set(patient_ids)
    p2paths = collect_patient_image_paths(Path(image_root), pid_set)
    p_img = image_probs_per_patient(
        Path(image_checkpoint),
        p2paths,
        patient_ids,
        image_preprocess=image_preprocess,
        fan_top_strip=fan_top_strip,
    )

    both_mask = np.isfinite(p_img)
    n_both = int(np.sum(both_mask))
    t2 = task2_split_recommendation(n_both)

    meta = {
        "demo_csv": str(Path(demo_csv).resolve()),
        "image_root": str(Path(image_root).resolve()),
        "image_checkpoint": str(Path(image_checkpoint).resolve()),
        "n_demo_rows_total": int(len(mapped)),
        "n_patients_with_any_image": int(sum(1 for pid in patient_ids if p2paths.get(pid))),
        "n_patients_both_modalities": n_both,
        "outcome": f"CAP>={CAP_NAFLD_THRESHOLD}",
        "n_splits_requested": n_splits,
        "calibration": calibration,
        "image_preprocess": image_preprocess,
        "fan_top_strip": float(fan_top_strip),
        "behsof_new_thr": float(behsof_new_thr),
        "behsof_original_thr": float(behsof_original_thr),
        "similarity_eps": float(similarity_eps),
        "task2_split_recommendation": t2,
    }

    if n_both < max(3, n_splits):
        meta["error"] = (
            f"同时具有表格与图像的患者仅 {n_both} 例，不足以做 n_splits={n_splits} 的分层分组折。"
            "请降低 --n-splits 或补充 image_Data 下患者文件夹。"
        )
        (output_dir / "multimodal_meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
        return {"meta": meta, "table": None}

    pid_arr = np.asarray(patient_ids, dtype=object)
    cap = pd.to_numeric(demo["CAP score"], errors="coerce").to_numpy(dtype=float)
    stg = pd.to_numeric(demo["Steatosis stage"], errors="coerce").to_numpy(dtype=float)
    y_cap = np.where(np.isfinite(cap) & (cap >= 0), (cap >= CAP_NAFLD_THRESHOLD).astype(int), np.nan)
    y_stg_new = np.where(np.isfinite(stg), (stg >= float(behsof_new_thr)).astype(int), np.nan)
    y_stg_orig = np.where(np.isfinite(stg), (stg >= float(behsof_original_thr)).astype(int), np.nan)
    y_cap_agree = np.where(
        np.isfinite(y_cap) & np.isfinite(y_stg_orig) & (y_cap == y_stg_orig),
        y_cap,
        np.nan,
    )

    modes = [
        ("behsf_new_stage_ge1", "BEHSOF stage>=1", y_stg_new),
        ("behsf_original", f"BEHSOF original stage>={behsof_original_thr:g}", y_stg_orig),
        ("cap_agree_subset", "CAP一致子集（与BEHSOF original一致）", y_cap_agree),
    ]

    # highlight_best() 返回的 recommended 策略字符串 -> oof_df 中的概率列
    reco_to_p_col = {
        "表格单模态": "p_tab",
        "图像单模态": "p_img",
        "简单平均": "p_mean",
        "加权平均（折内网格搜索 w）": "p_weighted",
        "乘积融合（归一化）": "p_product",
        "最大值融合 max(P_tab,P_img)": "p_max",
        "Stacking（逻辑回归元学习器）": "p_stack_lr",
    }

    lines = [
        "# 多模态后融合方法对比（merge_valid：双模态子集）",
        "",
        f"- 概率校准（折内）：{calibration}。",
        f"- 图像预处理：{image_preprocess}" + (f"（top_strip={fan_top_strip:.2f}）" if image_preprocess == "fan_geom" else ""),
        f"- 标签口径：BEHSOF新阈值 stage>={behsof_new_thr:g}；BEHSOF原始阈值 stage>={behsof_original_thr:g}；并报告 CAP 一致子集。",
        "",
        "## 任务二（数据划分建议）",
        t2["message"],
        "",
    ]

    mode_meta = {}
    primary_df = None
    primary_fold = None
    primary_oof = None
    for mode_key, mode_name, y_mode in modes:
        mode_mask = both_mask & np.isfinite(y_mode)
        pid_m = pid_arr[mode_mask]
        y_m = y_mode[mode_mask].astype(int)
        pt_m = p_tab[mode_mask]
        pi_m = p_img[mode_mask]
        if len(y_m) < 12 or len(np.unique(y_m)) < 2:
            mode_meta[mode_key] = {"n": int(len(y_m)), "error": "样本量不足或单一类别，跳过CV"}
            lines += [f"## {mode_name}", "样本量不足或标签单一，无法CV评估。", ""]
            continue

        n_splits_eff = min(n_splits, len(y_m))
        while n_splits_eff > 1:
            try:
                sgkf = StratifiedGroupKFold(n_splits=n_splits_eff, shuffle=True, random_state=random_state)
                next(sgkf.split(np.zeros(len(y_m)), y_m, pid_m))
                break
            except ValueError:
                n_splits_eff -= 1
        if n_splits_eff <= 1:
            mode_meta[mode_key] = {"n": int(len(y_m)), "error": "无法形成有效分层分组折"}
            lines += [f"## {mode_name}", "无法形成有效分层分组折，跳过。", ""]
            continue

        fold_rows, mean_aucs, oof_df = run_stratified_group_cv(
            list(pid_m),
            y_m,
            pt_m,
            pi_m,
            n_splits=n_splits_eff,
            calibration=calibration,
            random_state=random_state,
            stack_C=stack_C,
            threshold=0.5,
        )
        df = build_comparison_table(fold_rows, oof_df, threshold=0.5)
        summary_text, recommended = highlight_best(df, similarity_eps=similarity_eps)
        df.to_csv(output_dir / f"multimodal_fusion_comparison_{mode_key}.csv", index=False, encoding="utf-8-sig")
        fold_df = pd.DataFrame([{"fold": fr.fold, "best_w_tabular": fr.best_w, **fr.metrics} for fr in fold_rows])
        fold_df.to_csv(output_dir / f"multimodal_fusion_fold_detail_{mode_key}.csv", index=False, encoding="utf-8-sig")
        oof_df2 = oof_df.copy()
        oof_df2["patient_id"] = pid_m

        if with_health_score:
            p_cols = ["p_tab", "p_img", "p_mean", "p_weighted", "p_product", "p_stack_lr", "p_max"]
            for p_col in p_cols:
                if p_col in oof_df2.columns:
                    oof_df2[f"health_score_{p_col}"] = health_score_from_prob(oof_df2[p_col].to_numpy(dtype=float))

            p_col_selected = reco_to_p_col.get(recommended)
            if p_col_selected and p_col_selected in oof_df2.columns:
                oof_df2["health_score_recommended"] = health_score_from_prob(
                    oof_df2[p_col_selected].to_numpy(dtype=float)
                )
                oof_df2["recommended_strategy"] = recommended
        oof_df2.to_csv(output_dir / f"multimodal_oof_predictions_{mode_key}.csv", index=False, encoding="utf-8-sig")

        mode_meta[mode_key] = {
            "mode_name": mode_name,
            "n_eval": int(len(y_m)),
            "n_pos": int(np.sum(y_m == 1)),
            "n_splits_effective": int(n_splits_eff),
            "recommended_strategy": recommended,
            "mean_aucs_oof": mean_aucs,
        }
        lines += [f"## {mode_name}", f"- 样本数: {len(y_m)}（阳性 {int(np.sum(y_m==1))}）", summary_text, "", df.to_string(index=False), ""]
        if mode_key == "behsf_new_stage_ge1":
            primary_df = df
            primary_fold = fold_df
            primary_oof = oof_df2

    if primary_df is not None:
        primary_df.to_csv(output_dir / "multimodal_fusion_comparison.csv", index=False, encoding="utf-8-sig")
        primary_fold.to_csv(output_dir / "multimodal_fusion_fold_detail.csv", index=False, encoding="utf-8-sig")
        primary_oof.to_csv(output_dir / "multimodal_per_patient_scores.csv", index=False, encoding="utf-8-sig")
    lines += ["说明：比较以 OOF 全量指标为主；各折AUC均值/标准差用于稳定性参考。"]
    (output_dir / "multimodal_fusion_report.txt").write_text("\n".join(lines), encoding="utf-8")

    artifacts = None
    if refit_full and primary_oof is not None:
        y_b = primary_oof["y_true"].to_numpy(dtype=int)
        pt_b = primary_oof["p_tab"].to_numpy(dtype=float)
        pi_b = primary_oof["p_img"].to_numpy(dtype=float)
        artifacts = refit_full_artifacts(y_b, pt_b, pi_b, calibration, stack_C, random_state)
        joblib.dump(
            {
                "weight_tabular": artifacts["weight_tabular"],
                "stack_lr": artifacts["stack_lr"],
                "calibration": calibration,
            },
            output_dir / "fusion_deploy.joblib",
        )

    # 融合端：个体级个性化 SHAP（可选，基于元学习器 LogisticRegression 的 SHAP-like 排序）
    if with_personalized_shap and primary_oof is not None:
        primary_key = "behsf_new_stage_ge1"
        primary_meta = mode_meta.get(primary_key, {})
        recommended_strategy = primary_meta.get("recommended_strategy", "undetermined")
        p_col_selected = reco_to_p_col.get(recommended_strategy)
        if not p_col_selected or p_col_selected not in primary_oof.columns:
            p_col_selected = "p_weighted" if "p_weighted" in primary_oof.columns else "p_mean"

        y_b = primary_oof["y_true"].to_numpy(dtype=int)
        X_meta_all = primary_oof[["p_tab", "p_img"]].to_numpy(dtype=float)
        n_all = len(y_b)
        n_sel = int(min(max(shap_sample_n, 1), n_all))
        rng = np.random.RandomState(random_state)
        if n_sel < n_all:
            idx_sel = rng.choice(n_all, n_sel, replace=False)
        else:
            idx_sel = np.arange(n_all)

        X_meta_sel = X_meta_all[idx_sel]
        y_sel = y_b[idx_sel]
        p_sel = primary_oof[p_col_selected].to_numpy(dtype=float)[idx_sel]

        # 优先使用 refit_full 得到的 stack_lr；否则就直接在当前 primary_oof 上拟合一个临时元学习器
        if artifacts is not None and "stack_lr" in artifacts and artifacts.get("stack_lr") is not None:
            stack_lr = artifacts["stack_lr"]
        else:
            stack_lr = LogisticRegression(
                max_iter=2000,
                C=stack_C,
                class_weight="balanced",
                random_state=random_state,
            )
            stack_lr.fit(X_meta_all, y_b)

        shap_like_df = compute_logreg_local_shap_like_topk(
            model=stack_lr,
            X_meta=X_meta_sel,
            feature_names=["p_tab", "p_img"],
            background_X_meta=X_meta_all,
            top_k=shap_topk,
        )
        shap_like_df["patient_id"] = primary_oof.iloc[idx_sel]["patient_id"].astype(str).to_numpy()
        shap_like_df["y_true"] = y_sel
        shap_like_df["p_fused_used"] = p_sel
        shap_like_df["health_score_recommended"] = health_score_from_prob(p_sel)

        shap_out_csv = output_dir / f"fusion_personalized_shap_top{shap_topk}_oof_sample.csv"
        shap_like_df.to_csv(shap_out_csv, index=False, encoding="utf-8-sig")

        # 抽样验证：健康评分对“非 NAFLD”分组的一致性 + TOP 特征方向一致性
        non_nafld = (1 - y_sel).astype(int)
        if len(np.unique(non_nafld)) > 1:
            health_auc = roc_auc_score(non_nafld, shap_like_df["health_score_recommended"].to_numpy(dtype=float))
        else:
            health_auc = float("nan")
        hs_arr = shap_like_df["health_score_recommended"].to_numpy(dtype=float)
        mean_health_non = float(np.nanmean(hs_arr[y_sel == 0]))
        mean_health_nafld = float(np.nanmean(hs_arr[y_sel == 1]))

        shap_cols = [f"top{r}_shap" for r in range(1, shap_topk + 1)]
        indicators = []
        for c in shap_cols:
            if c not in shap_like_df.columns:
                continue
            v = shap_like_df[c].to_numpy(dtype=float)
            ind = np.where(np.isnan(v), np.nan, (v > 0).astype(float))
            indicators.append(ind)

        if indicators:
            sample_pos_rate = np.nanmean(np.stack(indicators, axis=0), axis=0)
            pos_rate_non = float(np.nanmean(sample_pos_rate[y_sel == 0]))
            pos_rate_nafld = float(np.nanmean(sample_pos_rate[y_sel == 1]))
        else:
            pos_rate_non = float("nan")
            pos_rate_nafld = float("nan")

        validation = {
            "n_selected": n_sel,
            "top_k": shap_topk,
            "health_score_formula": "health=(1-p_fused_used)*100",
            "health_auc_predict_non_nafld": health_auc,
            "mean_health_non_nafld": mean_health_non,
            "mean_health_nafld": mean_health_nafld,
            "shap_direction_check_top_features_positive_share": {
                "pos_rate_top_shap_gt_0_among_topk_non_nafld": pos_rate_non,
                "pos_rate_top_shap_gt_0_among_topk_nafld": pos_rate_nafld,
            },
            "note": "融合端 SHAP-like 分解用于特征排序探索；解释器拟合在 primary_oof 或 refit_full 基础上完成。",
        }
        (output_dir / f"fusion_personalized_shap_validation_top{shap_topk}.json").write_text(
            json.dumps(validation, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    meta["label_mode_results"] = mode_meta
    (output_dir / "multimodal_meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
    return {"meta": meta, "table": primary_df, "fold_rows": None, "artifacts": artifacts}
