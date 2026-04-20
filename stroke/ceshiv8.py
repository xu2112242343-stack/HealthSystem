"""

使用 YOLO11 分割权重对测试图推理，并给出每张图的综合判读：出血 / 缺血 / 正常。



规则简述：

- 无检测框，或所有框置信度低于阈值：判为「正常」（常见于仅训练病变两类时）。

- 否则取置信度最高的那一个框的类别作为主判。



若控制台打印的「模型类别表」与你的 data 不一致，请修改下方 CLASS_NAME_MAP。

依赖: pip install ultralytics

"""

from __future__ import annotations



from pathlib import Path

from typing import Any



import numpy as np
import cv2
from ultralytics import YOLO



# 将训练数据里的英文/中文类名映射到三种判读（按你的 dataset 改这里）

CLASS_NAME_MAP: dict[str, str] = {

    # 出血

    "hemorrhage": "出血",
    "bleed": "出血",
    "h": "出血",
    "ich": "出血",
    "出血": "出血",
    # 缺血
    "ischemia": "缺血",
    "ischemic": "缺血",
    "infarct": "缺血",
    "缺血": "缺血",
    # 正常（若数据里单独有一类「正常」）
    "normal": "正常",
    "healthy": "正常",
    "control": "正常",
    "正常": "正常",
}


def _norm(s: str) -> str:
    return s.strip().lower()


def class_name_to_diagnosis(name: str) -> str:
    """把模型输出的类别名映射为 出血/缺血/正常；无法映射则返回原样便于排查。"""
    key = _norm(name)
    if key in CLASS_NAME_MAP:
        return CLASS_NAME_MAP[key]
    for en, zh in CLASS_NAME_MAP.items():
        if en in key or key in en:
            return zh
    return name


def _box_iou_xyxy(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """a: (4,), b: (n,4) -> (n,) IoU (xyxy)."""
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b[:, 0], b[:, 1], b[:, 2], b[:, 3]
    inter_x1 = np.maximum(ax1, bx1)
    inter_y1 = np.maximum(ay1, by1)
    inter_x2 = np.minimum(ax2, bx2)
    inter_y2 = np.minimum(ay2, by2)
    iw = np.maximum(0.0, inter_x2 - inter_x1)
    ih = np.maximum(0.0, inter_y2 - inter_y1)
    inter = iw * ih
    area_a = (ax2 - ax1) * (ay2 - ay1)
    area_b = (bx2 - bx1) * (by2 - by1)
    union = area_a + area_b - inter + 1e-9
    return inter / union


def nms_per_class(
    xyxy: np.ndarray,
    scores: np.ndarray,
    cls_ids: np.ndarray,
    iou_threshold: float,
) -> np.ndarray:
    """Greedy per-class NMS. Returns indices (into the input arrays) to keep."""
    if len(xyxy) == 0:
        return np.array([], dtype=np.int64)
    keep_global: list[int] = []
    for c in np.unique(cls_ids):
        idx_c = np.where(cls_ids == c)[0]
        order = idx_c[np.argsort(-scores[idx_c])]
        while len(order) > 0:
            i = int(order[0])
            keep_global.append(i)
            if len(order) == 1:
                break
            rest = order[1:]
            ious = _box_iou_xyxy(xyxy[i], xyxy[rest])
            order = rest[ious <= iou_threshold]
    return np.array(sorted(keep_global), dtype=np.int64)


# ========== Visualization filtering (reduce false boxes) ==========
NMS_IOU = 0.45

# 1) Conf threshold for detections
CONF_THR_DEFAULT = 0.60

# 2) Remove tiny detections (watermark text / noise)
MIN_MASK_AREA_PX = 8000  # sum(mask>0.5) over pixels (stricter to drop watermark text)
MIN_BOX_AREA_PX = 8000   # (w*h) in pixels (stricter to drop tiny artifacts)

# 3) Remove detections near image borders (watermarks are often at edges)
CENTER_X_MIN_FRAC = 0.10
CENTER_X_MAX_FRAC = 0.90
CENTER_Y_MIN_FRAC = 0.05
CENTER_Y_MAX_FRAC = 0.80


def select_detections_for_draw(result: Any, conf_threshold: float) -> np.ndarray:
    """
    Return selected indices (into result.boxes arrays) for drawing.
    Filters by conf, mask area, box area, and rough center position,
    then runs per-class NMS to avoid duplicated boxes.
    """
    boxes = result.boxes
    if boxes is None or len(boxes) == 0:
        return np.array([], dtype=np.int64)

    conf = boxes.conf.detach().cpu().numpy()
    cls = boxes.cls.detach().cpu().numpy().astype(np.int64)
    xyxy = boxes.xyxy.detach().cpu().numpy()  # (n,4)

    keep = conf >= conf_threshold
    idxs = np.where(keep)[0]
    if idxs.size == 0:
        return np.array([], dtype=np.int64)

    xyxy_f = xyxy[idxs]
    conf_f = conf[idxs]
    cls_f = cls[idxs]

    # Mask area filtering (more robust than box-only)
    if result.masks is not None:
        masks = result.masks.data.detach().cpu().numpy()  # (n, h, w)
        masks_f = masks[idxs]
        mask_area = np.sum(masks_f > 0.5, axis=(1, 2))
    else:
        mask_area = np.zeros((len(idxs),), dtype=np.float32)

    box_w = xyxy_f[:, 2] - xyxy_f[:, 0]
    box_h = xyxy_f[:, 3] - xyxy_f[:, 1]
    box_area = box_w * box_h

    H, W = result.orig_shape  # (h,w)
    cx = (xyxy_f[:, 0] + xyxy_f[:, 2]) / 2
    cy = (xyxy_f[:, 1] + xyxy_f[:, 3]) / 2

    center_keep = (
        (cx >= CENTER_X_MIN_FRAC * W)
        & (cx <= CENTER_X_MAX_FRAC * W)
        & (cy >= CENTER_Y_MIN_FRAC * H)
        & (cy <= CENTER_Y_MAX_FRAC * H)
    )

    area_keep = (
        (mask_area >= MIN_MASK_AREA_PX)
        & (box_area >= MIN_BOX_AREA_PX)
        & center_keep
    )

    if not area_keep.any():
        return np.array([], dtype=np.int64)

    # Apply per-class NMS on the filtered set
    xyxy_k = xyxy_f[area_keep]
    conf_k = conf_f[area_keep]
    cls_k = cls_f[area_keep]
    kept_local = nms_per_class(xyxy_k, conf_k, cls_k, NMS_IOU)

    # Map back to original result.boxes indices
    idxs_area = idxs[area_keep]
    selected = idxs_area[kept_local]
    return selected


def summarize_image(
    result: Any,
    id_to_name: dict[int, str],
    conf_threshold: float = 0.25,
    selected_indices: np.ndarray | None = None,
) -> tuple[str, str, list[tuple[str, float, str]]]:
    """
    返回: (主判中文, 说明文字, 每张保留框的 (英文名, 置信度, 映射判读))
    """
    boxes = result.boxes
    if boxes is None or len(boxes) == 0:
        return (
            "正常",
            "未检测到分割实例（按「未见病变」处理）",
            [],
        )

    conf_all = boxes.conf.cpu().numpy()
    cls_all = boxes.cls.cpu().numpy().astype(int)

    if selected_indices is not None and selected_indices.size > 0:
        # 与可视化严格保持一致：只统计“保留下来的框”
        idx = selected_indices.astype(int)
        conf = conf_all[idx]
        cls = cls_all[idx]
    else:
        # 兜底：只按 conf_threshold 做简单过滤
        keep = conf_all >= conf_threshold
        if not keep.any():
            return (
                "正常",
                f"All instance confidence < {conf_threshold} (treated as normal)",
                [],
            )
        conf = conf_all[keep]
        cls = cls_all[keep]

    rows: list[tuple[str, float, str]] = []
    for j in range(len(conf)):
        cid = int(cls[j])
        raw = id_to_name.get(cid, str(cid))
        rows.append((raw, float(conf[j]), class_name_to_diagnosis(raw)))

    # 主判：置信度最高的“保留下来的框”
    best = int(np.argmax([r[1] for r in rows]))
    main_raw, main_conf, main_zh = rows[best]

    # 若映射失败（主判仍像英文名），在说明里提示
    note = f"主依据: {main_raw}，置信度或概率 {main_conf:.3f}"
    if main_zh == main_raw and main_raw not in ("出血", "缺血", "正常"):
        note += "（请在 CLASS_NAME_MAP 中补充该类名映射）"

    return main_zh, note, rows


def predict_image_probs(
    image_path: str | Path,
    *,
    weights_dir: str | Path | None = None,
    weights_file: str | Path | None = None,
    imgsz: int = 640,
    conf_threshold: float = CONF_THR_DEFAULT,
    temperature: float = 1.0,
) -> dict[str, Any]:
    """
    从 YOLO 分割模型输出中，构造图像侧“置信度分数”（近似概率）。
    - `p_img_stroke` = P(出血 或 缺血 | 图像)
    - `p_img_hemorrhage` = P(出血 | 图像)
    - `p_img_ischemia` = P(缺血 | 图像)
    - `p_img_normal` = P(正常 | 图像)

    说明：
    - 为了与你 `ceshiv8.py` 的“主依据: ... 置信度/conf”保持一致，
      本函数把每个诊断的分数定义为：该类在过滤后检测框里的 `max(conf)`。
      因此当主判为缺血且该类的 `max(conf)=0.943` 时，你在融合脚本里得到的 `qI` 也会是 0.943。
    - 注意：这种 qH/qI/qN 不一定满足 qH+qI+qN=1（只是分数）。在 `fusion-mode=max` 且你要求“型别概率=图像输出置信度”时，
      它能更符合你的业务直觉；若你未来需要严格校准概率，才需要重新做概率校准/softmax。
    """

    base = Path(__file__).resolve().parent
    if weights_file is not None:
        weight = Path(weights_file)
    else:
        if weights_dir is None:
            weights_dir = base / "results" / "results" / "trained_models" / "yolov8s-seg"
        weights_dir = Path(weights_dir)

        candidates: list[Path] = []
        for name in ("best.pt", "last.pt", "yolov8s-seg.pt", "yolov8s_seg.pt"):
            p = weights_dir / name
            if p.is_file():
                candidates.append(p)
        if weights_dir.is_dir():
            candidates.extend(sorted(weights_dir.glob("*.pt")))

        if not candidates:
            raise FileNotFoundError(
                "未找到 yolov8s-seg 权重文件（.pt）。请检查目录是否存在并包含权重：\n"
                f"  {weights_dir}"
            )
        weight = candidates[0]

    if not weight.is_file():
        raise FileNotFoundError(f"未找到 YOLO 权重文件：{weight}")

    image_path = Path(image_path)
    if not image_path.is_file():
        raise FileNotFoundError(f"未找到图像文件：{image_path}")

    model = YOLO(str(weight))
    id_to_name: dict[int, str] = {int(k): v for k, v in model.names.items()}

    results = model.predict(
        source=str(image_path),
        imgsz=imgsz,
        conf=conf_threshold,
        save=False,
        verbose=False,
    )
    if not results:
        # 保险兜底：当 ultralytics 未返回结果时，当作正常
        return {
            "main_zh": "正常",
            "p_img_stroke": 0.0,
            "p_img_normal": 1.0,
            "p_img_hemorrhage": 0.0,
            "p_img_ischemia": 0.0,
            "q": {"出血": 0.0, "缺血": 0.0, "正常": 1.0},
        }

    r = results[0]
    selected = select_detections_for_draw(r, conf_threshold)

    # scores: max(conf) over kept boxes per diagnosis
    s_hem, s_isch, s_norm = 0.0, 0.0, 0.0
    if selected.size > 0:
        conf_all = r.boxes.conf.detach().cpu().numpy()
        cls_all = r.boxes.cls.detach().cpu().numpy().astype(int)
        for idx in selected.tolist():
            cid = int(cls_all[idx])
            raw = id_to_name.get(cid, str(cid))
            diag = class_name_to_diagnosis(raw)
            cf = float(conf_all[idx])
            if diag == "出血":
                s_hem = max(s_hem, cf)
            elif diag == "缺血":
                s_isch = max(s_isch, cf)
            elif diag == "正常":
                s_norm = max(s_norm, cf)

    if selected.size == 0 or (s_hem <= 0.0 and s_isch <= 0.0 and s_norm <= 0.0):
        # 与 summarize_image：未检测到有效实例则当作正常
        q = {"出血": 0.0, "缺血": 0.0, "正常": 1.0}
        p_img_stroke = 0.0
        main_zh = "正常"
    else:
        # 分数=该类 max(conf)
        q = {"出血": float(s_hem), "缺血": float(s_isch), "正常": float(s_norm)}
        p_img_stroke = float(s_hem + s_isch)

        # 与 summarize_image：主依据=置信度最大的“保留下来的框”的类别
        # 这里用三类各自 max(conf) 的 argmax 近似；在你的过滤+NMS逻辑下通常一致。
        main_zh = "正常"
        if max(q["出血"], q["缺血"]) >= q["正常"]:
            main_zh = "出血" if q["出血"] >= q["缺血"] else "缺血"

    return {
        "main_zh": main_zh,
        "p_img_stroke": float(p_img_stroke),
        "p_img_normal": float(q["正常"]),
        "p_img_hemorrhage": float(q["出血"]),
        "p_img_ischemia": float(q["缺血"]),
        "q": q,
    }


def main() -> None:
    base = Path(__file__).resolve().parent
    # 默认加载你指定的 yolov8s-seg 训练权重目录
    weights_dir = base / "results" / "results" / "trained_models" / "yolov8s-seg"

    # 兼容多种常见权重命名/结构：best.pt、last.pt、或目录下任意 .pt
    candidates: list[Path] = []
    for name in ("best.pt", "last.pt", "yolov8s-seg.pt", "yolov8s_seg.pt"):
        p = weights_dir / name
        if p.is_file():
            candidates.append(p)
    if weights_dir.is_dir():
        candidates.extend(sorted(weights_dir.glob("*.pt")))

    weight = candidates[0] if candidates else weights_dir
    if not weight.is_file():
        raise FileNotFoundError(
            "未找到 yolov8s-seg 权重文件（.pt）。请检查目录是否存在并包含权重:\n"
            f"  {weights_dir}"
        )

    names = ["ceshi1.jpg", "ceshi2.jpg", "ceshi3.jpg","ceshi4.jpg"]
    paths = [base / n for n in names]
    missing = [p.name for p in paths if not p.is_file()]
    if missing:
        print("警告: 以下图片不存在，将跳过:", ", ".join(missing))
    sources = [str(p) for p in paths if p.is_file()]
    if not sources:
        raise FileNotFoundError(
            f"没有可用的测试图片，请将 {', '.join(names)} 放在:\n  {base}"
        )

    model = YOLO(str(weight))
    id_to_name: dict[int, str] = {
        int(k): v for k, v in model.names.items()
    }
    print("模型类别表 (id -> 名称):", id_to_name)
    print()

    conf_thr = CONF_THR_DEFAULT
    results = model.predict(
        source=sources,
        imgsz=640,
        conf=conf_thr,
        project=str(base / "results"),
        name="predict_ceshi",
        exist_ok=True,
        save=False,
    )

    out_dir = base / "results" / "predict_ceshi"
    filtered_out_dir = base / "results" / "predict_ceshi_filtered"
    filtered_out_dir.mkdir(parents=True, exist_ok=True)
    print(f"权重: {weight}")
    print(f"可视化输出: {out_dir}")
    print(f"过滤后可视化输出: {filtered_out_dir}")
    print("-" * 50)

    for r in results:
        selected = select_detections_for_draw(r, conf_thr)

        # 自己画过滤后的框，避免默认画法把水印/文字也框进去
        # 优先使用 r.orig_img（避免 r.path 可能是相对文件名导致找不到文件）
        img = None
        if getattr(r, "orig_img", None) is not None:
            img = r.orig_img.copy()
        else:
            fname = Path(str(r.path)).name
            p_abs = Path(str(r.path))
            p_try = p_abs if p_abs.is_file() else (base / fname)
            if p_try.is_file():
                img = cv2.imread(str(p_try))

        if img is not None:
            if selected.size > 0:
                boxes = r.boxes
                cls = boxes.cls.detach().cpu().numpy().astype(int)
                confs = boxes.conf.detach().cpu().numpy()
                xyxy = boxes.xyxy.detach().cpu().numpy()

                for idx in selected.tolist():
                    cid = int(cls[idx])
                    raw = id_to_name.get(cid, str(cid))
                    cf = float(confs[idx])
                    x1, y1, x2, y2 = xyxy[idx]
                    x1, y1, x2, y2 = map(int, [x1, y1, x2, y2])

                    color = (0, 255, 0)  # green box
                    cv2.rectangle(img, (x1, y1), (x2, y2), color, 2)

                    label = f"{raw} {cf:.2f}"
                    (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 1)
                    y_text = max(0, y1 - th - 6)
                    cv2.rectangle(img, (x1, y_text), (x1 + tw + 4, y1), color, -1)
                    cv2.putText(
                        img,
                        label,
                        (x1 + 2, y1 - 4),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.6,
                        (0, 0, 0),
                        1,
                        cv2.LINE_AA,
                    )

            out_path = filtered_out_dir / Path(str(r.path)).name
            cv2.imwrite(str(out_path), img)

        label, note, rows = summarize_image(
            r,
            id_to_name,
            conf_thr,
            selected_indices=selected,
        )
        print(f"文件: {r.path}")
        print(f"  判读: 【{label}】")
        print(f"  说明: {note}")
        if rows:
            for raw, cf, zh in rows:
                print(f"    - {raw} -> {zh}  (conf={cf:.3f})")
        print()


if __name__ == "__main__":
    main()
