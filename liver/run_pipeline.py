"""项目根目录一键运行：设置 PYTHONPATH 后执行训练流水线。"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))

from liver_ml.train import train_all

if __name__ == "__main__":
    train_all()
