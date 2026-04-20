from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))

from liver_ml.image_train import predict_images


def main() -> None:
    parser = argparse.ArgumentParser(description="Predict NAFLD probability for one or more ultrasound images.")
    parser.add_argument("--checkpoint", required=True, help="Path to a trained image model checkpoint.")
    parser.add_argument("--images", nargs="+", required=True, help="One or more image paths.")
    args = parser.parse_args()

    out = predict_images(args.checkpoint, args.images)
    print(out.to_string(index=False))


if __name__ == "__main__":
    main()
