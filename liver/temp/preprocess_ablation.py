"""
快速预处理消融：固定裁剪 vs 扇区ROI/遮罩，对比同一模型的预测概率变化。

输出：
- temp/preprocess_ablation_out/previews/: 每张图在不同预处理下的可视化 PNG
- temp/preprocess_ablation_out/results.csv: 概率对比表

用法（默认会跑几张代表性图片）：
  python temp/preprocess_ablation.py --checkpoint outputs/models/image/vit_b_16.pt

也可指定图片：
  python temp/preprocess_ablation.py --images path1 path2 ...
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from PIL import Image
from torchvision import transforms

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from liver_ml.image_train import build_model  # noqa: E402


OUT_DIR = ROOT / "temp" / "preprocess_ablation_out"
PREVIEW_DIR = OUT_DIR / "previews"


def _pil_to_gray_np(img: Image.Image) -> np.ndarray:
    return np.asarray(img.convert("L"), dtype=np.uint8)


def fixed_crop(img: Image.Image, top_frac: float = 0.18, bottom_frac: float = 0.0, left_frac: float = 0.0, right_frac: float = 0.0) -> Image.Image:
    """按比例固定裁剪，优先裁掉顶部叠加信息（时间戳/文字条等）。"""
    w, h = img.size
    top = int(round(h * float(np.clip(top_frac, 0.0, 0.9))))
    bottom = int(round(h * float(np.clip(bottom_frac, 0.0, 0.9))))
    left = int(round(w * float(np.clip(left_frac, 0.0, 0.9))))
    right = int(round(w * float(np.clip(right_frac, 0.0, 0.9))))
    x0 = left
    y0 = top
    x1 = max(x0 + 2, w - right)
    y1 = max(y0 + 2, h - bottom)
    return img.crop((x0, y0, x1, y1))


@dataclass
class RoiResult:
    masked: Image.Image
    cropped: Image.Image
    bbox: tuple[int, int, int, int] | None


def sector_roi_mask_and_crop(img: Image.Image, thr: int = 10, pad: int = 6) -> RoiResult:
    """
    轻量“扇区ROI”近似：
    - 用灰度阈值把“黑背景”与“扇区/组织区域”分开
    - 扇区外全部置黑（遮罩）
    - 再取非黑区域 bbox 做裁剪（可选 pad）

    这能有效去掉黑底上的文字/标尺；若文字叠加在扇区内部，无法完全去除。
    """
    arr = np.asarray(img.convert("RGB"), dtype=np.uint8)
    g = _pil_to_gray_np(img)
    m = g > int(thr)
    if not np.any(m):
        # fallback：不做处理
        return RoiResult(masked=img, cropped=img, bbox=None)

    ys, xs = np.where(m)
    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())
    # pad
    x0 = max(0, x0 - pad)
    y0 = max(0, y0 - pad)
    x1 = min(arr.shape[1] - 1, x1 + pad)
    y1 = min(arr.shape[0] - 1, y1 + pad)

    masked = arr.copy()
    masked[~m] = 0
    masked_img = Image.fromarray(masked, mode="RGB")
    cropped = masked_img.crop((x0, y0, x1 + 1, y1 + 1))
    return RoiResult(masked=masked_img, cropped=cropped, bbox=(x0, y0, x1 + 1, y1 + 1))


def fan_geometry_mask(img: Image.Image, top_strip: float = 0.12) -> Image.Image:
    """
    更强约束的“扇区几何掩膜”：
    1) 先去顶部固定比例（常见文字条区域）
    2) 在余下区域保留中下部扇形近似区域（抑制左右 UI/标尺）
    """
    arr = np.asarray(img.convert("RGB"), dtype=np.uint8)
    h, w = arr.shape[:2]
    y0 = int(round(h * float(np.clip(top_strip, 0.0, 0.35))))

    yy, xx = np.mgrid[0:h, 0:w]
    # apex 近似在上方中点
    cx = w / 2.0
    cy = y0 - 0.10 * h
    dx = xx - cx
    dy = yy - cy
    r = np.sqrt(dx * dx + dy * dy)
    theta = np.abs(np.arctan2(dx, dy + 1e-6))  # 以竖直向下为 0

    # 扇形角度 + 半径约束（经验值，兼容多数腹部超声）
    angle_ok = theta < np.deg2rad(34.0)
    r_min = 0.05 * h
    r_max = 1.15 * h
    radius_ok = (r > r_min) & (r < r_max)
    strip_ok = yy >= y0
    m = angle_ok & radius_ok & strip_ok

    out = np.zeros_like(arr)
    out[m] = arr[m]
    return Image.fromarray(out, mode="RGB")


def build_eval_transform(image_size: int) -> transforms.Compose:
    return transforms.Compose(
        [
            transforms.Resize((image_size, image_size)),
            transforms.ToTensor(),
            transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ]
    )


@torch.no_grad()
def predict_one(model, tfm, pil_img: Image.Image) -> float:
    x = tfm(pil_img).unsqueeze(0)
    logits = model(x).reshape(-1)
    return float(torch.sigmoid(logits).cpu().item())


def default_images() -> list[Path]:
    # 尽量选：一个训练域样例 + 两个外部域样例（含强文字条）
    candidates = [
        ROOT / "data" / "image" / "B-MODE" / "NAFLD" / "patient_18_slice_01.png",
        ROOT / "data" / "merge_valid" / "image_Data" / "BEH01121" / "Image.jpg",
        ROOT / "data" / "merge_valid" / "image_Data" / "TAL01331" / "02_07_2022_12_49_23" / "Image.jpg",
    ]
    return [p for p in candidates if p.exists()]


def main() -> None:
    parser = argparse.ArgumentParser(description="Preprocess ablation on a few images.")
    parser.add_argument("--checkpoint", type=Path, required=True, help="e.g. outputs/models/image/vit_b_16.pt")
    parser.add_argument("--images", nargs="*", type=Path, default=None)
    parser.add_argument("--image-size", type=int, default=224)
    parser.add_argument("--crop-top", type=float, default=0.18, help="Fixed crop top fraction.")
    parser.add_argument("--roi-thr", type=int, default=10, help="Gray threshold for ROI mask.")
    parser.add_argument("--fan-top-strip", type=float, default=0.12, help="Top strip removed in fan-geometry mask.")
    args = parser.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)

    ckpt = torch.load(args.checkpoint, map_location="cpu")
    model_name = str(ckpt["model_name"])
    image_size = int(ckpt.get("image_size", args.image_size))
    model = build_model(model_name)
    model.load_state_dict(ckpt["state_dict"])
    model.eval()
    tfm = build_eval_transform(image_size)

    images = args.images if args.images else default_images()
    if not images:
        raise SystemExit("No images found. Please pass --images ...")

    rows = []
    for path in images:
        pil = Image.open(path).convert("RGB")

        # 1) baseline
        p_base = predict_one(model, tfm, pil)
        pil.resize((640, int(640 * pil.size[1] / pil.size[0]))).save(PREVIEW_DIR / f"{path.stem}_0_original.png")

        # 2) fixed crop
        cropped = fixed_crop(pil, top_frac=args.crop_top)
        p_crop = predict_one(model, tfm, cropped)
        cropped.resize((640, int(640 * cropped.size[1] / max(cropped.size[0], 1)))).save(PREVIEW_DIR / f"{path.stem}_1_fixed_crop.png")

        # 3) ROI mask + bbox crop
        roi = sector_roi_mask_and_crop(pil, thr=args.roi_thr)
        p_roi = predict_one(model, tfm, roi.cropped)
        roi.masked.resize((640, int(640 * roi.masked.size[1] / roi.masked.size[0]))).save(PREVIEW_DIR / f"{path.stem}_2_roi_masked.png")
        roi.cropped.resize((640, int(640 * roi.cropped.size[1] / max(roi.cropped.size[0], 1)))).save(PREVIEW_DIR / f"{path.stem}_3_roi_cropped.png")

        # 4) 几何扇区掩膜（更激进）
        fan = fan_geometry_mask(pil, top_strip=args.fan_top_strip)
        p_fan = predict_one(model, tfm, fan)
        fan.resize((640, int(640 * fan.size[1] / fan.size[0]))).save(PREVIEW_DIR / f"{path.stem}_4_fan_geom_mask.png")

        rows.append(
            {
                "image": str(path),
                "model": model_name,
                "p_baseline": p_base,
                "p_fixed_crop": p_crop,
                "p_roi_crop": p_roi,
                "p_fan_geom": p_fan,
                "delta_crop_minus_base": p_crop - p_base,
                "delta_roi_minus_base": p_roi - p_base,
                "delta_fan_minus_base": p_fan - p_base,
                "roi_bbox": None if roi.bbox is None else str(roi.bbox),
            }
        )

    df = pd.DataFrame(rows)
    df.to_csv(OUT_DIR / "results.csv", index=False, encoding="utf-8-sig")
    print(df.to_string(index=False))
    print(f"\nSaved previews to: {PREVIEW_DIR}")
    print(f"Saved results to: {OUT_DIR / 'results.csv'}")


if __name__ == "__main__":
    main()

