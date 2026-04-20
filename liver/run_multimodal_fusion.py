"""多模态后融合评估：merge_valid 上按患者分层的 CV 对比与报告输出。"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))

from liver_ml.multimodal_fusion import default_merge_valid_paths, run_multimodal_report


def main() -> None:
    demo_d, image_d, out_d = default_merge_valid_paths(ROOT)
    parser = argparse.ArgumentParser(description="表格+图像后融合（merge_valid 双模态子集）")
    parser.add_argument("--demo-csv", type=Path, default=demo_d)
    parser.add_argument("--image-root", type=Path, default=image_d)
    parser.add_argument("--tabular-preprocess", type=Path, default=None, help="默认 outputs/models/preprocess_tree_nan.joblib")
    parser.add_argument("--tabular-model", type=Path, default=None, help="默认 outputs/models/xgb_tree_nan.joblib")
    parser.add_argument("--image-checkpoint", type=Path, default=None, help="默认 outputs/models/image/efficientnet_b0.pt")
    parser.add_argument("--output-dir", type=Path, default=out_d)
    parser.add_argument("--n-splits", type=int, default=5)
    parser.add_argument(
        "--calibration",
        choices=["none", "platt", "isotonic"],
        default="platt",
        help="折内在训练患者上拟合校准，再用于该折验证患者",
    )
    parser.add_argument("--stack-C", type=float, default=0.3, help="元学习器 L2 正则强度（C 越小越强）")
    parser.add_argument("--refit-full", action="store_true", help="在全部双模态患者上重训权重与 Stacking 并保存 fusion_deploy.joblib")
    parser.add_argument(
        "--image-preprocess",
        choices=["baseline", "fan_geom"],
        default="baseline",
        help="图像推理前预处理方式",
    )
    parser.add_argument("--fan-top-strip", type=float, default=0.12, help="fan_geom 顶部裁剪比例")
    parser.add_argument("--behsof-new-thr", type=float, default=1.0, help="BEHSOF 新标签阈值：Steatosis stage>=thr 为阳性")
    parser.add_argument("--behsof-original-thr", type=float, default=2.0, help="BEHSOF 原始标签阈值：Steatosis stage>=thr 为阳性")
    parser.add_argument("--similarity-eps", type=float, default=0.01, help="若与单模态最佳 AUC 差值<=eps，优先推荐 max 融合")
    parser.add_argument("--no-health-score", action="store_true", help="不在 OOF 输出中加入健康评分列")
    parser.add_argument("--with-personalized-shap", action="store_true", help="融合端开启个体 SHAP-like TOP 特征（耗时，建议小样本测试）")
    parser.add_argument("--shap-topk", type=int, default=5, help="融合端个体解释：TOP-K 特征数")
    parser.add_argument("--shap-sample-n", type=int, default=80, help="融合端个体解释：从 OOF 中抽样多少例计算")
    args = parser.parse_args()

    run_multimodal_report(
        demo_csv=args.demo_csv,
        image_root=args.image_root,
        tabular_preprocess_path=args.tabular_preprocess,
        tabular_model_path=args.tabular_model,
        image_checkpoint=args.image_checkpoint,
        output_dir=args.output_dir,
        n_splits=args.n_splits,
        calibration=args.calibration,
        stack_C=args.stack_C,
        refit_full=args.refit_full,
        image_preprocess=args.image_preprocess,
        fan_top_strip=args.fan_top_strip,
        behsof_new_thr=args.behsof_new_thr,
        behsof_original_thr=args.behsof_original_thr,
        similarity_eps=args.similarity_eps,
        with_health_score=not args.no_health_score,
        with_personalized_shap=args.with_personalized_shap,
        shap_topk=args.shap_topk,
        shap_sample_n=args.shap_sample_n,
    )
    print(f"报告已写入: {args.output_dir}")


if __name__ == "__main__":
    main()
