from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))

from liver_ml.image_train import ImageTrainConfig, train_image_models


def main() -> None:
    parser = argparse.ArgumentParser(description="Train ultrasound B-mode image models for NAFLD classification.")
    parser.add_argument("--epochs", type=int, default=12)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--image-size", type=int, default=224)
    parser.add_argument("--lr", type=float, default=1e-4)
    parser.add_argument("--num-workers", type=int, default=0)
    parser.add_argument("--min-epoch-samples", type=int, default=1024)
    parser.add_argument(
        "--models",
        nargs="+",
        default=[
            "simple_cnn",
            "resnet50",
            "efficientnet_b0",
            "densenet121",
            "vit_b_16",
            "yolo11s_seg",
            "yolo8s_seg",
        ],
    )
    args = parser.parse_args()

    config = ImageTrainConfig(
        epochs=args.epochs,
        batch_size=args.batch_size,
        image_size=args.image_size,
        lr=args.lr,
        num_workers=args.num_workers,
        min_epoch_samples=args.min_epoch_samples,
        models=tuple(args.models),
    )
    leaderboard = train_image_models(config)
    print(leaderboard.to_string(index=False))


if __name__ == "__main__":
    main()
