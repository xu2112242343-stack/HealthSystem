"""本地 Ultralytics YOLO 分割权重：骨干特征 + 二分类头（NAFLD）。权重放在项目根目录 `yolo_model/`。"""
from __future__ import annotations

from pathlib import Path

import torch
import torch.nn as nn
import torch.nn.functional as F

# 逻辑名 -> 相对于项目根 `yolo_model/` 的文件名
YOLO_SEG_LOCAL: dict[str, str] = {
    "yolo11s_seg": "yolo11s-seg.pt",
    "yolo8s_seg": "yolo8s-seg.pt",
}

_REPO_ROOT = Path(__file__).resolve().parents[2]
_YOLO_WEIGHT_DIR = _REPO_ROOT / "yolo_model"


def is_yolo_seg_model(model_name: str) -> bool:
    return model_name in YOLO_SEG_LOCAL


def _resolve_seg_weight_path(filename: str) -> Path:
    primary = _YOLO_WEIGHT_DIR / filename
    if primary.is_file():
        return primary.resolve()
    aliases = {
        "yolo8s-seg.pt": "yolov8s-seg.pt",
        "yolov8s-seg.pt": "yolo8s-seg.pt",
    }
    if filename in aliases:
        alt = _YOLO_WEIGHT_DIR / aliases[filename]
        if alt.is_file():
            return alt.resolve()
    raise FileNotFoundError(
        f"未在 yolo_model/ 下找到权重文件：{filename}（已尝试路径 {_YOLO_WEIGHT_DIR / filename}）"
    )


def _collect_tensors(obj) -> list[torch.Tensor]:
    """递归收集嵌套 list/tuple 中的 Tensor（检测头常返回 list[list[Tensor]]）。"""
    out: list[torch.Tensor] = []
    if isinstance(obj, torch.Tensor):
        return [obj]
    if isinstance(obj, (list, tuple)):
        for item in obj:
            out.extend(_collect_tensors(item))
        return out
    try:
        import numpy as np

        if isinstance(obj, np.ndarray):
            return [torch.as_tensor(obj)]
    except ImportError:
        pass
    return out


def _fix_embed_batch_output(y):
    """
    ultralytics embed 分支在部分版本里对 (B,C) 做 torch.unbind(dim=0)，
    得到长度为 B 的 tuple，每元为 (C,) —— 需叠回 (B, C)。
    """
    if isinstance(y, tuple) and len(y) > 0 and isinstance(y[0], torch.Tensor) and y[0].dim() == 1:
        return torch.stack(list(y), dim=0)
    return y


def _tensor_to_embedding(t: torch.Tensor) -> torch.Tensor:
    """单张量 → (B, C) 特征向量。"""
    if t.dim() == 4:
        return F.adaptive_avg_pool2d(t, 1).flatten(1)
    if t.dim() == 2:
        return t
    if t.dim() == 3:
        return t.mean(dim=-1)
    if t.dim() == 5:
        return t.flatten(1)
    if t.dim() >= 6:
        return t.flatten(1)
    if t.dim() == 1:
        return t.unsqueeze(0)
    raise ValueError(f"无法池化的张量形状：{tuple(t.shape)}")


def _spatial_embedding(y) -> torch.Tensor:
    """将 YOLO 前向输出（Tensor / 嵌套 list / unbind tuple）转为 (B, C)。"""
    y = _fix_embed_batch_output(y)
    if isinstance(y, torch.Tensor):
        return _tensor_to_embedding(y)
    if isinstance(y, (list, tuple)):
        tensors = _collect_tensors(y)
        if not tensors:
            raise ValueError(
                f"YOLO 前向未解析到 Tensor，原始类型={type(y).__name__}，repr={repr(y)[:300]}"
            )
        if len(tensors) == 1:
            return _tensor_to_embedding(tensors[0])
        four = [t for t in tensors if t.dim() == 4]
        if four:
            t = max(four, key=lambda z: z.shape[2] * z.shape[3])
            return F.adaptive_avg_pool2d(t, 1).flatten(1)
        for t in tensors:
            if t.dim() == 2:
                return t
        return _tensor_to_embedding(tensors[0])
    raise TypeError(type(y))


def _yolo_predict_once(det: torch.nn.Module, x: torch.Tensor) -> torch.Tensor | list | tuple:
    """
    ultralytics 8.4+ 使用 _predict_once；旧版为 _forward_once。
    优先在「倒数第二个模块」截断（embed），避免检测/分割头返回嵌套 list 且不含顶层 Tensor。
    """
    fn = getattr(det, "_predict_once", None) or getattr(det, "_forward_once", None)
    if fn is None:
        raise RuntimeError(
            "当前 ultralytics 在 nn 模型上未暴露 _predict_once / _forward_once，请检查 ultralytics 安装。"
        )
    n = len(det.model)
    embed_candidates: list[list[int] | None] = []
    if n >= 2:
        embed_candidates.append([n - 2])
    if n >= 3:
        embed_candidates.append([n - 3])
    embed_candidates.append(None)  # 全量前向，再用 _collect_tensors 解析

    last_err: Exception | None = None
    for embed in embed_candidates:
        try:
            if embed is not None:
                out = fn(x, profile=False, visualize=False, embed=embed)
            else:
                try:
                    out = fn(x, profile=False, visualize=False, embed=None)
                except TypeError:
                    out = fn(x)
            return out
        except Exception as e:
            last_err = e
            continue
    raise RuntimeError(f"YOLO _predict_once 多次尝试失败：{last_err}") from last_err


class YOLOSegBinaryClassifier(nn.Module):
    """
    加载 YOLO 分割/检测 ckpt，用 `_predict_once` 在骨干末层取特征（优先 embed 截断），再接 Linear(1)。
    """

    def __init__(self, weights_path: Path) -> None:
        super().__init__()
        try:
            from ultralytics import YOLO
        except ImportError as e:
            raise ImportError(
                "加载 YOLO 权重需要 ultralytics：pip install ultralytics"
            ) from e
        weights_path = Path(weights_path)
        if not weights_path.is_file():
            raise FileNotFoundError(weights_path)
        yolo = YOLO(str(weights_path))
        self.det = yolo.model
        with torch.no_grad():
            dummy = torch.zeros(1, 3, 224, 224)
            feat = self._forward_features(dummy)
        self.fc = nn.Linear(feat.shape[1], 1)

    def _forward_features(self, x: torch.Tensor) -> torch.Tensor:
        y = _yolo_predict_once(self.det, x)
        return _spatial_embedding(y)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        feat = self._forward_features(x)
        return self.fc(feat)


def build_yolo_seg_binary(model_name: str) -> nn.Module:
    if model_name not in YOLO_SEG_LOCAL:
        raise ValueError(
            f"未知 YOLO 分割模型名：{model_name}，可选：{list(YOLO_SEG_LOCAL)}"
        )
    filename = YOLO_SEG_LOCAL[model_name]
    path = _resolve_seg_weight_path(filename)
    return YOLOSegBinaryClassifier(path)
