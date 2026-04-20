# -*- coding: utf-8 -*-
"""
糖尿病眼底图像预测

支持两种 checkpoint：
  1) 二分类（未患病/患病）：直接输出患病概率 Sigmoid(logit)
  2) 三分类（低/中/高）：输出各类别 softmax 概率，并给出患病概率 P(中)+P(高)

默认模型：models/dr_image_3class/best.pt

用法：
  1) 命令行指定图片：
     d:/Python/python.exe e:/cursor_program/predict_dr_image_3class.py --image "E:\\path\\img.jpeg"

  2) 不传 --image：弹出文件选择窗口（若 tkinter 不可用则退回命令行输入）
     d:/Python/python.exe e:/cursor_program/predict_dr_image_3class.py
"""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Optional

import numpy as np
import torch
import torch.nn as nn
from PIL import Image
from torchvision import models, transforms

ROOT = Path(__file__).resolve().parent
DEFAULT_CKPT = ROOT / "models" / "dr_image_3class" / "best.pt"

IMAGE_EXTS = (".jpeg", ".jpg", ".png", ".tif", ".tiff", ".JPEG", ".JPG", ".PNG", ".TIF", ".TIFF")


def build_model(num_classes: int = 3) -> nn.Module:
    # 推理阶段不需要下载 ImageNet 权重：直接用模型结构 + 加载 checkpoint。
    m = models.resnet18(weights=None)
    in_f = m.fc.in_features
    m.fc = nn.Linear(in_f, num_classes)
    return m


def normalize_names(
    tier_names: list[str] | tuple[str, ...] | None, default_names: list[str]
) -> list[str]:
    if tier_names is None:
        return default_names
    tier_names = list(tier_names)
    if len(tier_names) != len(default_names):
        return (tier_names + default_names)[: len(default_names)]
    return tier_names


def choose_image_interactively() -> Optional[Path]:
    try:
        import tkinter as tk  # type: ignore
        from tkinter import filedialog  # type: ignore

        root = tk.Tk()
        root.withdraw()
        root.update()
        p = filedialog.askopenfilename(
            title="选择一张糖尿病眼底图像",
            filetypes=[
                ("Image files", "*.jpeg *.jpg *.png *.tif *.tiff"),
                ("All files", "*.*"),
            ],
        )
        if not p:
            return None
        return Path(p)
    except Exception:
        s = input("请输入图片路径（回车退出）：").strip()
        if not s:
            return None
        return Path(s)


def load_checkpoint(ckpt_path: Path, device: torch.device) -> dict:
    if not ckpt_path.is_file():
        raise FileNotFoundError(f"找不到 checkpoint: {ckpt_path}")
    try:
        return torch.load(ckpt_path, map_location=device, weights_only=False)
    except TypeError:
        return torch.load(ckpt_path, map_location=device)


def predict_image_disease_proba(
    image_path: Path,
    *,
    ckpt_path: Path | None = None,
    no_cuda: bool = False,
) -> dict[str, object]:
    """
    单张眼底图推理，供其它模块（如 fuse_diabetes_modalities）调用。

    返回:
      - ``disease_proba``: float，二分类为正类概率；三分类为 P(中)+P(高)
      - ``predicted_class_0_5``: int，以 disease_proba>=0.5 为患病（三分类下与合并风险一致）
      - ``task_mode``: ``"binary"`` 或 ``"3class"``
    """
    if not image_path.is_file():
        raise FileNotFoundError(f"找不到图片：{image_path}")

    ckpt_p = ckpt_path if ckpt_path is not None else DEFAULT_CKPT
    device = torch.device("cpu" if no_cuda else ("cuda" if torch.cuda.is_available() else "cpu"))
    ckpt = load_checkpoint(ckpt_p, device)

    task_mode = ckpt.get("task_mode", "3class")
    calibration_temperature = float(ckpt.get("calibration_temperature", 1.0) or 1.0)
    if calibration_temperature <= 0:
        calibration_temperature = 1.0
    if task_mode == "binary":
        class_names = normalize_names(ckpt.get("tier_names"), ["未患病", "患病"])
        model = build_model(1)
    else:
        class_names = normalize_names(ckpt.get("tier_names"), ["低", "中", "高"])
        model = build_model(3)
    model.load_state_dict(ckpt["model_state"], strict=True)
    model.to(device)
    model.eval()

    tf = transforms.Compose(
        [
            transforms.Resize((224, 224)),
            transforms.ToTensor(),
            transforms.Normalize(
                mean=[0.485, 0.456, 0.406],
                std=[0.229, 0.224, 0.225],
            ),
        ]
    )

    img = Image.open(image_path).convert("RGB")
    x = tf(img).unsqueeze(0).to(device)

    probs: np.ndarray | None = None
    per_class: list[float] | None = None
    pred_argmax_idx = 0

    with torch.no_grad():
        logits = model(x)
        if task_mode == "binary":
            disease_prob = float(torch.sigmoid(logits / calibration_temperature).item())
            pred_fuse = int(disease_prob >= 0.5)
            pred_argmax_idx = pred_fuse
        else:
            probs = torch.softmax(logits / calibration_temperature, dim=1).cpu().numpy().reshape(-1)
            per_class = [float(x) for x in probs.reshape(-1).tolist()]
            pred_argmax_idx = int(np.argmax(probs))
            disease_prob = (
                float(probs[1] + probs[2]) if len(probs) >= 3 else float(np.sum(probs[1:]))
            )
            pred_fuse = int(disease_prob >= 0.5)

    return {
        "disease_proba": disease_prob,
        "predicted_class_0_5": pred_fuse,
        "pred_argmax_idx": pred_argmax_idx,
        "per_class_proba": per_class,
        "task_mode": task_mode,
        "class_names": class_names,
        "image_path": str(image_path.resolve()),
        "ckpt_path": str(Path(ckpt_p).resolve()),
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="糖尿病眼底图像预测（二分类/三分类）")
    ap.add_argument("--ckpt", type=Path, default=DEFAULT_CKPT, help="best.pt 路径")
    ap.add_argument(
        "--image",
        type=Path,
        default=None,
        help="要预测的单张图片路径（不传则弹出选择框）",
    )
    ap.add_argument("--no_cuda", action="store_true", help="强制使用 CPU")
    args = ap.parse_args()

    image_path = args.image
    if image_path is None:
        image_path = choose_image_interactively()
        if image_path is None:
            print("未选择图片，退出。")
            return

    if image_path.suffix not in IMAGE_EXTS:
        print(f"警告：图片后缀 {image_path.suffix} 不在常见范围内，将尝试仍然读取。")

    out = predict_image_disease_proba(
        image_path, ckpt_path=args.ckpt, no_cuda=args.no_cuda
    )
    disease_prob = float(out["disease_proba"])
    pred_fuse = int(out["predicted_class_0_5"])
    pred_show = int(out["pred_argmax_idx"])
    task_mode = str(out["task_mode"])
    class_names = list(out["class_names"])  # type: ignore[arg-type]

    print(f"图片：{image_path}")
    print(f"模型任务模式：{task_mode}")
    if task_mode == "binary":
        print(f"患病概率（{class_names[1]}=1）：{disease_prob:.6f}")
        print(f"未患病概率（{class_names[0]}=0）：{1.0 - disease_prob:.6f}")
        print(f"预测结果：{class_names[pred_fuse]}（类别索引 {pred_fuse}）")
    else:
        pcls = out["per_class_proba"]
        assert isinstance(pcls, list)
        print("类别概率：")
        for i, name in enumerate(class_names):
            print(f"  {name}({i}): {pcls[i]:.6f}")
        print(
            f"患病概率（{class_names[1]}+{class_names[2]}，相对「{class_names[0]}」以外）："
            f"{disease_prob:.6f}"
        )
        print(f"预测结果：{class_names[pred_show]}（类别索引 {pred_show}）")


if __name__ == "__main__":
    main()

