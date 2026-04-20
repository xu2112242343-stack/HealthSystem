from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import torch
from torch.utils.data import DataLoader

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))

from liver_ml.config import (  # noqa: E402
    CAP_COL,
    CAP_NAFLD_THRESHOLD,
    CATEGORICAL_FEATURES,
    LIVERDISEASE_CSV,
    LITE_CATEGORICAL_FEATURES,
    MODEL_DIR,
    NUMERIC_FEATURES,
    PA_BINARY,
    STROKE_METABOLISM_CSV,
    DATA_CSV,
)
from liver_ml.image_train import (  # noqa: E402
    PATTERN as IMAGE_PATTERN,
    UltrasoundDataset,
    build_model,
    build_transforms,
    predict_loader,
    summarize_predictions,
)
from liver_ml.metrics_tools import classification_metrics  # noqa: E402
from liver_ml.feature_display import FEATURE_DISPLAY_NAMES  # noqa: E402
from liver_ml.plot_eval import confidence_bucket_table, expected_calibration_error  # noqa: E402
from liver_ml.preprocess import (  # noqa: E402
    build_feature_matrix,
    derive_nafld_label_cap,
    feature_engineering,
    merge_liverdisease,
    merge_stroke_metabolism_supplement,
    replace_sentinels,
)

IMAGE_ROOT_LABEL_MAP = {"Non-NAFLD": 0, "NAFLD": 1}
CATEGORICAL_VALUE_HINTS: dict[str, str] = {
    "RIAGENDR": "1=男, 2=女",
    "ALQ111": "1=是(饮酒), 2=否",
    "SMQ020": "1=是, 2=否, 7=拒答, 9=不知道",
    "HCV_AB_POS": "1=阳性, 0=阴性",
}


def _prompt_str(name: str, default: str | None = None) -> str:
    if default is None:
        return input(f"{name}: ").strip()
    raw = input(f"{name} [默认: {default}]: ").strip()
    return raw or default


def _parse_float_or_none(s: str) -> float | None:
    s = s.strip()
    if not s:
        return None
    return float(s)


def _parse_int_list(s: str) -> list[int]:
    s = s.strip()
    if not s:
        return []
    return [int(x.strip()) for x in s.split(",") if x.strip()]


def _parse_str_list(s: str) -> list[str]:
    s = s.strip()
    if not s:
        return []
    return [x.strip() for x in s.split(",") if x.strip()]


def _load_json_obj(text_or_path: str) -> dict:
    p = Path(text_or_path)
    if p.exists() and p.is_file():
        return json.loads(p.read_text(encoding="utf-8"))
    return json.loads(text_or_path)


def _prompt_manual_fields_rows() -> pd.DataFrame:
    """
    逐项交互输入表格特征（中文提示），空值表示缺失。
    默认使用当前配置下的 NUMERIC_FEATURES + CATEGORICAL_FEATURES。
    """
    n_samples_raw = _prompt_str("请输入样本条数", "1")
    n_samples = max(int(n_samples_raw), 1)

    feature_cols = list(NUMERIC_FEATURES) + list(CATEGORICAL_FEATURES)
    # 你希望手动测试不再填写该字段（后续由 feature_engineering 从 LBDHCI 派生，缺失则视为缺失）
    feature_cols = [c for c in feature_cols if c != "HCV_AB_POS"]
    rows: list[dict] = []
    print("\n开始逐项录入：直接回车表示缺失。")
    for i in range(n_samples):
        print(f"\n--- 样本 {i + 1}/{n_samples} ---")
        row: dict[str, float | int | str] = {}

        seqn_text = _prompt_str("SEQN（可选）", "")
        if seqn_text:
            try:
                row["SEQN"] = int(float(seqn_text))
            except ValueError:
                row["SEQN"] = seqn_text

        for col in feature_cols:
            zh = FEATURE_DISPLAY_NAMES.get(col, col)
            hint = ""
            if col in CATEGORICAL_FEATURES and col in CATEGORICAL_VALUE_HINTS:
                hint = f" [{CATEGORICAL_VALUE_HINTS[col]}]"
            val = _prompt_str(f"{zh} ({col}){hint}", "")
            if not val:
                continue
            # 尽量转数值，失败则保留字符串
            try:
                num = float(val)
                row[col] = int(num) if num.is_integer() else num
            except ValueError:
                row[col] = val

        label_text = _prompt_str("真值标签 label（0/1，可选；填了才能计算准确率/AUC）", "")
        if label_text:
            row["label"] = int(float(label_text))
        rows.append(row)
    return pd.DataFrame(rows)


def _confidence_stats_from_arrays(y_true: np.ndarray, y_prob: np.ndarray, threshold: float) -> dict[str, float]:
    y_true = np.asarray(y_true).astype(int)
    y_prob = np.asarray(y_prob).astype(float)
    y_pred = (y_prob >= threshold).astype(int)
    conf = np.maximum(y_prob, 1.0 - y_prob)
    correct = y_pred == y_true
    high_conf_mask = conf >= 0.80
    return {
        "ece": float(expected_calibration_error(y_true, y_prob, n_bins=10)),
        "mean_confidence": float(np.mean(conf)),
        "mean_confidence_correct": float(np.mean(conf[correct])) if np.any(correct) else float("nan"),
        "mean_confidence_wrong": float(np.mean(conf[~correct])) if np.any(~correct) else float("nan"),
        "high_conf_coverage_0.8": float(np.mean(high_conf_mask)),
        "high_conf_accuracy_0.8": float(np.mean(correct[high_conf_mask])) if np.any(high_conf_mask) else float("nan"),
    }


def _load_tabular_asset(model_kind: str, device: str) -> dict:
    """
    返回：{kind, model, preprocess(optional)}
    kind: xgb | lasso_cv | stacking
    """
    model_kind = model_kind.strip().lower()
    canonical_kind = model_kind
    if model_kind in {"xgb", "xgb_tree_nan", "missing_robust_xgb_tree_nan"}:
        canonical_kind = "xgb"
        preprocess_path = MODEL_DIR / "preprocess_tree_nan.joblib"
        model_path = MODEL_DIR / "xgb_model.joblib"
    elif model_kind in {"lasso_cv", "lasso"}:
        canonical_kind = "lasso_cv"
        preprocess_path = MODEL_DIR / "preprocess.joblib"
        model_path = MODEL_DIR / "lasso_cv_model.joblib"
    elif model_kind in {"stacking", "stack", "missing_robust_stacking"}:
        canonical_kind = "stacking"
        preprocess_path = None
        model_path = MODEL_DIR / "stacking_model.joblib"
    else:
        raise ValueError(f"Unsupported tabular model kind: {model_kind}")

    # device 不用于 sklearn；保持接口一致
    if preprocess_path is not None:
        preprocess = joblib.load(preprocess_path)
    else:
        preprocess = None
    model = joblib.load(model_path)
    return {"kind": canonical_kind, "model": model, "preprocess": preprocess, "device": device}


def _prepare_tabular_df_for_prediction(raw_df: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series]:
    """
    对交互输入做与训练尽可能一致的“特征构造+派生列”。
    这里不做 apply_exclusions（因为你要允许缺失/任意输入）。
    """
    df = raw_df.copy()
    if "SEQN" in df.columns:
        # 补充 merged_liver_research 中可能缺失的列（训练里做过 left join）
        df = merge_liverdisease(df, liver_path=LIVERDISEASE_CSV)
        df = merge_stroke_metabolism_supplement(df, stroke_path=STROKE_METABOLISM_CSV)

    # 保证 feature_engineering/replace_sentinels 需要的列存在（缺失列用 NaN）
    must_exist = set(NUMERIC_FEATURES) | set(CATEGORICAL_FEATURES)
    must_exist |= {
        "LBXTR",
        "LBXSTR",
        "LBXGLU",
        "LBXSATSI",
        "LBXSASSI",
        "LBDSALSI",
        "LBDSGBSI",
        "LBXSCH",
        "LBDHDD",
        "BMXWAIST",
        "BMXHT",
        "LBDHCI",
    }
    for c in must_exist:
        if c not in df.columns:
            df[c] = np.nan

    df = replace_sentinels(df)
    df = feature_engineering(df)

    # 真值优先级：label/y_true/y（前端测试集） > CAP 推导（训练口径）
    y = None
    for y_col in ("label", "y_true", "y"):
        if y_col in df.columns:
            y = pd.to_numeric(df[y_col], errors="coerce")
            break
    if y is None:
        y = derive_nafld_label_cap(df)

    X, _, _ = build_feature_matrix(df, NUMERIC_FEATURES, CATEGORICAL_FEATURES, PA_BINARY)
    return X, y


def _predict_tabular(asset: dict, X: pd.DataFrame) -> np.ndarray:
    kind = asset["kind"]
    model = asset["model"]
    preprocess = asset["preprocess"]
    if kind == "xgb":
        Xt = preprocess.transform(X)
        return np.asarray(model.predict_proba(Xt)[:, 1], dtype=float)
    if kind == "lasso_cv":
        Xt = preprocess.transform(X)
        return np.asarray(model.predict_proba(Xt)[:, 1], dtype=float)
    if kind == "stacking":
        # stacking_model 内部含 Pipeline(preprocess_tree)；直接喂 X 即可
        return np.asarray(model.predict_proba(X)[:, 1], dtype=float)
    raise ValueError(f"Unknown asset kind: {kind}")


def _load_tabular_inputs_interactive(args) -> tuple[pd.DataFrame, pd.Series]:
    mode = args.table_input_mode
    if not mode:
        mode = _prompt_str("表格输入来源模式(manual/csv)", "manual").lower()

    if mode == "manual":
        manual_text = args.manual_json
        if not manual_text:
            manual_text = _prompt_str("请输入手动 JSON（单个样本 dict 或样本列表 list）")
        obj = _load_json_obj(manual_text)
        rows = obj if isinstance(obj, list) else [obj]
        raw_df = pd.DataFrame(rows)
        X, y = _prepare_tabular_df_for_prediction(raw_df)
        return X, y

    if mode == "manual_fields":
        raw_df = _prompt_manual_fields_rows()
        X, y = _prepare_tabular_df_for_prediction(raw_df)
        return X, y

    if mode == "csv":
        csv_path = args.table_csv_path or _prompt_str("CSV 文件路径", str(DATA_CSV))
        csv_path = str(Path(csv_path).resolve())
        idxs: list[int] = []
        if args.table_row_idxs:
            idxs = args.table_row_idxs
        seqns: list[int] = []
        if args.table_row_seqns:
            seqns = args.table_row_seqns

        if not idxs and not seqns:
            choice = _prompt_str("从 CSV 选行：输入 1=索引(idx) 或 2=SEQN", "1")
            if choice.strip() == "2":
                raw_seqn = _prompt_str("SEQN 列表（逗号分隔）")
                seqns = _parse_int_list(raw_seqn)
            else:
                raw_idxs = _prompt_str("行索引列表（逗号分隔，默认 0 起）")
                idxs = _parse_int_list(raw_idxs)

        raw_df_full = pd.read_csv(csv_path, low_memory=False)
        if seqns:
            if "SEQN" not in raw_df_full.columns:
                raise ValueError("CSV 中不存在 SEQN 列，无法用 SEQN 选行")
            raw_df = raw_df_full[raw_df_full["SEQN"].isin(seqns)].copy()
        else:
            raw_df = raw_df_full.iloc[idxs].copy()
        if raw_df.empty:
            raise ValueError("选取到的行为空，请检查索引/SEQN")
        X, y = _prepare_tabular_df_for_prediction(raw_df)
        return X, y

    raise ValueError(f"Unsupported table_input_mode: {mode}")


def _evaluate_tabular_two_models(
    asset_a: dict,
    asset_b: dict,
    X: pd.DataFrame,
    y: pd.Series,
    threshold: float,
    output_dir: Path,
) -> dict:
    y_np = y.to_numpy()
    available = ~pd.isna(y_np)
    if available.sum() < 1:
        print("警告：输入中 CAP 缺失或无效，无法计算准确率/AUC 等“需要真值”的指标。将只输出概率与置信度分箱(不基于真值)。")

    p_a = _predict_tabular(asset_a, X)
    p_b = _predict_tabular(asset_b, X)

    # 构造输出表
    out = X.copy()
    out.insert(0, "y_true", y_np)
    out["prob_a"] = p_a
    out["prob_b"] = p_b
    out["pred_a"] = (p_a >= threshold).astype(int)
    out["pred_b"] = (p_b >= threshold).astype(int)
    pred_path = output_dir / "interactive_tabular_predictions.csv"
    out.to_csv(pred_path, index=False)

    metrics = {"threshold_used": threshold, "n_input_samples": int(len(X)), "n_with_label": int(available.sum())}
    metrics_rows = []

    for tag, probs in [("a", p_a), ("b", p_b)]:
        if available.sum() >= 1:
            y_true = y_np[available].astype(int)
            y_prob = probs[available].astype(float)
            m = classification_metrics(y_true, y_prob, threshold=threshold, auc_ci=True)
            m["ece"] = float(expected_calibration_error(y_true, y_prob, n_bins=10))
            conf_stats = _confidence_stats_from_arrays(y_true, y_prob, threshold=threshold)
            m.update(conf_stats)
            bucket_df = confidence_bucket_table(y_true, y_prob, n_bins=10)
            bucket_df.to_csv(output_dir / f"interactive_tabular_confidence_buckets_{tag}.csv", index=False)
        else:
            m = {"note": "no_label_available"}
        m["model_tag"] = tag
        metrics_rows.append(m)

    # 终端直观展示：每个样本的两模型概率与预测标签
    preview_cols = ["prob_a", "pred_a", "prob_b", "pred_b"]
    if "SEQN" in X.columns:
        preview_cols = ["SEQN"] + preview_cols
    preview_df = out[preview_cols].copy()
    print("\n样本级预测结果（概率 + 预测标签）:")
    print(preview_df.to_string(index=False))

    metrics_df = pd.DataFrame(metrics_rows)
    metrics_df_path = output_dir / "interactive_tabular_metrics_comparison.csv"
    metrics_df.to_csv(metrics_df_path, index=False)
    metrics["metrics_table_path"] = str(metrics_df_path.resolve())
    metrics["predictions_path"] = str(pred_path.resolve())
    return metrics


IMAGE_LABEL_INFER_REGEX = re.compile(r"^patient_\d+_slice_\d+$")


def _infer_image_meta(image_path: Path) -> tuple[str, int, int]:
    """
    返回：patient_id(str), slice_id(int), y_true(int) 其中 y_true 可能失败会抛错
    """
    # label: 由父目录名推断
    parent_name = image_path.parent.name
    if parent_name not in IMAGE_ROOT_LABEL_MAP:
        raise ValueError(f"无法从父目录推断标签: {parent_name}（期望 Non-NAFLD 或 NAFLD）")
    y_true = IMAGE_ROOT_LABEL_MAP[parent_name]

    m = IMAGE_PATTERN.match(image_path.stem)
    if m is None:
        raise ValueError(f"无法从文件名解析 patient_id/slice_id: {image_path.name}")
    patient_id = m.group("patient_id")
    slice_id = int(m.group("slice_id"))
    return patient_id, slice_id, y_true


def _load_image_test_df_interactive(args) -> pd.DataFrame:
    image_paths = args.image_paths
    if not image_paths:
        raw = _prompt_str("输入图片路径列表（逗号分隔）")
        image_paths = _parse_str_list(raw)
    image_paths = [str(Path(p).resolve()) for p in image_paths]
    if not image_paths:
        raise ValueError("未提供图片路径")
    out_rows = []
    for p in image_paths:
        ip = Path(p)
        if not ip.exists():
            raise FileNotFoundError(ip)
        try:
            patient_id, slice_id, y_true = _infer_image_meta(ip)
        except Exception as e:
            print(f"解析失败：{ip} -> {e}")
            patient_id = _prompt_str("请输入 patient_id（例如 patient_001）")
            slice_id = int(_prompt_str("请输入 slice_id（整数）"))
            y_true = int(_prompt_str("请输入标签 y_true（0/1，对应 Non-NAFLD/NAFLD）"))
        out_rows.append(
            {
                "path": str(ip.resolve()),
                "patient_id": patient_id,
                "slice_id": int(slice_id),
                "label": float(y_true),
            }
        )
    return pd.DataFrame(out_rows)


def _evaluate_image_two_models(
    ckpt_a: Path,
    ckpt_b: Path,
    test_df: pd.DataFrame,
    threshold_override: float | None,
    batch_size: int,
    num_workers: int,
    device: str,
    output_dir: Path,
) -> dict:
    def eval_one(ckpt_path: Path, tag: str) -> dict:
        ckpt = torch.load(ckpt_path, map_location="cpu")
        model_name = ckpt["model_name"]
        image_size = int(ckpt.get("image_size", 224))
        threshold = float(ckpt.get("threshold", 0.5)) if threshold_override is None else float(threshold_override)

        model = build_model(model_name).to(device)
        model.load_state_dict(ckpt["state_dict"])
        model.eval()

        _, eval_tf = build_transforms(image_size)
        ds = UltrasoundDataset(test_df, transform=eval_tf)
        loader = DataLoader(
            ds,
            batch_size=batch_size,
            shuffle=False,
            num_workers=num_workers,
            pin_memory=(device == "cuda"),
        )

        slice_pred = predict_loader(model, loader, device=device)
        summary, patient_pred = summarize_predictions(slice_pred, threshold=threshold)
        bucket_df = confidence_bucket_table(patient_pred["label"].to_numpy(), patient_pred["prob"].to_numpy(), n_bins=10)
        bucket_path = output_dir / f"interactive_image_confidence_buckets_{tag}.csv"
        bucket_df.to_csv(bucket_path, index=False)

        y_true = patient_pred["label"].to_numpy().astype(int)
        y_prob = patient_pred["prob"].to_numpy().astype(float)
        conf_stats = _confidence_stats_from_arrays(y_true, y_prob, threshold=threshold)

        row: dict[str, float | str] = {
            "model": model_name,
            "checkpoint": str(ckpt_path.resolve()),
            "threshold_used": threshold,
            "image_size": image_size,
            "bucket_path": str(bucket_path.resolve()),
        }
        for level_name, level_metrics in summary.items():
            prefix = "slice" if level_name == "slice_level" else "patient"
            for k, v in level_metrics.items():
                row[f"{prefix}_{k}"] = float(v) if isinstance(v, (int, float, np.floating)) else v
        row.update(conf_stats)

        slice_pred_path = output_dir / f"interactive_image_slice_predictions_{tag}.csv"
        patient_pred_path = output_dir / f"interactive_image_patient_predictions_{tag}.csv"
        slice_pred.to_csv(slice_pred_path, index=False)
        patient_pred.to_csv(patient_pred_path, index=False)
        row["slice_pred_path"] = str(slice_pred_path.resolve())
        row["patient_pred_path"] = str(patient_pred_path.resolve())
        return row

    out_dir = output_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    rows = []
    rows.append(eval_one(ckpt_a, "a"))
    rows.append(eval_one(ckpt_b, "b"))

    df_rows = pd.DataFrame(rows)
    metrics_path = out_dir / "interactive_image_metrics_comparison.csv"
    df_rows.to_csv(metrics_path, index=False)

    # 如果 patient_auc 存在则按 patient_auc 排名，否则退化
    if "patient_auc" in df_rows.columns:
        best_idx = int(df_rows["patient_auc"].astype(float).idxmax())
        winner = df_rows.loc[best_idx, "model"]
    else:
        winner = None

    summary = {
        "n_input_images": int(len(test_df)),
        "n_input_patients": int(test_df["patient_id"].nunique()),
        "device": device,
        "metrics_path": str(metrics_path.resolve()),
        "winner_model": winner,
    }
    (out_dir / "interactive_image_summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    return summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="双模型交互式测试：表格输入=手动/CSV行，图像输入=图片路径。输出项目指标与置信度分箱/ECE。"
    )
    parser.add_argument("--modality", type=str, default=None, choices=["tabular", "image", "auto"], help="测试模态")

    parser.add_argument("--device", type=str, default=None, choices=["cpu", "cuda"], help="推理设备")
    parser.add_argument("--threshold", type=float, default=0.5, help="二分类阈值（用于 accuracy/sens/spec/F1 等）")
    parser.add_argument("--output-dir", type=str, default="outputs/reports/interactive", help="结果输出目录")

    # tabular
    parser.add_argument(
        "--model-a",
        type=str,
        default="xgb_tree_nan",
        help="表格模型A：xgb/xgb_tree_nan/lasso_cv/stacking/missing_robust_*",
    )
    parser.add_argument(
        "--model-b",
        type=str,
        default="missing_robust_stacking",
        help="表格模型B：xgb/xgb_tree_nan/lasso_cv/stacking/missing_robust_*",
    )
    parser.add_argument(
        "--table-input-mode",
        type=str,
        default=None,
        choices=["manual", "manual_fields", "csv"],
        help="表格输入模式：manual(JSON)/manual_fields(逐项中文录入)/csv",
    )
    parser.add_argument("--manual-json", type=str, default=None, help="手动 JSON（也可传 JSON 文件路径）")
    parser.add_argument("--table-csv-path", type=str, default=None, help="CSV 文件路径（默认 merged_liver_research.csv）")
    parser.add_argument("--table-row-idxs", type=str, default=None, help="逗号分隔的行索引（从 0 起）")
    parser.add_argument("--table-row-seqns", type=str, default=None, help="逗号分隔的 SEQN 列表")

    # image
    parser.add_argument("--checkpoint-a", type=str, default=None, help="图像模型A checkpoint（.pt）")
    parser.add_argument("--checkpoint-b", type=str, default=None, help="图像模型B checkpoint（.pt）")
    parser.add_argument("--image-paths", type=str, default=None, help="图片路径列表（逗号分隔）")
    parser.add_argument("--image-threshold-override", type=float, default=None, help="覆盖 checkpoint 内阈值（可选）")
    parser.add_argument("--batch-size", type=int, default=16, help="图像推理 batch size")
    parser.add_argument("--num-workers", type=int, default=0, help="图像 DataLoader num_workers")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    device = args.device or ("cuda" if torch.cuda.is_available() else "cpu")
    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    modality = args.modality
    if not modality or modality == "auto":
        modality = _prompt_str("选择测试模态(tabular/image)", "tabular").lower()

    if modality == "tabular":
        # 解析行索引/SEQN 参数（如果通过命令行给了字符串）
        if args.table_row_idxs:
            args.table_row_idxs = _parse_int_list(args.table_row_idxs)
        else:
            args.table_row_idxs = []
        if args.table_row_seqns:
            args.table_row_seqns = _parse_int_list(args.table_row_seqns)
        else:
            args.table_row_seqns = []

        asset_a = _load_tabular_asset(args.model_a, device=device)
        asset_b = _load_tabular_asset(args.model_b, device=device)

        X, y = _load_tabular_inputs_interactive(args)
        metrics = _evaluate_tabular_two_models(
            asset_a=asset_a,
            asset_b=asset_b,
            X=X,
            y=y,
            threshold=float(args.threshold),
            output_dir=out_dir,
        )
        print("\n===== 双表格模型交互测试完成 =====")
        print(json.dumps(metrics, ensure_ascii=False, indent=2))
        return

    if modality == "image":
        ckpt_a = args.checkpoint_a
        ckpt_b = args.checkpoint_b
        if not ckpt_a:
            ckpt_a = _prompt_str("请输入图像模型A checkpoint 路径")
        if not ckpt_b:
            ckpt_b = _prompt_str("请输入图像模型B checkpoint 路径")
        ckpt_a = Path(ckpt_a).resolve()
        ckpt_b = Path(ckpt_b).resolve()
        if not ckpt_a.exists():
            raise FileNotFoundError(ckpt_a)
        if not ckpt_b.exists():
            raise FileNotFoundError(ckpt_b)

        if args.image_paths:
            args.image_paths = _parse_str_list(args.image_paths)
        else:
            args.image_paths = None

        test_df = _load_image_test_df_interactive(args)
        summary = _evaluate_image_two_models(
            ckpt_a=ckpt_a,
            ckpt_b=ckpt_b,
            test_df=test_df,
            threshold_override=args.image_threshold_override,
            batch_size=args.batch_size,
            num_workers=args.num_workers,
            device=device,
            output_dir=out_dir,
        )
        print("\n===== 双图像模型交互测试完成 =====")
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return

    raise ValueError(f"Unsupported modality: {modality}")


if __name__ == "__main__":
    main()
