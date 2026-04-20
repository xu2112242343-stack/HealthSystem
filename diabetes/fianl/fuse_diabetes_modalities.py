# -*- coding: utf-8 -*-
"""
将问卷 RF（predict_diabetes_rf_proba）与眼底图（predict_dr_image_3class）的患病概率融合。

规则：总患病概率 = max(问卷患病概率, 眼底患病概率)。

用法示例::

  from fuse_diabetes_modalities import fused_disease_proba_max, predict_fused_for_user_and_image

  out = predict_fused_for_user_and_image(
      {"Age": 45.0, ...},
      Path("fundus.jpg"),
  )
  # out["fused_disease_proba"], out["questionnaire_disease_proba"], out["image_disease_proba"]

  python fuse_diabetes_modalities.py --user-json-file user.json --image fundus.jpg --pretty

  # 与另两个脚本类似：演示用户 + 弹窗选图（可不传 --image）
  python fuse_diabetes_modalities.py --demo --pretty

  # 演示问卷 + 指定眼底图一次融合（示例路径按本机修改）
  python fuse_diabetes_modalities.py --demo --image "E:\\糖尿病图片\\data\\data\\1000_left.jpeg" --pretty
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from predict_diabetes_rf_proba import (
    DEFAULT_META,
    build_demo_user_for_meta,
    disease_proba_for_inputs,
)
from predict_dr_image_3class import choose_image_interactively, predict_image_disease_proba


def fused_disease_proba_max(questionnaire_disease_proba: float, image_disease_proba: float) -> float:
    """取两路患病概率的较大值作为融合后的患病概率。"""
    return max(float(questionnaire_disease_proba), float(image_disease_proba))


def predict_fused_for_user_and_image(
    user_features: dict[str, Any],
    image_path: Path | str,
    *,
    model_path: Path | str | None = None,
    meta_path: Path | str | None = None,
    ckpt_path: Path | str | None = None,
    no_cuda: bool = False,
    threshold: float | None = None,
    use_meta_threshold: bool = False,
) -> dict[str, Any]:
    """
    单用户：问卷 JSON 对象 + 单张眼底图 → 两路概率与 max 融合结果。
    """
    img = Path(image_path)
    q = disease_proba_for_inputs(
        user_features,
        model_path=model_path,
        meta_path=meta_path,
        threshold=threshold,
        use_meta_threshold=use_meta_threshold,
    )
    im = predict_image_disease_proba(img, ckpt_path=ckpt_path, no_cuda=no_cuda)

    p_q = float(q["disease_proba"][0])
    p_i = float(im["disease_proba"])
    p_f = fused_disease_proba_max(p_q, p_i)

    return {
        "fused_disease_proba": p_f,
        "fused_rule": "max(questionnaire_disease_proba, image_disease_proba)",
        "questionnaire_disease_proba": p_q,
        "image_disease_proba": p_i,
        "questionnaire_detail": {
            "predicted_class_0_5": q["predicted_class_0_5"][0],
            "threshold_used": q.get("threshold_used"),
            "predicted_class_at_threshold": (
                q["predicted_class_at_threshold"][0]
                if q.get("predicted_class_at_threshold") is not None
                else None
            ),
        },
        "image_detail": {
            "task_mode": im["task_mode"],
            "predicted_class_0_5": im["predicted_class_0_5"],
            "pred_argmax_idx": im["pred_argmax_idx"],
            "per_class_proba": im.get("per_class_proba"),
            "class_names": im.get("class_names"),
            "image_path": im.get("image_path"),
        },
        "fused_predicted_class_0_5": int(p_f >= 0.5),
    }


def main() -> None:
    ap = argparse.ArgumentParser(
        description="融合问卷与眼底图的患病概率（取 max）",
        epilog=(
            "问卷输入三选一：--demo；或 --user-json-file 路径；或把 JSON 路径写成第一个位置参数（与上一种等价）。"
            "图像：--image 可省略，省略时弹窗选择。"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument(
        "user_json_positional",
        nargs="?",
        type=Path,
        default=None,
        metavar="USER.json",
        help="问卷 JSON 路径；与 --user-json-file 二选一（可省略该位置参数，改用 --user-json-file）",
    )
    src = ap.add_mutually_exclusive_group(required=False)
    src.add_argument("--user-json-file", type=Path, default=None, help="单用户特征 JSON")
    src.add_argument(
        "--demo",
        action="store_true",
        help="使用与 predict_diabetes_rf_proba --demo 相同的内置虚构问卷特征",
    )
    ap.add_argument(
        "--image",
        type=Path,
        default=None,
        help="眼底图像路径；省略则弹窗选择",
    )
    ap.add_argument("--model", type=Path, default=None, help="rf_pipeline.joblib（可选）")
    ap.add_argument("--meta", type=Path, default=None, help="training_meta.json（可选，--demo 时用于对齐特征列）")
    ap.add_argument("--ckpt", type=Path, default=None, help="眼底 best.pt（可选）")
    ap.add_argument("--no_cuda", action="store_true", help="眼底推理强制 CPU")
    ap.add_argument("--threshold", type=float, default=None, help="问卷 RF 自定义阈值（可选）")
    ap.add_argument("--use-meta-threshold", action="store_true", help="问卷使用 meta 中阈值")
    ap.add_argument("--pretty", action="store_true", help="JSON 缩进打印")
    args = ap.parse_args()

    json_path: Path | None = args.user_json_file or args.user_json_positional
    if args.user_json_file is not None and args.user_json_positional is not None:
        if Path(args.user_json_file).resolve() != Path(args.user_json_positional).resolve():
            raise SystemExit(
                "请只指定一种问卷路径：--user-json-file 与第一个位置参数 USER.json 不要同时给不同文件。"
            )
    if args.demo and json_path is not None:
        raise SystemExit("不能同时使用 --demo 与问卷 JSON。")
    if not args.demo and json_path is None:
        raise SystemExit(
            "请指定问卷来源：--demo，或 --user-json-file 路径，或 "
            "python fuse_diabetes_modalities.py USER.json --image ...（把 JSON 作为第一个参数）。"
        )

    meta_pf = Path(args.meta) if args.meta is not None else Path(DEFAULT_META)

    if args.demo:
        if not meta_pf.is_file():
            raise SystemExit(f"找不到 training_meta（--demo 需要）: {meta_pf}")
        with open(meta_pf, "r", encoding="utf-8") as f:
            user = build_demo_user_for_meta(json.load(f))
        print("（演示）使用内置虚构问卷特征，非真实临床数据。\n")
    else:
        jp = json_path
        assert jp is not None
        if not jp.is_file():
            raise SystemExit(f"找不到 JSON: {jp}")
        with open(jp, "r", encoding="utf-8") as f:
            user = json.load(f)
        if not isinstance(user, dict):
            raise SystemExit("用户 JSON 顶层须为对象")

    image_path = args.image
    if image_path is None:
        image_path = choose_image_interactively()
        if image_path is None:
            raise SystemExit("未选择图片，退出。")
    if not image_path.is_file():
        raise SystemExit(f"找不到图片: {image_path}")

    out = predict_fused_for_user_and_image(
        user,
        image_path,
        model_path=args.model,
        meta_path=args.meta,
        ckpt_path=args.ckpt,
        no_cuda=args.no_cuda,
        threshold=args.threshold,
        use_meta_threshold=args.use_meta_threshold,
    )
    indent = 2 if args.pretty else None
    print(json.dumps(out, ensure_ascii=False, indent=indent))


if __name__ == "__main__":
    main()
