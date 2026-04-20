"""
外部评测脚本：在 `data/merge_valid` 的图像文件夹上，对“当前最佳图像模型”做患者级评估，
并与训练时 `outputs/reports/image/image_model_comparison.csv` 中该模型的 `test_patient_*` 指标对比。

用途：
1) 检查性能（AUC/Accuracy/Sensitivity/Specificity/F1/Brier 等）是否在外部数据集下降
2) 发现外部图像分布变化（例如文字噪声/标尺等）导致的鲁棒性问题

注意：
- 外部标签使用 CAP>=248（与项目 NAFLD 金标准一致）
- 患者级概率由同一患者多张切片的概率取均值（可选 median）
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from PIL import Image
from sklearn.metrics import f1_score

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))

from liver_ml.config import CAP_NAFLD_THRESHOLD  # noqa: E402
from liver_ml.image_train import build_model, build_transforms  # noqa: E402
from liver_ml.metrics_tools import classification_metrics  # noqa: E402


IMG_SUFFIXES = {".jpg", ".jpeg", ".png"}


def fan_geometry_mask(img: Image.Image, top_strip: float = 0.12) -> Image.Image:
    """先去顶部条，再保留中下部扇形几何区域。"""
    arr = np.asarray(img.convert("RGB"), dtype=np.uint8)
    h, w = arr.shape[:2]
    y0 = int(round(h * float(np.clip(top_strip, 0.0, 0.35))))
    yy, xx = np.mgrid[0:h, 0:w]
    cx = w / 2.0
    cy = y0 - 0.10 * h
    dx = xx - cx
    dy = yy - cy
    r = np.sqrt(dx * dx + dy * dy)
    theta = np.abs(np.arctan2(dx, dy + 1e-6))
    mask = (theta < np.deg2rad(34.0)) & (r > 0.05 * h) & (r < 1.15 * h) & (yy >= y0)
    out = np.zeros_like(arr)
    out[mask] = arr[mask]
    return Image.fromarray(out)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evaluate best image model on merge_valid external set.")
    parser.add_argument("--demo-csv", type=Path, default=ROOT / "data" / "merge_valid" / "Demo_data.csv")
    parser.add_argument(
        "--image-root",
        type=Path,
        default=ROOT / "data" / "merge_valid" / "image_Data",
        help="Expected: image_Data/<Patient ID>/*.jpg|png",
    )
    parser.add_argument(
        "--comparison-csv",
        type=Path,
        default=ROOT / "outputs" / "reports" / "image" / "image_model_comparison.csv",
    )
    parser.add_argument(
        "--models-dir",
        type=Path,
        default=ROOT / "outputs" / "models" / "image",
        help="Expected checkpoints: {model_name}.pt",
    )
    parser.add_argument("--model-name", type=str, default=None, help="Override model name (e.g., vit_b_16).")
    parser.add_argument(
        "--aggregate",
        choices=["mean", "median"],
        default="mean",
        help="How to aggregate multiple images per patient.",
    )
    parser.add_argument("--batch-size", type=int, default=16, help="Inference batch size (CPU friendly).")
    parser.add_argument("--max-images-per-patient", type=int, default=0, help="0 means no limit.")
    parser.add_argument(
        "--image-preprocess",
        choices=["baseline", "fan_geom"],
        default="baseline",
        help="Image preprocessing before model inference.",
    )
    parser.add_argument("--fan-top-strip", type=float, default=0.12, help="Top strip ratio for fan_geom.")
    parser.add_argument(
        "--behsof-new-thr",
        type=float,
        default=1.0,
        help="New positive definition: Steatosis stage >= this threshold.",
    )
    parser.add_argument(
        "--behsof-original-thr",
        type=float,
        default=2.0,
        help="Original BEHSOF binary positive definition (assumed): Steatosis stage >= this threshold.",
    )
    return parser.parse_args()


def pick_best_model_name(comparison_csv: Path) -> str:
    df = pd.read_csv(comparison_csv)
    if "test_patient_auc" not in df.columns:
        raise ValueError(f"Cannot find test_patient_auc in {comparison_csv}")
    df = df.copy()
    # tie-break: test_patient_f1_weighted, then test_patient_accuracy
    tie_cols = [
        ("test_patient_auc", True),
        ("test_patient_f1_weighted", True),
        ("test_patient_accuracy", True),
    ]
    for col, _ in tie_cols:
        if col not in df.columns:
            df[col] = np.nan
    df_sorted = df.sort_values(
        by=[c for c, _ in tie_cols],
        ascending=[False, False, False],
        kind="mergesort",
    )
    best_row = df_sorted.iloc[0]
    if "model" not in df_sorted.columns:
        raise ValueError("Cannot find model column in comparison csv.")
    return str(best_row["model"])


def load_images_for_patient(image_root: Path, patient_id: str) -> list[Path]:
    folder = image_root / patient_id
    if not folder.is_dir():
        return []
    files = [p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in IMG_SUFFIXES]
    files = sorted(files, key=lambda x: x.name.lower())
    return files


@torch.no_grad()
def predict_patient_probs(
    checkpoint_path: Path,
    image_root: Path,
    demo_df: pd.DataFrame,
    *,
    aggregate: str = "mean",
    batch_size: int = 16,
    max_images_per_patient: int = 0,
    image_preprocess: str = "baseline",
    fan_top_strip: float = 0.12,
) -> tuple[pd.DataFrame, dict]:
    checkpoint = torch.load(checkpoint_path, map_location="cpu")
    model_name = str(checkpoint["model_name"])
    image_size = int(checkpoint.get("image_size", 224))
    threshold = float(checkpoint.get("threshold", 0.5))

    _, eval_tf = build_transforms(image_size)
    model = build_model(model_name)
    model.load_state_dict(checkpoint["state_dict"])
    model.eval()

    patient_ids = demo_df["patient_id"].astype(str).tolist()
    y = demo_df["y_cap_ge_248"].astype(int).to_numpy()
    id_to_label = dict(zip(patient_ids, y))

    rows: list[dict] = []
    all_probs: list[float] = []
    all_labels: list[int] = []
    n_total_patients = len(patient_ids)
    n_used_patients = 0
    n_patients_missing_images = 0

    for i, pid in enumerate(patient_ids):
        label = int(id_to_label[pid])
        imgs = load_images_for_patient(image_root, pid)
        if max_images_per_patient and len(imgs) > max_images_per_patient:
            imgs = imgs[:max_images_per_patient]
        if len(imgs) == 0:
            n_patients_missing_images += 1
            continue

        # simple batching: load tensors then run
        slice_probs: list[float] = []
        cur_batch: list[torch.Tensor] = []
        for p in imgs:
            img = Image.open(p).convert("RGB")
            if image_preprocess == "fan_geom":
                img = fan_geometry_mask(img, top_strip=fan_top_strip)
            tensor = eval_tf(img)
            cur_batch.append(tensor)
            if len(cur_batch) >= batch_size:
                batch = torch.stack(cur_batch, dim=0)
                logits = model(batch).reshape(-1)
                probs = torch.sigmoid(logits).cpu().numpy().astype(float)
                slice_probs.extend([float(x) for x in probs])
                cur_batch = []
        if cur_batch:
            batch = torch.stack(cur_batch, dim=0)
            logits = model(batch).reshape(-1)
            probs = torch.sigmoid(logits).cpu().numpy().astype(float)
            slice_probs.extend([float(x) for x in probs])

        if aggregate == "mean":
            p_patient = float(np.mean(slice_probs)) if slice_probs else np.nan
        else:
            p_patient = float(np.median(slice_probs)) if slice_probs else np.nan

        rows.append(
            {
                "patient_id": pid,
                "label": label,
                "prob": p_patient,
                "n_images": len(imgs),
            }
        )
        all_probs.append(p_patient)
        all_labels.append(label)
        n_used_patients += 1

    pred_df = pd.DataFrame(rows)
    # metrics at patient level
    y_true = np.asarray(all_labels, dtype=int)
    y_prob = np.asarray(all_probs, dtype=float)
    metrics = classification_metrics(y_true, y_prob, threshold=threshold, auc_ci=False)
    # also report macro/weighted f1
    y_pred = (y_prob >= threshold).astype(int)
    metrics["f1_macro"] = float(f1_score(y_true, y_pred, average="macro", zero_division=0))
    metrics["f1_weighted"] = float(f1_score(y_true, y_pred, average="weighted", zero_division=0))
    metrics["threshold"] = threshold
    metrics["n_total_patients"] = int(n_total_patients)
    metrics["n_used_patients"] = int(n_used_patients)
    metrics["n_patients_missing_images"] = int(n_patients_missing_images)
    metrics["image_preprocess"] = image_preprocess
    metrics["fan_top_strip"] = float(fan_top_strip)
    return pred_df, metrics


def make_binary_labels_from_steatosis(
    demo: pd.DataFrame,
    *,
    thr: float,
) -> dict[str, float]:
    """从 Steatosis stage 生成患者级二分类标签映射（patient_id -> 0/1/NaN）。"""
    st = pd.to_numeric(demo["Steatosis stage"], errors="coerce")
    pid_col = "patient_id" if "patient_id" in demo.columns else "Patient ID"
    patient_id = demo[pid_col].astype(str).str.strip()
    out = np.full(len(demo), np.nan, dtype=float)
    st_arr = st.to_numpy(dtype=float)
    valid = np.isfinite(st_arr)
    out[valid & (st_arr >= thr)] = 1.0
    out[valid & (st_arr < thr)] = 0.0
    return dict(zip(patient_id.tolist(), out.tolist()))


def compute_metrics_for_label_map(
    pred_df: pd.DataFrame,
    *,
    label_map: dict[str, float],
    threshold: float,
) -> tuple[dict, int, int]:
    """在 pred_df 的患者集合上，用 label_map 选择有效标签计算 metrics。"""
    y_true = []
    y_prob = []
    n_total_patients = int(len(pred_df))
    for _, r in pred_df.iterrows():
        pid = str(r["patient_id"])
        lbl = label_map.get(pid, np.nan)
        if not np.isfinite(lbl):
            continue
        y_true.append(int(lbl))
        y_prob.append(float(r["prob"]))
    if not y_true:
        empty = {
            "auc": float("nan"),
            "ap": float("nan"),
            "accuracy": float("nan"),
            "sensitivity": float("nan"),
            "specificity": float("nan"),
            "f1": float("nan"),
            "brier": float("nan"),
            "f1_macro": float("nan"),
            "f1_weighted": float("nan"),
        }
        return empty, 0, n_total_patients

    y_true = np.asarray(y_true, dtype=int)
    y_prob = np.asarray(y_prob, dtype=float)
    metrics = classification_metrics(y_true, y_prob, threshold=threshold, auc_ci=False)
    y_pred = (y_prob >= threshold).astype(int)
    metrics["f1_macro"] = float(f1_score(y_true, y_pred, average="macro", zero_division=0))
    metrics["f1_weighted"] = float(f1_score(y_true, y_pred, average="weighted", zero_division=0))
    metrics["n_eval_patients"] = int(len(y_true))
    metrics["n_pos"] = int(np.sum(y_true == 1))
    return metrics, int(np.sum(y_true == 1)), int(n_total_patients)


def build_external_eval_report(
    *,
    model_name: str,
    checkpoint_path: Path,
    pred_df: pd.DataFrame,
    external_metrics: dict,
    internal_row: pd.Series | None,
) -> dict:
    out = {
        "model_name": model_name,
        "checkpoint_path": str(checkpoint_path),
        "external_metrics": external_metrics,
    }
    if internal_row is not None:
        internal_metrics = {
            k: float(internal_row[k])
            for k in [
                "test_patient_auc",
                "test_patient_accuracy",
                "test_patient_sensitivity",
                "test_patient_specificity",
                "test_patient_f1",
                "test_patient_f1_weighted",
                "test_patient_brier",
            ]
            if k in internal_row.index and pd.notna(internal_row[k])
        }
        out["internal_test_metrics"] = internal_metrics
        # deltas
        deltas = {}
        for k, v in internal_metrics.items():
            map_k = {
                "test_patient_auc": "auc",
                "test_patient_accuracy": "accuracy",
                "test_patient_sensitivity": "sensitivity",
                "test_patient_specificity": "specificity",
                "test_patient_f1": "f1",
                "test_patient_f1_weighted": "f1_weighted",
                "test_patient_brier": "brier",
            }.get(k)
            if map_k and map_k in external_metrics:
                deltas[k] = float(external_metrics[map_k]) - float(v)
        out["metric_deltas_external_minus_internal"] = deltas
    out["patient_scores_head"] = pred_df.head(10).to_dict(orient="records")
    return out


def main() -> None:
    args = parse_args()
    t0 = time.time()

    if not args.demo_csv.exists():
        raise FileNotFoundError(args.demo_csv)
    if not args.image_root.exists():
        raise FileNotFoundError(args.image_root)
    if not args.comparison_csv.exists():
        raise FileNotFoundError(args.comparison_csv)
    if not args.models_dir.exists():
        raise FileNotFoundError(args.models_dir)

    demo = pd.read_csv(args.demo_csv, low_memory=False)
    cap = pd.to_numeric(demo["CAP score"], errors="coerce")
    demo_df = pd.DataFrame(
        {
            "patient_id": demo["Patient ID"].astype(str).str.strip(),
            "y_cap_ge_248": np.where(
                cap >= CAP_NAFLD_THRESHOLD,
                1,
                np.where(cap.notna() & (cap >= 0), 0, np.nan),
            ),
        }
    )
    demo_df = demo_df.dropna(subset=["y_cap_ge_248"]).reset_index(drop=True)
    demo_df["y_cap_ge_248"] = demo_df["y_cap_ge_248"].astype(int)

    model_name = args.model_name or pick_best_model_name(args.comparison_csv)
    checkpoint_path = args.models_dir / f"{model_name}.pt"
    if not checkpoint_path.exists():
        raise FileNotFoundError(f"Checkpoint not found: {checkpoint_path}")

    pred_df, external_metrics = predict_patient_probs(
        checkpoint_path,
        args.image_root,
        demo_df,
        aggregate=args.aggregate,
        batch_size=args.batch_size,
        max_images_per_patient=args.max_images_per_patient,
        image_preprocess=args.image_preprocess,
        fan_top_strip=args.fan_top_strip,
    )

    # 额外标签：BEHSOF Steatosis stage >= 1（新定义）与 >= original_thr（原始二分类假设）
    y_behsof_new_map = make_binary_labels_from_steatosis(demo, thr=float(args.behsof_new_thr))
    y_behsof_orig_map = make_binary_labels_from_steatosis(demo, thr=float(args.behsof_original_thr))
    thr = float(external_metrics["threshold"])

    external_metrics_behsof_new, n_pos_new, n_eval_new = compute_metrics_for_label_map(
        pred_df, label_map=y_behsof_new_map, threshold=thr
    )
    external_metrics_behsof_orig, n_pos_orig, n_eval_orig = compute_metrics_for_label_map(
        pred_df, label_map=y_behsof_orig_map, threshold=thr
    )

    # CAP 一致子集：使用“BEHSOF原始标签”和 CAP 是否一致进行筛选
    y_true_agree = []
    y_prob_agree = []
    for _, r in pred_df.iterrows():
        pid = str(r["patient_id"])
        y_orig = y_behsof_orig_map.get(pid, np.nan)
        if not np.isfinite(y_orig):
            continue
        y_cap = int(r["label"])
        if int(y_orig) != y_cap:
            continue
        y_true_agree.append(y_cap)
        y_prob_agree.append(float(r["prob"]))
    if y_true_agree:
        external_metrics_cap_agree = classification_metrics(
            np.asarray(y_true_agree, dtype=int),
            np.asarray(y_prob_agree, dtype=float),
            threshold=thr,
            auc_ci=False,
        )
        y_pred_agree = (np.asarray(y_prob_agree, dtype=float) >= thr).astype(int)
        external_metrics_cap_agree["f1_macro"] = float(
            f1_score(y_true_agree, y_pred_agree, average="macro", zero_division=0)
        )
        external_metrics_cap_agree["f1_weighted"] = float(
            f1_score(y_true_agree, y_pred_agree, average="weighted", zero_division=0)
        )
        external_metrics_cap_agree["n_eval_patients"] = int(len(y_true_agree))
        external_metrics_cap_agree["n_pos"] = int(np.sum(np.asarray(y_true_agree, dtype=int) == 1))
    else:
        external_metrics_cap_agree = {
            "auc": float("nan"),
            "ap": float("nan"),
            "accuracy": float("nan"),
            "sensitivity": float("nan"),
            "specificity": float("nan"),
            "f1": float("nan"),
            "brier": float("nan"),
            "f1_macro": float("nan"),
            "f1_weighted": float("nan"),
            "n_eval_patients": 0,
            "n_pos": 0,
        }

    # internal row for delta comparison
    internal_df = pd.read_csv(args.comparison_csv)
    internal_row = None
    if "model" in internal_df.columns:
        m = internal_df["model"].astype(str) == str(model_name)
        if m.any():
            internal_row = internal_df.loc[m].iloc[0]

    report = build_external_eval_report(
        model_name=model_name,
        checkpoint_path=checkpoint_path,
        pred_df=pred_df,
        external_metrics=external_metrics,
        internal_row=internal_row,
    )
    report["external_metrics_behsof_new_stage_ge1"] = {
        **external_metrics_behsof_new,
        "n_eval_patients": n_eval_new,
        "n_pos": n_pos_new,
        "behsof_new_thr": float(args.behsof_new_thr),
    }
    report["external_metrics_behsof_original"] = {
        **external_metrics_behsof_orig,
        "n_eval_patients": n_eval_orig,
        "n_pos": n_pos_orig,
        "behsof_original_thr": float(args.behsof_original_thr),
    }
    report["external_metrics_cap_agree_subset_behsf_original"] = external_metrics_cap_agree

    out_dir = ROOT / "outputs" / "reports" / "image" / "external_from_merge_valid"
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d_%H%M%S")
    (out_dir / f"external_eval_{model_name}_{stamp}.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    # 写出每个患者的多标签信息，便于你后续分析
    pred_df = pred_df.copy()
    pred_df["y_behsof_new"] = pred_df["patient_id"].astype(str).map(lambda pid: y_behsof_new_map.get(pid, np.nan))
    pred_df["y_behsof_original"] = pred_df["patient_id"].astype(str).map(
        lambda pid: y_behsof_orig_map.get(pid, np.nan)
    )
    pred_df["cap_agree_with_behsof_original"] = (
        pred_df["y_behsof_original"].notna() & (pred_df["y_behsof_original"].astype(float) == pred_df["label"].astype(float))
    )
    pred_df.to_csv(
        out_dir / f"external_patient_scores_{model_name}_{stamp}.csv",
        index=False,
        encoding="utf-8-sig",
    )

    # print concise summary
    ext = report["external_metrics"]
    print("External evaluation finished.")
    print(f"Model: {model_name}")
    print(f"Patients used: {ext['n_used_patients']}/{ext['n_total_patients']} (missing images: {ext['n_patients_missing_images']})")
    print(f"[CAP label] AUC={ext['auc']:.4f}, AP={ext['ap']:.4f}, Acc={ext['accuracy']:.4f}")
    print(
        f"Sens={ext['sensitivity']:.4f}, Spec={ext['specificity']:.4f}, F1={ext['f1']:.4f}, F1_w={ext['f1_weighted']:.4f}, Brier={ext['brier']:.6f}"
    )
    en = report["external_metrics_behsof_new_stage_ge1"]
    eo = report["external_metrics_behsof_original"]
    ea = report["external_metrics_cap_agree_subset_behsf_original"]
    print(
        f"[BEHSOF new stage>= {args.behsof_new_thr}] AUC={en['auc']:.4f}, AP={en['ap']:.4f}, Acc={en['accuracy']:.4f}, "
        f"Sens={en['sensitivity']:.4f}, Spec={en['specificity']:.4f}, F1={en['f1']:.4f}, Brier={en['brier']:.6f}"
    )
    print(
        f"[BEHSOF original stage>= {args.behsof_original_thr}] AUC={eo['auc']:.4f}, AP={eo['ap']:.4f}, Acc={eo['accuracy']:.4f}, "
        f"Sens={eo['sensitivity']:.4f}, Spec={eo['specificity']:.4f}, F1={eo['f1']:.4f}, Brier={eo['brier']:.6f}"
    )
    print(
        f"[CAP-agree subset (with BEHSOF original)] n={ea.get('n_eval_patients',0)} "
        f"AUC={ea['auc']:.4f}, Acc={ea['accuracy']:.4f}, Sens={ea['sensitivity']:.4f}, "
        f"Spec={ea['specificity']:.4f}, F1={ea['f1']:.4f}, Brier={ea['brier']:.6f}"
    )
    if "internal_test_metrics" in report:
        deltas = report.get("metric_deltas_external_minus_internal", {})
        if deltas:
            print("Delta external - internal (test_patient_*):")
            for k, v in deltas.items():
                print(f"  {k}: {v:+.6f}")
    print(f"Elapsed: {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()

