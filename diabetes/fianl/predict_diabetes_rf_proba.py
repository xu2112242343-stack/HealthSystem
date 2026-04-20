# -*- coding: utf-8 -*-
"""
使用 models/diabetes/rf_pipeline.joblib 输出「患病」概率（二分类正类 Diagnosis=1）。

说明：
  - 训练脚本 test.py 常以 ``python test.py`` 运行，joblib 内封装的类名为 ``__main__.DiabetesProbaWrapper``。
  - 本脚本在加载模型前将同名 ``DiabetesProbaWrapper`` 注册到 ``__main__``，否则反序列化会失败。

用法示例：
  # 直接运行（无参数）：尝试弹出窗口选择用户特征 JSON；取消则打印说明后退出
  python predict_diabetes_rf_proba.py

  # 单用户 JSON 字符串
  python predict_diabetes_rf_proba.py --user-input-json '{"Age":45,"BMI":26.0,...}'

  # 单用户 JSON 文件
  python predict_diabetes_rf_proba.py --user-json-file user.json

  # 无 user.json 时：内置一条虚构问卷数据，仅用于跑通模型
  python predict_diabetes_rf_proba.py --demo --pretty

  # 批量：CSV 含特征列（可有额外列，仅使用 training_meta 中的 feature_columns）
  python predict_diabetes_rf_proba.py --input-csv batch.csv --output-csv out_proba.csv

也可在代码中调用::
  from predict_diabetes_rf_proba import disease_proba_for_inputs
  out = disease_proba_for_inputs([{"Age": 45, "BMI": 27.0}])
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import __main__
import joblib
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent
DEFAULT_MODEL = ROOT / "models" / "diabetes" / "rf_pipeline.joblib"
DEFAULT_META = ROOT / "models" / "diabetes" / "training_meta.json"

# 虚构测试用户（非真实病例），字段名需与 training_meta.json 的 feature_columns 一致
DEMO_USER_FEATURES: dict[str, float] = {
    "Age": 55.0,
    "Gender": 1.0,
    "BMI": 29.0,
    "Smoking": 0.0,
    "AlcoholConsumption": 1.0,
    "PhysicalActivity": 2.0,
    "DietQuality": 5.0,
    "SleepQuality": 6.0,
    "FamilyHistoryDiabetes": 1.0,
    "GestationalDiabetes": 0.0,
    "PolycysticOvarySyndrome": 0.0,
    "PreviousPreDiabetes": 1.0,
    "Hypertension": 1.0,
    "SystolicBP": 138.0,
    "DiastolicBP": 88.0,
    "FastingBloodSugar": 118.0,
    "HbA1c": 6.2,
    "SerumCreatinine": 1.0,
    "BUNLevels": 15.0,
    "CholesterolTotal": 210.0,
    "CholesterolLDL": 130.0,
    "CholesterolHDL": 45.0,
    "CholesterolTriglycerides": 180.0,
    "AntihypertensiveMedications": 1.0,
    "AntidiabeticMedications": 0.0,
    "FrequentUrination": 1.0,
    "ExcessiveThirst": 1.0,
    "UnexplainedWeightLoss": 0.0,
    "FatigueLevels": 6.0,
    "BlurredVision": 0.0,
    "SlowHealingSores": 0.0,
    "QualityOfLifeScore": 65.0,
    "HealthLiteracy": 7.0,
}


def build_demo_user_for_meta(meta: dict[str, Any]) -> dict[str, float]:
    """按当前训练的 feature_columns 对齐；未知新列填 0.0。"""
    cols = meta.get("feature_columns") or []
    if not cols:
        raise ValueError("training_meta 中缺少 feature_columns")
    return {
        c: float(DEMO_USER_FEATURES[c]) if c in DEMO_USER_FEATURES else 0.0
        for c in cols
    }


def _prepare_feature_frame(
    X: Any,
    feature_columns: list[str],
    medians: dict[str, float] | None = None,
) -> pd.DataFrame:
    """与训练脚本 test.py 中逻辑一致，供 DiabetesProbaWrapper 反序列化后调用。"""
    if isinstance(X, pd.DataFrame):
        df = X.copy()
    elif isinstance(X, dict):
        df = pd.DataFrame([X])
    elif isinstance(X, list) and (not X or isinstance(X[0], dict)):
        df = pd.DataFrame(X)
    else:
        raise TypeError("模型输入 X 必须是 pandas.DataFrame 或 dict 或 dict 列表。")

    df = df.reindex(columns=feature_columns)
    df = df.apply(pd.to_numeric, errors="coerce")
    df = df.mask((df == np.inf) | (df == -np.inf), np.nan)
    df = df.astype(float)
    return df


class DiabetesProbaWrapper:
    """
    与 test.py 中同名类保持一致，便于 unpickle ``__main__.DiabetesProbaWrapper``。
    """

    def __init__(
        self,
        base_model: Any,
        feature_columns: list[str],
        feature_medians: dict[str, float] | pd.Series | None = None,
        uncertain_prior: float | None = None,
    ):
        self.base_model = base_model
        self._tolerant_feature_columns = list(feature_columns)
        self.is_tolerant_model = True
        self.uncertain_prior = uncertain_prior

        if feature_medians is None:
            self._medians_dict = {}
        elif isinstance(feature_medians, pd.Series):
            self._medians_dict = feature_medians.to_dict()
        else:
            self._medians_dict = dict(feature_medians)

    def predict_proba(self, X: Any) -> np.ndarray:
        Xp = _prepare_feature_frame(
            X=X,
            feature_columns=self._tolerant_feature_columns,
        )
        proba = np.asarray(self.base_model.predict_proba(Xp), dtype=float)
        mat = Xp.to_numpy(dtype=float, copy=False)
        row_all_nan = np.isnan(mat).all(axis=1)
        if row_all_nan.any():
            proba = proba.copy()
            proba[row_all_nan, 0] = 1.0
            proba[row_all_nan, 1] = 0.0
        return proba

    def predict(self, X: Any) -> np.ndarray:
        Xp = _prepare_feature_frame(
            X=X,
            feature_columns=self._tolerant_feature_columns,
        )
        if hasattr(self.base_model, "predict"):
            return self.base_model.predict(Xp)
        p = self.base_model.predict_proba(Xp)[:, 1]
        return (p >= 0.5).astype(int)


# 注册到 __main__，匹配 ``python test.py`` 保存的 pickle 类路径
setattr(__main__, "DiabetesProbaWrapper", DiabetesProbaWrapper)


def choose_user_json_path() -> Path | None:
    """无参数运行时：图形界面选 JSON；失败则退回命令行输入路径。"""
    try:
        import tkinter as tk  # type: ignore
        from tkinter import filedialog  # type: ignore

        root = tk.Tk()
        root.withdraw()
        root.update()
        p = filedialog.askopenfilename(
            title="选择用户特征 JSON（单用户一个对象）",
            filetypes=[("JSON", "*.json"), ("All files", "*.*")],
        )
        if not p:
            return None
        return Path(p)
    except Exception:
        s = input("请输入用户特征 JSON 文件路径（回车退出）：").strip()
        if not s:
            return None
        return Path(s)


def _load_meta(meta_path: Path) -> dict[str, Any]:
    with open(meta_path, "r", encoding="utf-8") as f:
        return json.load(f)


def load_rf_pipeline(
    model_path: Path | None = None,
    meta_path: Path | None = None,
) -> tuple[Any, dict[str, Any]]:
    mp = Path(model_path) if model_path else DEFAULT_MODEL
    mt = Path(meta_path) if meta_path else DEFAULT_META
    if not mp.is_file():
        raise FileNotFoundError(f"找不到模型文件: {mp}")
    if not mt.is_file():
        raise FileNotFoundError(f"找不到元数据: {mt}")
    meta = _load_meta(mt)
    model = joblib.load(mp)
    return model, meta


def _threshold_from_meta(meta: dict[str, Any]) -> float | None:
    m = meta.get("metrics") or {}
    thr = m.get("threshold_selected")
    if thr is None:
        return None
    return float(thr)


def disease_proba_for_inputs(
    X: pd.DataFrame | dict[str, Any] | list[dict[str, Any]],
    *,
    model_path: Path | str | None = None,
    meta_path: Path | str | None = None,
    threshold: float | None = None,
    use_meta_threshold: bool = False,
) -> dict[str, Any]:
    """
    对一条或多条样本输出患病概率。

    返回字段：
      - ``disease_proba``: 正类（患病）概率，shape (n,)
      - ``no_disease_proba``: 负类概率
      - ``predicted_class_0.5``: 以 0.5 为阈值的类别
      - ``predicted_class_custom``: 若传入 threshold 或 use_meta_threshold 且可得阈值
    """
    model, meta = load_rf_pipeline(
        Path(model_path) if model_path else None,
        Path(meta_path) if meta_path else None,
    )
    proba = np.asarray(model.predict_proba(X), dtype=float)
    if proba.ndim != 2 or proba.shape[1] < 2:
        raise ValueError(f"期望 predict_proba 形状为 (n, 2)，实际: {proba.shape}")

    p_pos = proba[:, 1]
    p_neg = proba[:, 0]
    pred_05 = (p_pos >= 0.5).astype(int)

    thr: float | None = None
    if threshold is not None:
        thr = float(threshold)
    elif use_meta_threshold:
        thr = _threshold_from_meta(meta)

    pred_custom: np.ndarray | None = None
    if thr is not None:
        pred_custom = (p_pos >= thr).astype(int)

    out: dict[str, Any] = {
        "disease_proba": p_pos.tolist(),
        "no_disease_proba": p_neg.tolist(),
        "predicted_class_0_5": pred_05.tolist(),
        "threshold_used": thr,
        "predicted_class_at_threshold": pred_custom.tolist() if pred_custom is not None else None,
        "label_meaning": "class 0=无糖尿病(Diagnosis=0), class 1=患病(Diagnosis=1)",
    }
    return out


def main() -> None:
    ap = argparse.ArgumentParser(
        description="糖尿病问卷 RF 管道：输出患病概率（rf_pipeline.joblib）",
        epilog="不传任何输入参数时，会尝试用窗口选择 JSON；也可用 --demo（内置虚构用户）或 --user-json-file / --input-csv。",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("--model", type=Path, default=DEFAULT_MODEL, help="rf_pipeline.joblib 路径")
    ap.add_argument("--meta", type=Path, default=DEFAULT_META, help="training_meta.json 路径")
    ap.add_argument(
        "--user-input-json",
        type=str,
        default=None,
        help='单用户特征 JSON 对象字符串，如 \'{"Age":45,...}\'',
    )
    ap.add_argument("--user-json-file", type=Path, default=None, help="单用户特征 JSON 文件（UTF-8）")
    ap.add_argument(
        "--demo",
        action="store_true",
        help="使用内置虚构问卷用户跑通预测（无需 user.json）",
    )
    ap.add_argument("--input-csv", type=Path, default=None, help="批量预测输入 CSV")
    ap.add_argument(
        "--output-csv",
        type=Path,
        default=None,
        help="批量预测输出 CSV（需与 --input-csv 同用）",
    )
    ap.add_argument(
        "--threshold",
        type=float,
        default=None,
        help="自定义二分类阈值（高于=预测患病）；默认仅输出概率，不强制该列",
    )
    ap.add_argument(
        "--use-meta-threshold",
        action="store_true",
        help="使用 training_meta.json 中 metrics.threshold_selected 作为阈值",
    )
    ap.add_argument("--pretty", action="store_true", help="JSON 缩进打印")
    args = ap.parse_args()

    if args.user_input_json and args.user_json_file:
        raise SystemExit("请只使用 --user-input-json 或 --user-json-file 之一。")
    if args.demo and (args.user_input_json or args.user_json_file or args.input_csv):
        raise SystemExit("--demo 不能与 --user-json-file / --user-input-json / --input-csv 同时使用。")
    if (args.input_csv is None) ^ (args.output_csv is None):
        raise SystemExit("--input-csv 与 --output-csv 需同时指定或同时省略。")

    indent = 2 if args.pretty else None

    if args.input_csv is not None:
        assert args.output_csv is not None
        model, meta = load_rf_pipeline(args.model, args.meta)
        feature_columns: list[str] = list(meta.get("feature_columns") or [])
        if not feature_columns:
            raise SystemExit("training_meta.json 中缺少 feature_columns")
        if not args.input_csv.is_file():
            raise SystemExit(f"找不到输入 CSV: {args.input_csv}")
        df = pd.read_csv(args.input_csv, encoding="utf-8-sig")
        X = df.reindex(columns=feature_columns)
        proba = np.asarray(model.predict_proba(X), dtype=float)
        df_out = df.copy()
        df_out["disease_proba"] = proba[:, 1]
        df_out["no_disease_proba"] = proba[:, 0]
        df_out["predicted_class_0_5"] = (proba[:, 1] >= 0.5).astype(int)
        thr = None
        if args.threshold is not None:
            thr = float(args.threshold)
        elif args.use_meta_threshold:
            thr = _threshold_from_meta(meta)
        if thr is not None:
            df_out["threshold_used"] = thr
            df_out["predicted_class_at_threshold"] = (proba[:, 1] >= thr).astype(int)
        df_out.to_csv(args.output_csv, index=False, encoding="utf-8-sig")
        print(f"已写入: {args.output_csv}（共 {len(df_out)} 行）")
        return

    if args.demo:
        meta_demo = _load_meta(Path(args.meta))
        user = build_demo_user_for_meta(meta_demo)
        print("（演示）使用内置虚构用户特征，非真实临床数据。\n")

    elif args.user_json_file is not None:
        if not args.user_json_file.is_file():
            raise SystemExit(f"找不到 JSON 文件: {args.user_json_file}")
        with open(args.user_json_file, "r", encoding="utf-8") as f:
            user = json.load(f)
        if not isinstance(user, dict):
            raise SystemExit("JSON 顶层须为对象（字典）。")
    elif args.user_input_json:
        user = json.loads(args.user_input_json)
        if not isinstance(user, dict):
            raise SystemExit("JSON 顶层须为对象（字典）。")
    else:
        picked = choose_user_json_path()
        if picked is None:
            print(
                "未选择输入文件。\n"
                "请任选其一：\n"
                "  --demo --pretty                 内置虚构用户，无需 JSON 文件\n"
                "  --user-json-file user.json     单用户特征（JSON 对象）\n"
                "  --user-input-json \"{...}\"     同上（注意 PowerShell 引号）\n"
                "  --input-csv a.csv --output-csv b.csv   批量\n"
                "加 --pretty 可缩进打印 JSON 结果。"
            )
            return
        if not picked.is_file():
            raise SystemExit(f"找不到 JSON 文件: {picked}")
        with open(picked, "r", encoding="utf-8") as f:
            user = json.load(f)
        if not isinstance(user, dict):
            raise SystemExit("JSON 顶层须为对象（字典）。")

    out = disease_proba_for_inputs(
        user,
        model_path=args.model,
        meta_path=args.meta,
        threshold=args.threshold,
        use_meta_threshold=args.use_meta_threshold,
    )
    # 单条时扁平化便于阅读
    if len(out["disease_proba"]) == 1:
        flat = {
            "disease_proba": out["disease_proba"][0],
            "no_disease_proba": out["no_disease_proba"][0],
            "predicted_class_0_5": out["predicted_class_0_5"][0],
            "label_meaning": out["label_meaning"],
        }
        if args.demo:
            flat["demo_user_features"] = user
        if out["threshold_used"] is not None:
            flat["threshold_used"] = out["threshold_used"]
        if out["predicted_class_at_threshold"] is not None:
            flat["predicted_class_at_threshold"] = out["predicted_class_at_threshold"][0]
        print(json.dumps(flat, ensure_ascii=False, indent=indent))
    else:
        print(json.dumps(out, ensure_ascii=False, indent=indent))


if __name__ == "__main__":
    main()
