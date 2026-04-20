"""
糖尿病二分类模型：单条样本的 SHAP 贡献排序。

用法一 — 命令行（单用户）::
    python test_rf_pipeline_shap.py --user-json-file user.json
    python test_rf_pipeline_shap.py --user-input-json '{"Age":45,"BMI":26.0,...}'

用法二 — 在其他 Python 代码中调用::
    from test_rf_pipeline_shap import diabetes_shap_for_user
    out = diabetes_shap_for_user({"Age": 45, "BMI": 26.0, ...})
    print(out["top_features"])
"""
import argparse
import json
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd


def _prepare_feature_frame(
    X: Any,
    feature_columns: list[str],
    medians: dict[str, float] | pd.Series | None = None,
) -> pd.DataFrame:
    """
    兼容你训练脚本里的输入封装逻辑：
    - 允许 DataFrame / dict / dict 列表
    - 按训练特征列对齐
    - 非数值 -> NaN；保留 NaN（不填中位数）
    - inf/-inf -> NaN
    - 转 float
    """
    if isinstance(X, pd.DataFrame):
        df = X.copy()
    elif isinstance(X, dict):
        df = pd.DataFrame([X])
    elif isinstance(X, list) and (not X or isinstance(X[0], dict)):
        df = pd.DataFrame(X)
    else:
        raise TypeError("模型输入 X 必须是 pandas.DataFrame 或 dict 或 dict 列表。")

    # 对齐列顺序与缺列（缺列保留 NaN）
    df = df.reindex(columns=feature_columns)

    # 数值化 + 缺失处理
    df = df.apply(pd.to_numeric, errors="coerce")
    df = df.mask((df == np.inf) | (df == -np.inf), np.nan)
    df = df.astype(float)
    return df


class DiabetesProbaWrapper:
    """
    与你训练脚本中同名封装保持一致（用于让 joblib pickle 反序列化通过）。
    仅实现 predict_proba/predict 里用到的核心逻辑。
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
        Xp = _prepare_feature_frame(X=X, feature_columns=self._tolerant_feature_columns)
        proba = np.asarray(self.base_model.predict_proba(Xp), dtype=float)

        # 全 NaN 行：模型输出不可靠；按产品要求正类概率固定为 0
        mat = Xp.to_numpy(dtype=float, copy=False)
        row_all_nan = np.isnan(mat).all(axis=1)
        if row_all_nan.any():
            proba = proba.copy()
            proba[row_all_nan, 0] = 1.0
            proba[row_all_nan, 1] = 0.0
        return proba

    def predict(self, X: Any) -> np.ndarray:
        Xp = _prepare_feature_frame(X=X, feature_columns=self._tolerant_feature_columns)
        if hasattr(self.base_model, "predict"):
            return self.base_model.predict(Xp)
        p = self.base_model.predict_proba(Xp)[:, 1]
        return (p >= 0.5).astype(int)


def _load_training_meta(meta_path: Path) -> dict:
    with open(meta_path, "r", encoding="utf-8") as f:
        return json.load(f)


def _dict_to_feature_frame(user_input: dict[str, Any], feature_columns: list[str]) -> pd.DataFrame:
    # 按训练时列名对齐；缺失列用 NaN（与训练封装的“缺失保持 NaN”一致）
    row = {c: user_input.get(c, np.nan) for c in feature_columns}
    return pd.DataFrame([row], columns=feature_columns)


def _get_tree_step_and_preprocess_steps(base_model: Any):
    """
    尽量从 sklearn Pipeline 里取出：
    - 树模型步骤（XGBClassifier/RandomForest 等）
    - 其前置的 transform 步骤（例如 StandardScaler）
    """
    if hasattr(base_model, "named_steps") and hasattr(base_model, "steps"):
        steps = list(base_model.steps)

        # 1) 优先选 XGBClassifier：有 get_booster() 的才是真的树模型输出层
        for i, (_, step) in enumerate(steps):
            if hasattr(step, "get_booster"):
                return step, steps[:i]

        # 2) 再选 RandomForest 等：has estimators_ 但要跳过校准器
        for i, (_, step) in enumerate(steps):
            if step.__class__.__name__ == "CalibratedClassifierCV":
                continue
            if hasattr(step, "estimators_"):
                return step, steps[:i]

    return base_model, []


def _apply_preprocess_steps(preprocess_steps: list[tuple[str, Any]], X_df: pd.DataFrame) -> Any:
    X = X_df
    for _, step in preprocess_steps:
        if hasattr(step, "transform"):
            X = step.transform(X)
    return X


def _select_shap_vector_for_pred_class(shap_values: Any, pred_class: int, n_features: int) -> np.ndarray:
    """
    SHAP 在不同版本/模型类型下返回值形态不同，这里做一个尽量稳健的抽取：
    最终返回形状为 (n_features,) 的贡献值向量。
    """
    # 常见：二分类 -> (n_samples, n_features)
    arr = np.asarray(shap_values)
    if arr.ndim == 2:
        return arr[0]

    # 常见：多分类 -> list，每个类别一个 (n_samples, n_features)
    if isinstance(shap_values, list):
        sv = np.asarray(shap_values[pred_class])
        return sv[0]

    # shap.Explanation：values 里可能是 2D/3D
    if hasattr(shap_values, "values"):
        vals = np.asarray(shap_values.values)
        if vals.ndim == 2:
            return vals[0]
        if vals.ndim == 3:
            # 可能是 (n_samples, n_features, n_classes)
            if vals.shape[1] == n_features:
                return vals[0, :, pred_class]
            # 可能是 (n_samples, n_classes, n_features)
            if vals.shape[2] == n_features:
                return vals[0, pred_class, :]

    raise ValueError(f"无法解析 SHAP 输出形态：type={type(shap_values)}; shape={getattr(shap_values, 'shape', None)}")


def _resolve_paths(
    project_root: Path,
    model_path: Path | str | None,
    meta_path: Path | str | None,
) -> tuple[Path, Path]:
    mp = Path(model_path) if model_path else (project_root / "models" / "diabetes" / "rf_pipeline.joblib")
    mt = Path(meta_path) if meta_path else (project_root / "models" / "diabetes" / "training_meta.json")
    return mp, mt


def diabetes_shap_for_user(
    user_input: dict[str, Any],
    *,
    project_root: Path | None = None,
    model_path: Path | str | None = None,
    meta_path: Path | str | None = None,
    top_k: int = 10,
    debug_extract: bool = False,
) -> dict[str, Any]:
    """
    对单个用户的特征字典做糖尿病预测 + SHAP 贡献值排序（按绝对值从大到小取 top_k）。

    ``user_input`` 只需包含有的字段；未出现的特征列会按训练约定视为缺失（NaN）。

    返回字典包含 ``predicted_class``、``proba``、``top_features`` 等，便于接口层直接 JSON 序列化。
    """
    root = project_root if project_root is not None else Path(__file__).resolve().parent
    mp, mt = _resolve_paths(root, model_path, meta_path)
    if not mp.is_file():
        raise FileNotFoundError(f"模型文件不存在：{mp}")
    if not mt.is_file():
        raise FileNotFoundError(f"training_meta.json 不存在：{mt}")

    meta = _load_training_meta(mt)
    feature_columns = meta.get("feature_columns")
    if not feature_columns:
        raise KeyError("training_meta.json 中缺少 feature_columns")

    X_df = _dict_to_feature_frame(user_input, feature_columns)
    model_loaded = joblib.load(mp)
    base_model = model_loaded.base_model if hasattr(model_loaded, "base_model") else model_loaded

    base_model_for_shap = base_model
    if base_model.__class__.__name__ == "CalibratedClassifierCV":
        inner = getattr(base_model, "estimator", None) or getattr(base_model, "base_estimator", None)
        if inner is not None:
            base_model_for_shap = inner

    proba = np.asarray(model_loaded.predict_proba(X_df), dtype=float)
    pred_class = int(np.argmax(proba[0]))

    try:
        import shap
    except Exception as e:
        raise RuntimeError("缺少 `shap` 依赖。请先安装：pip install shap") from e

    tree_step, preprocess_steps = _get_tree_step_and_preprocess_steps(base_model_for_shap)
    X_for_shap = _apply_preprocess_steps(preprocess_steps, X_df)

    if debug_extract:
        return {
            "debug": True,
            "base_model_type": str(type(base_model)),
            "base_model_for_shap_type": str(type(base_model_for_shap)),
            "tree_step_type": str(type(tree_step)),
            "preprocess_step_types": [str(type(s)) for _, s in preprocess_steps],
        }

    explainer = shap.TreeExplainer(tree_step)
    shap_values = explainer.shap_values(X_for_shap)
    shap_vector = _select_shap_vector_for_pred_class(
        shap_values, pred_class=pred_class, n_features=len(feature_columns)
    )

    feature_importance = sorted(
        zip(feature_columns, shap_vector.tolist()),
        key=lambda x: abs(x[1]),
        reverse=True,
    )
    top = feature_importance[: int(top_k)]
    top_features = [
        {"feature": name, "shap": float(val), "abs": float(abs(val))}
        for name, val in top
    ]

    return {
        "predicted_class": pred_class,
        "proba_negative": float(proba[0, 0]),
        "proba_positive": float(proba[0, 1]),
        "top_features": top_features,
        "top_k": int(top_k),
    }


def main():
    parser = argparse.ArgumentParser(
        description="糖尿病单用户预测 + SHAP 贡献值排序（默认 models/diabetes）"
    )
    parser.add_argument(
        "--model-path",
        type=str,
        default=None,
        help="模型 joblib 路径；默认使用 models/diabetes/rf_pipeline.joblib",
    )
    parser.add_argument(
        "--meta-path",
        type=str,
        default=None,
        help="training_meta.json 路径；默认使用 models/diabetes/training_meta.json",
    )
    parser.add_argument(
        "--user-input-json",
        type=str,
        default=None,
        help="单用户特征（JSON 字符串），例如 '{\"Age\": 45, \"BMI\": 27.2, ...}'",
    )
    parser.add_argument(
        "--user-json-file",
        type=str,
        default=None,
        help="单用户特征 JSON 文件路径（UTF-8），与 --user-input-json 二选一；都不给则用全 0 占位",
    )
    parser.add_argument("--top-k", type=int, default=10, help="输出 TopK 特征（默认 10）")
    parser.add_argument(
        "--debug-extract",
        action="store_true",
        help="只打印模型结构/抽取结果，不执行 SHAP",
    )
    args = parser.parse_args()

    root = Path(__file__).resolve().parent
    model_path = Path(args.model_path) if args.model_path else None
    meta_path = Path(args.meta_path) if args.meta_path else None

    if args.user_input_json and args.user_json_file:
        raise SystemExit("请只使用 --user-input-json 或 --user-json-file 之一。")

    user_input: dict[str, Any]
    if args.user_json_file:
        p = Path(args.user_json_file)
        if not p.is_file():
            raise FileNotFoundError(f"用户 JSON 文件不存在：{p}")
        with open(p, "r", encoding="utf-8") as f:
            user_input = json.load(f)
        if not isinstance(user_input, dict):
            raise TypeError("JSON 文件顶层必须是对象（字典），表示单用户特征。")
    elif args.user_input_json:
        user_input = json.loads(args.user_input_json)
    else:
        mp, mt = _resolve_paths(root, model_path, meta_path)
        meta = _load_training_meta(mt)
        fc = meta.get("feature_columns") or []
        user_input = {c: 0.0 for c in fc}

    out = diabetes_shap_for_user(
        user_input,
        project_root=root,
        model_path=model_path,
        meta_path=meta_path,
        top_k=int(args.top_k),
        debug_extract=bool(args.debug_extract),
    )

    if args.debug_extract:
        print(json.dumps(out, ensure_ascii=False, indent=2))
        return

    print("=== 糖尿病预测 + SHAP 贡献排序（单用户）===")
    print(
        f"Predicted class: {out['predicted_class']}; "
        f"proba=[{out['proba_negative']:.6f}, {out['proba_positive']:.6f}]"
    )
    for i, row in enumerate(out["top_features"], start=1):
        print(
            f"{i}. {row['feature']}: shap_contrib={row['shap']:.6f} (abs={row['abs']:.6f})"
        )


if __name__ == "__main__":
    main()

