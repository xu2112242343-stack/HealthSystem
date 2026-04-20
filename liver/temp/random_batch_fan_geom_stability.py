"""
随机小样本稳定性测试：baseline vs fan_geom_mask

思路：
1) 从 merge_valid 中读取 CAP 标签（CAP>=248）
2) 只保留有图像的患者
3) 多轮随机抽样（患者级），每轮计算 baseline 与 fan_geom 的患者级指标
4) 汇总每种方法的均值/标准差，并比较 fan_geom - baseline 的提升稳定性
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
from sklearn.model_selection import train_test_split
from torchvision import transforms

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from liver_ml.config import CAP_NAFLD_THRESHOLD  # noqa: E402
from liver_ml.image_train import build_model  # noqa: E402
from liver_ml.metrics_tools import classification_metrics  # noqa: E402


IMG_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp"}


def fan_geometry_mask(img: Image.Image, top_strip: float = 0.12) -> Image.Image:
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
    m = (theta < np.deg2rad(34.0)) & (r > 0.05 * h) & (r < 1.15 * h) & (yy >= y0)

    out = np.zeros_like(arr)
    out[m] = arr[m]
    return Image.fromarray(out)


def build_eval_transform(image_size: int) -> transforms.Compose:
    return transforms.Compose(
        [
            transforms.Resize((image_size, image_size)),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ]
    )


def gather_patient_images(image_root: Path, patient_id: str) -> list[Path]:
    folder = image_root / patient_id
    if not folder.exists():
        return []
    files = [p for p in folder.rglob("*") if p.is_file() and p.suffix.lower() in IMG_SUFFIXES]
    files.sort(key=lambda p: str(p).lower())
    return files


@torch.no_grad()
def predict_patient_prob(
    model,
    tfm,
    image_paths: list[Path],
    mode: str,
    fan_top_strip: float,
) -> float:
    vals: list[float] = []
    for p in image_paths:
        img = Image.open(p).convert("RGB")
        if mode == "fan_geom":
            img = fan_geometry_mask(img, top_strip=fan_top_strip)
        x = tfm(img).unsqueeze(0)
        prob = float(torch.sigmoid(model(x).reshape(-1)).cpu().item())
        vals.append(prob)
    return float(np.mean(vals)) if vals else np.nan


def summarize(y_true: np.ndarray, y_prob: np.ndarray, threshold: float) -> dict:
    out = classification_metrics(y_true, y_prob, threshold=threshold, auc_ci=False)
    y_pred = (y_prob >= threshold).astype(int)
    out["f1_macro"] = float(f1_score(y_true, y_pred, average="macro", zero_division=0))
    out["f1_weighted"] = float(f1_score(y_true, y_pred, average="weighted", zero_division=0))
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="Random mini-batch stability test for fan geometry mask.")
    ap.add_argument("--checkpoint", type=Path, default=ROOT / "outputs" / "models" / "image" / "vit_b_16.pt")
    ap.add_argument("--demo-csv", type=Path, default=ROOT / "data" / "merge_valid" / "Demo_data.csv")
    ap.add_argument("--image-root", type=Path, default=ROOT / "data" / "merge_valid" / "image_Data")
    ap.add_argument("--rounds", type=int, default=8, help="Number of random rounds.")
    ap.add_argument("--sample-size", type=int, default=30, help="Patients sampled per round.")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--fan-top-strip", type=float, default=0.12)
    args = ap.parse_args()

    out_dir = ROOT / "temp" / "fan_geom_stability_out"
    out_dir.mkdir(parents=True, exist_ok=True)

    demo = pd.read_csv(args.demo_csv, low_memory=False)
    cap = pd.to_numeric(demo["CAP score"], errors="coerce")
    df = pd.DataFrame(
        {
            "patient_id": demo["Patient ID"].astype(str).str.strip(),
            "y": np.where(cap >= CAP_NAFLD_THRESHOLD, 1, np.where(cap.notna() & (cap >= 0), 0, np.nan)),
        }
    ).dropna()
    df["y"] = df["y"].astype(int)

    # 只保留有图像患者
    rows = []
    for _, r in df.iterrows():
        imgs = gather_patient_images(args.image_root, r["patient_id"])
        if imgs:
            rows.append({"patient_id": r["patient_id"], "y": int(r["y"]), "n_images": len(imgs), "images": imgs})
    if not rows:
        raise SystemExit("No patients with images found in merge_valid/image_Data.")
    pool = pd.DataFrame(rows)

    ckpt = torch.load(args.checkpoint, map_location="cpu")
    model_name = str(ckpt["model_name"])
    image_size = int(ckpt.get("image_size", 224))
    threshold = float(ckpt.get("threshold", 0.5))
    model = build_model(model_name)
    model.load_state_dict(ckpt["state_dict"])
    model.eval()
    tfm = build_eval_transform(image_size)

    rng = np.random.RandomState(args.seed)
    per_round = []

    # 为了每轮都有两类，采用分层抽样
    pos = pool[pool["y"] == 1]
    neg = pool[pool["y"] == 0]
    n_total = len(pool)
    if len(pos) < 2 or len(neg) < 2:
        raise SystemExit("Need at least 2 positive and 2 negative patients for stability test.")
    sample_size = min(args.sample_size, n_total)
    pos_n = max(1, int(round(sample_size * (len(pos) / n_total))))
    neg_n = max(1, sample_size - pos_n)
    if pos_n > len(pos):
        pos_n = len(pos)
        neg_n = min(len(neg), sample_size - pos_n)
    if neg_n > len(neg):
        neg_n = len(neg)
        pos_n = min(len(pos), sample_size - neg_n)

    # 先全量患者预计算，避免每轮重复推理
    t0 = time.time()
    prob_rows = []
    for _, pr in pool.iterrows():
        imgs = pr["images"]
        p_base = predict_patient_prob(model, tfm, imgs, "baseline", args.fan_top_strip)
        p_fan = predict_patient_prob(model, tfm, imgs, "fan_geom", args.fan_top_strip)
        prob_rows.append(
            {
                "patient_id": pr["patient_id"],
                "y": int(pr["y"]),
                "n_images": int(pr["n_images"]),
                "p_baseline": p_base,
                "p_fan": p_fan,
            }
        )
    prob_df = pd.DataFrame(prob_rows)
    prob_df.to_csv(out_dir / "patient_prob_cache.csv", index=False, encoding="utf-8-sig")

    pos = prob_df[prob_df["y"] == 1]
    neg = prob_df[prob_df["y"] == 0]

    for ridx in range(args.rounds):
        pos_idx = rng.choice(len(pos), size=pos_n, replace=False)
        neg_idx = rng.choice(len(neg), size=neg_n, replace=False)
        sub = pd.concat([pos.iloc[pos_idx], neg.iloc[neg_idx]], ignore_index=True)
        sub = sub.sample(frac=1.0, random_state=int(rng.randint(0, 10_000_000))).reset_index(drop=True)

        y = sub["y"].to_numpy(dtype=int)
        p_base = sub["p_baseline"].to_numpy(dtype=float)
        p_fan = sub["p_fan"].to_numpy(dtype=float)

        m_base = summarize(y, p_base, threshold=threshold)
        m_fan = summarize(y, p_fan, threshold=threshold)
        row = {
            "round": ridx + 1,
            "n_patients": int(len(sub)),
            "n_pos": int(np.sum(y == 1)),
            "n_neg": int(np.sum(y == 0)),
            "auc_baseline": m_base["auc"],
            "auc_fan": m_fan["auc"],
            "acc_baseline": m_base["accuracy"],
            "acc_fan": m_fan["accuracy"],
            "f1_baseline": m_base["f1"],
            "f1_fan": m_fan["f1"],
            "brier_baseline": m_base["brier"],
            "brier_fan": m_fan["brier"],
            "delta_auc": m_fan["auc"] - m_base["auc"],
            "delta_acc": m_fan["accuracy"] - m_base["accuracy"],
            "delta_f1": m_fan["f1"] - m_base["f1"],
            "delta_brier": m_fan["brier"] - m_base["brier"],
        }
        per_round.append(row)

    rounds_df = pd.DataFrame(per_round)
    rounds_csv = out_dir / "round_metrics.csv"
    rounds_df.to_csv(rounds_csv, index=False, encoding="utf-8-sig")

    summary = {
        "model_name": model_name,
        "checkpoint": str(args.checkpoint),
        "pool_patients": int(len(pool)),
        "pool_pos": int((pool["y"] == 1).sum()),
        "pool_neg": int((pool["y"] == 0).sum()),
        "rounds": int(args.rounds),
        "sample_size": int(sample_size),
        "fan_top_strip": float(args.fan_top_strip),
        "mean_delta_auc": float(rounds_df["delta_auc"].mean()),
        "std_delta_auc": float(rounds_df["delta_auc"].std(ddof=0)),
        "mean_delta_acc": float(rounds_df["delta_acc"].mean()),
        "std_delta_acc": float(rounds_df["delta_acc"].std(ddof=0)),
        "mean_delta_f1": float(rounds_df["delta_f1"].mean()),
        "std_delta_f1": float(rounds_df["delta_f1"].std(ddof=0)),
        "mean_delta_brier": float(rounds_df["delta_brier"].mean()),
        "std_delta_brier": float(rounds_df["delta_brier"].std(ddof=0)),
        "cache_file": str(out_dir / "patient_prob_cache.csv"),
        "elapsed_sec": round(time.time() - t0, 2),
    }
    summary_json = out_dir / "summary.json"
    summary_json.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")

    print(rounds_df.to_string(index=False))
    print("\nSummary:")
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    print(f"\nSaved: {rounds_csv}")
    print(f"Saved: {summary_json}")


if __name__ == "__main__":
    main()

