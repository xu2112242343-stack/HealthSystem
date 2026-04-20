# -*- coding: utf-8 -*-
"""
多模态融合预测（结构化 + 图像）

输出规则（按你要求的“缺哪个就输出哪个”）：
1) 只有结构化：输出结构化脑卒中概率 P(D=1|x_rf)
2) 只有图像：输出图像脑卒中总概率 P(D=1|x_img)=P(出血或缺血|图像)
   - 若图像为“正常”（主判为正常），只输出总概率
   - 若图像主判为“出血/缺血”，输出：出血型概率、缺血型概率
3) 两者都有：门控融合（不再使用取最大值或其它 logit 融合）
   - 图像主判“正常”：总概率 = 结构化模型预测 P(D=1|x_rf)
   - 图像主判“出血/缺血”：总概率 = 图像卒中概率 P(D=1|x_img)，并输出病灶类型（出血性或缺血性脑卒中）
4) 只要结构化侧有有效特征输入：输出本次输入的局部重要性 Top10（单特征置 NaN 的 |Δp|）
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd

from ceshiv8 import predict_image_probs
from 新文本数据xgboost import StrokeProbaWrapper


ROOT = Path(__file__).resolve().parent
MODEL_DIR = ROOT / "models" / "stroke"
RF_MODEL_PATH = MODEL_DIR / "rf_pipeline.joblib"
META_PATH = MODEL_DIR / "training_meta.json"
FEATURE_IMPORTANCE_CSV = MODEL_DIR / "feature_importance.csv"
SELECTED_TRAIN_CSV = ROOT / "origin" / "selected25_train_stroke.csv"
BALANCED_TRAIN_CSV = ROOT / "origin" / "balanced_train_stroke.csv"

STRUCT_JSON_EXAMPLE = {
    # "RIDAGEYR": 65,
    # "BPQ020": 2,
}


def _load_meta() -> dict[str, Any]:
    with META_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def _load_struct_from_json(path: Path) -> dict[str, float]:
    with path.open("r", encoding="utf-8") as f:
        obj = json.load(f)
    if not isinstance(obj, dict):
        raise ValueError("struct_json must be a JSON object: {feature: value, ...}")
    out: dict[str, float] = {}
    for k, v in obj.items():
        if v is None:
            continue
        if isinstance(v, (int, float)):
            out[str(k)] = float(v)
        else:
            # Try parse numeric strings
            s = str(v).strip()
            if s == "" or s.lower() in {"nan", "none", "null"}:
                continue
            out[str(k)] = float(s)
    return out


def _load_struct_from_csv_first_row(path: Path) -> dict[str, float]:
    df = pd.read_csv(path, low_memory=False)
    if df.empty:
        raise ValueError("struct_csv is empty")
    row = df.iloc[0].to_dict()
    out: dict[str, float] = {}
    for k, v in row.items():
        if pd.isna(v):
            continue
        out[str(k)] = float(v)
    return out


def _choose_struct_features_order(meta: dict[str, Any]) -> list[str]:
    feature_columns: list[str] = meta.get("feature_columns", [])
    risk_quantiles_train = meta.get("risk_quantiles_train", None)
    _ = risk_quantiles_train

    if FEATURE_IMPORTANCE_CSV.is_file():
        try:
            fi = pd.read_csv(FEATURE_IMPORTANCE_CSV, encoding="utf-8-sig")
            if "feature" in fi.columns:
                # Keep consistent sorting logic with 新文本数据xgboost_test.py
                sort_col = None
                for c in ("combined_mlp_perm", "combined_shap_perm", "combined_importance", "shap_mean_abs"):
                    if c in fi.columns:
                        sort_col = c
                        break
                if sort_col:
                    rows_sorted = fi.sort_values(by=sort_col, ascending=False).drop_duplicates(subset=["feature"], keep="first")
                    ordered = [str(x) for x in rows_sorted["feature"].tolist() if str(x) in feature_columns]
                    if ordered:
                        return ordered
        except Exception:
            pass
    return feature_columns


def _prompt_struct_interactively(
    ordered_features: list[str],
    *,
    name_zh_map: dict[str, str] | None = None,
    val_note_map: dict[str, str] | None = None,
) -> dict[str, float]:
    print("\n结构化输入：逐特征输入（回车=缺失，不会填补）。")
    print("提示：输入必须为数字（连续值）。如果不确定某项，直接回车。")

    name_zh_map = name_zh_map or {}
    val_note_map = val_note_map or {}

    sample_row: dict[str, float] = {}
    for feat in ordered_features:
        cn = str(name_zh_map.get(feat, "")).strip()
        val_note = str(val_note_map.get(feat, "")).strip()

        # 参考 新文本数据xgboost测试.py 的筛选逻辑：只在 val_note 看起来像“编码含义/可选值说明”时展示
        val_note_ok = False
        if val_note and val_note.lower() != "nan":
            bad_markers = [
                "连续型实验室结果",
                "单位与含义见",
                "缺失多为未测",
                "缺失多为未测/不适用",
                "缺失多为未测/不适用",
            ]
            if any(m in val_note for m in bad_markers):
                val_note_ok = False
            elif "=" in val_note:
                val_note_ok = True

        if cn and cn != "nan":
            if val_note_ok:
                prompt = f"请输入 {feat}（{cn}；{val_note}）的值（回车=缺失）："
            else:
                prompt = f"请输入 {feat}（{cn}）的值（回车=缺失）："
        else:
            if val_note_ok:
                prompt = f"请输入 {feat}（{val_note}）的值（回车=缺失）："
            else:
                prompt = f"请输入 {feat} 的值（回车=缺失）："

        s = input(prompt).strip()
        if s == "" or s.lower() in {"nan", "none", "null"}:
            continue
        try:
            sample_row[feat] = float(s)
        except ValueError:
            print(f"  [跳过] 输入 {s!r} 无法转为数字，将视为缺失。")
    return sample_row


def _load_feature_importance_hints() -> tuple[dict[str, str], dict[str, str]]:
    """
    从 `models/stroke/feature_importance.csv` 读取中文含义/值说明（用于交互提示）。
    """
    name_zh_map: dict[str, str] = {}
    val_note_map: dict[str, str] = {}
    try:
        if not FEATURE_IMPORTANCE_CSV.is_file():
            return name_zh_map, val_note_map
        fi = pd.read_csv(FEATURE_IMPORTANCE_CSV, encoding="utf-8-sig")
        if "feature" not in fi.columns:
            return name_zh_map, val_note_map
        if "中文含义" in fi.columns:
            m = fi.set_index("feature")["中文含义"].dropna().astype(str).to_dict()
            name_zh_map = {str(k): str(v) for k, v in m.items()}
        # 你新文本脚本里用到的列名：特征值说明_中文
        if "特征值说明_中文" in fi.columns:
            n = fi.set_index("feature")["特征值说明_中文"].dropna().astype(str).to_dict()
            val_note_map = {str(k): str(v) for k, v in n.items()}
    except Exception:
        pass
    return name_zh_map, val_note_map


def _pick_risk_threshold_source() -> Path:
    if SELECTED_TRAIN_CSV.is_file():
        return SELECTED_TRAIN_CSV
    if BALANCED_TRAIN_CSV.is_file():
        return BALANCED_TRAIN_CSV
    raise FileNotFoundError(
        f"未找到用于重算风险阈值的训练数据：{SELECTED_TRAIN_CSV} / {BALANCED_TRAIN_CSV}"
    )


def _recompute_risk_thresholds(
    *,
    model: Any,
    feature_columns: list[str],
) -> tuple[list[float], Path]:
    """
    运行时重算风险阈值（Q1/Q2/Q3），不读取训练元数据中的历史阈值。
    """
    src = _pick_risk_threshold_source()
    df = pd.read_csv(src, low_memory=False)
    X = _align_features_no_impute(df, feature_columns)
    p = np.asarray(model.predict_proba(X)[:, 1], dtype=float)
    p = p[np.isfinite(p)]
    if p.size < 8:
        return [0.20, 0.50, 0.80], src
    t1, t2, t3 = np.quantile(p, [0.25, 0.50, 0.75]).tolist()
    eps = 1e-6
    t2 = max(float(t2), float(t1) + eps)
    t3 = max(float(t3), float(t2) + eps)
    return [float(t1), float(t2), float(t3)], src


def _prob_to_risk_tier(p: float, thresholds: list[float]) -> int:
    t1, t2, t3 = thresholds
    if p < t1:
        return 1
    if p < t2:
        return 2
    if p < t3:
        return 3
    return 4


def _tier_label_zh(tier: int) -> str:
    return {1: "低风险", 2: "中低风险", 3: "中高风险", 4: "高风险"}.get(int(tier), "未知")


def _health_score(prob: float, tier: int) -> float:
    """
    健康评分（0~100，越高越健康）：
    - 基础分：100*(1-prob)
    - 档位惩罚：档1/2/3/4 -> 0/8/18/30
    """
    p = float(np.clip(prob, 0.0, 1.0))
    base = 100.0 * (1.0 - p)
    penalty = {1: 0.0, 2: 8.0, 3: 18.0, 4: 30.0}.get(int(tier), 0.0)
    return float(np.clip(base - penalty, 0.0, 100.0))


def _predict_struct_stroke_proba(model: Any, feature_columns: list[str], sample_row: dict[str, float]) -> float:
    df = pd.DataFrame([sample_row])
    if getattr(model, "is_tolerant_model", False):
        proba = model.predict_proba(df)
        return float(proba[:, 1][0])

    # Fallback for non-wrapped models
    X = df.reindex(columns=feature_columns).apply(pd.to_numeric, errors="coerce")
    proba = model.predict_proba(X)
    return float(proba[:, 1][0])


def _align_features_no_impute(df: pd.DataFrame, feature_columns: list[str]) -> pd.DataFrame:
    out = df.reindex(columns=feature_columns)
    out = out.apply(pd.to_numeric, errors="coerce")
    out = out.replace([np.inf, -np.inf], np.nan)
    return out.astype(float)


def _print_struct_missing_stats(
    sample_row: dict[str, float],
    feature_columns: list[str],
    *,
    show_top_n: int = 15,
) -> None:
    expected = [str(x) for x in feature_columns]
    provided_raw = {str(k) for k in sample_row.keys()}
    expected_set = set(expected)

    provided_in_model = [c for c in expected if c in provided_raw]
    missing_features = [c for c in expected if c not in provided_raw]
    extra_features = sorted(provided_raw - expected_set)

    total = len(expected)
    filled = len(provided_in_model)
    missing = len(missing_features)
    missing_rate = (missing / total) if total > 0 else 0.0

    print("\n=== 结构化数据空缺统计 ===")
    print(f"模型期望特征数：{total}")
    print(f"已填写特征数：{filled}")
    print(f"空缺特征数：{missing}")
    print(f"空缺率：{missing_rate:.2%}")

    if extra_features:
        show_extra = ", ".join(extra_features[:show_top_n])
        suffix = " ..." if len(extra_features) > show_top_n else ""
        print(f"额外输入特征（不在模型特征中）前{show_top_n}个：{show_extra}{suffix}")

    if missing_features:
        show_missing = ", ".join(missing_features[:show_top_n])
        suffix = " ..." if len(missing_features) > show_top_n else ""
        print(f"空缺特征前{show_top_n}个：{show_missing}{suffix}")


def _local_importance_by_nan_drop(
    *,
    model: Any,
    X_one_aligned: pd.DataFrame,
    feature_columns: list[str],
    base_proba: float,
    name_zh_map: dict[str, str] | None = None,
    top_k: int = 10,
) -> pd.DataFrame:
    """
    局部重要性（本次输入）：
    对每个非缺失特征，单独置为 NaN 后重新预测，比较 |Δp| = |p_base - p_drop|。
    """
    if X_one_aligned.shape[0] != 1:
        raise ValueError("X_one_aligned 必须为单行 DataFrame。")

    X0 = _align_features_no_impute(X_one_aligned, feature_columns)
    filled = X0.notna().iloc[0]
    filled_features = [c for c in feature_columns if bool(filled.get(c, False))]
    if not filled_features:
        return pd.DataFrame(
            columns=["feature", "中文含义", "value", "p_base", "p_drop_to_nan", "delta_p", "abs_delta_p"]
        )

    rows: list[dict[str, Any]] = []
    for f in filled_features:
        Xd = X0.copy()
        Xd.loc[:, f] = np.nan
        p_drop = _predict_struct_stroke_proba(
            model=model,
            feature_columns=feature_columns,
            sample_row=Xd.iloc[0].to_dict(),
        )
        delta = float(base_proba - p_drop)
        rows.append(
            {
                "feature": f,
                "中文含义": (name_zh_map or {}).get(f, ""),
                "value": float(X0[f].iloc[0]) if pd.notna(X0[f].iloc[0]) else np.nan,
                "p_base": float(base_proba),
                "p_drop_to_nan": float(p_drop),
                "delta_p": delta,
                "abs_delta_p": abs(delta),
            }
        )

    out = pd.DataFrame(rows).sort_values("abs_delta_p", ascending=False)
    k = int(max(1, min(top_k, len(out))))
    return out.head(k)


def _lesion_label_zh(main_zh: str) -> str:
    if main_zh == "出血":
        return "出血性脑卒中"
    if main_zh == "缺血":
        return "缺血性脑卒中"
    return str(main_zh)


def _print_outputs(
    *,
    has_struct: bool,
    has_img: bool,
    p_rf: float | None,
    img_probs: dict[str, Any] | None,
    p_fused: float | None,
    pi: float,
) -> None:
    if has_struct and not has_img:
        print(f"\n输出（结构化のみ）：P(脑卒中 D=1 | x_rf) = {p_rf:.6f}")
        return

    if has_img and not has_struct:
        assert img_probs is not None
        p_img_stroke = float(img_probs["p_img_stroke"])
        main_zh = str(img_probs["main_zh"])
        print(f"\n输出（图像のみ）：P(脑卒中 D=1 | x_img) = {p_img_stroke:.6f}")
        if main_zh == "正常":
            return
        print(f"  出血型概率 P(H | x_img) 近似 = {float(img_probs['p_img_hemorrhage']):.6f}")
        print(f"  缺血型概率 P(I | x_img) 近似 = {float(img_probs['p_img_ischemia']):.6f}")
        return

    # both：门控融合（正常→结构化；卒中→图像）
    assert img_probs is not None and p_fused is not None and has_struct and has_img
    qH = float(img_probs["p_img_hemorrhage"])
    qI = float(img_probs["p_img_ischemia"])
    main_zh = str(img_probs["main_zh"])
    p_img_stroke = float(img_probs["p_img_stroke"])

    print(f"\n输出（结构化+图像，门控融合）：训练参考患病率 pi={pi:.6f}")
    print("  规则：图像主判正常 → 总概率取结构化；图像主判出血/缺血 → 总概率取图像卒中概率。")
    if p_rf is not None:
        print(f"  结构化 P(D=1|x_rf) = {float(p_rf):.6f}")
    print(
        f"  图像 P(D=1|x_img) = {p_img_stroke:.6f}  "
        f"(出血={qH:.6g}, 缺血={qI:.6g}, 正常={float(img_probs['p_img_normal']):.6g})，主判={main_zh!r}"
    )
    print(f"  本次决策总概率 P(脑卒中) = {p_fused:.6f}")
    if main_zh == "正常":
        return
    if main_zh in ("出血", "缺血"):
        print(f"  病灶类型：{_lesion_label_zh(main_zh)}")
    print(f"  图像侧分型参考：P(出血|x_img) ≈ {qH:.6f}，P(缺血|x_img) ≈ {qI:.6f}")


_STROKE_RF_CACHE: dict[str, Any] = {"model": None, "meta": None}


def resolve_stroke_image_disk_path(p: str | Path) -> str | None:
    """供 ``risk_engine`` 可选调用：卒中影像路径存在则返回绝对路径。"""
    path = Path(str(p)).expanduser()
    if path.is_file():
        return str(path.resolve())
    return None


def _num(d: dict[str, Any], *keys: str) -> float | None:
    for k in keys:
        if k not in d or d[k] is None:
            continue
        try:
            x = float(d[k])
            if np.isfinite(x):
                return x
        except (TypeError, ValueError):
            continue
    return None


def _user_flat_to_cdc_features(d: dict[str, Any]) -> dict[str, float]:
    """
    将问卷 API 扁平字段映射为卒中 RF 训练使用的 CDC/NHANES 列名（与 ``training_meta.feature_columns`` 一致）。
    已含大写列名的键会原样合并（便于直接传入结构化 JSON）。
    """
    out: dict[str, float] = {}
    meta_cols: list[str] = []
    try:
        if META_PATH.is_file():
            meta_cols = list(_load_meta().get("feature_columns") or [])
    except Exception:
        meta_cols = []
    cdc_keys = {str(c) for c in meta_cols} if meta_cols else set()
    if cdc_keys:
        for k, v in d.items():
            ks = str(k)
            if ks not in cdc_keys:
                continue
            if v is None:
                continue
            try:
                out[ks] = float(v)
            except (TypeError, ValueError):
                continue

    a = _num(d, "age")
    if a is not None and "RIDAGEYR" not in out:
        out["RIDAGEYR"] = a
    g = d.get("gender")
    if g is not None and "RIAGENDR" not in out:
        s = str(g).strip().lower()
        if s in ("male", "m", "男", "1"):
            out["RIAGENDR"] = 1.0
        elif s in ("female", "f", "女", "2"):
            out["RIAGENDR"] = 2.0
    bm = _num(d, "bmi")
    if bm is None:
        h = _num(d, "heightCm")
        w = _num(d, "weightKg")
        if h and w and h > 0:
            bm = float(w) / ((float(h) / 100.0) ** 2)
    if bm is not None and "BMXBMI" not in out:
        out["BMXBMI"] = bm

    sbp = _num(d, "sbp")
    dbp = _num(d, "dbp")
    if sbp is not None and "LBXSLDSI" not in out:
        out["LBXSLDSI"] = sbp
    if dbp is not None and "LBXSASSI" not in out:
        out["LBXSASSI"] = dbp
    mp = _num(d, "map")
    if mp is None and sbp is not None and dbp is not None:
        mp = float(dbp) + (float(sbp) - float(dbp)) / 3.0
    if mp is not None and "MAP" not in out:
        out["MAP"] = mp

    def yn12(key: str, col: str) -> None:
        if col in out:
            return
        if key not in d or d[key] is None:
            return
        out[col] = 1.0 if bool(d[key]) else 2.0

    yn12("hypertension", "BPQ020")
    yn12("coronaryHeartDisease", "MCQ160C")
    yn12("angina", "MCQ160D")
    yn12("myocardialInfarction", "MCQ160E")

    if "SMQ040" not in out and d.get("smoking") is not None:
        out["SMQ040"] = 1.0 if bool(d["smoking"]) else 3.0

    dl = d.get("drinkingLevel")
    if dl is not None and str(dl).strip() in {"0", "1", "2", "3"} and "ALQ121" not in out:
        out["ALQ121"] = float(str(dl).strip())

    if "PAQ650" not in out and d.get("vigorousExercise") is not None:
        out["PAQ650"] = 1.0 if bool(d["vigorousExercise"]) else 2.0

    sed = _num(d, "sedentaryMinutesPerDay")
    if sed is not None and "PAD680" not in out:
        out["PAD680"] = sed

    for uk, ck in [
        ("fpg", "LBDGLUSI"),
        ("hba1c", "LBXGH"),
        ("tg", "LBDSTRSI"),
        ("tc", "LBDSCHSI"),
        ("hdl", "LBDHDDSI"),
        ("ldl", "LBDLDLSI"),
        ("creatinine", "LBDSCRSI"),
        ("bun", "LBDSBUSI"),
        ("serumIron", "LBDSIRSI"),
        ("lymphocytePct", "LBXLYPCT"),
        ("rdw", "LBXRDW"),
        ("rbc", "LBXRBCSI"),
        ("hemoglobin", "LBXHGB"),
        ("hematocrit", "LBXHCT"),
        ("chloride", "LBXSCLSI"),
    ]:
        v = _num(d, uk)
        if v is not None and ck not in out:
            out[ck] = v

    sir = _num(d, "serumIron")
    if sir is not None and "LBXSIR" not in out:
        out["LBXSIR"] = sir

    return out


def _norm_stroke_factor_blocks(blocks: list[tuple[str, float, str, str]]) -> list[dict[str, Any]]:
    blocks = [b for b in blocks if b[1] > 0]
    if not blocks:
        return []
    blocks = sorted(blocks, key=lambda x: -x[1])[:5]
    s = sum(b[1] for b in blocks)
    if s <= 0:
        u = 1.0 / len(blocks)
        return [{"name": b[0], "value": round(u, 4), "current": b[2], "reference": b[3]} for b in blocks]
    return [{"name": b[0], "value": round(b[1] / s, 4), "current": b[2], "reference": b[3]} for b in blocks]


def _factors_from_local_imp_df(df: pd.DataFrame) -> list[dict[str, Any]]:
    if df is None or len(df) == 0:
        return []
    rows: list[tuple[str, float, str, str]] = []
    for _, r in df.head(5).iterrows():
        name = str(r.get("中文含义") or "").strip() or str(r.get("feature", ""))
        w = float(r.get("abs_delta_p") or 0.0)
        feat = str(r.get("feature", ""))
        val = r.get("value")
        if val is not None and not (isinstance(val, float) and np.isnan(val)):
            cur = f"{feat}={val}"
        else:
            cur = feat
        rows.append((name, w, cur, "—"))
    return _norm_stroke_factor_blocks(rows)


def _ensure_stroke_rf_loaded() -> tuple[Any, dict[str, Any]] | None:
    global _STROKE_RF_CACHE
    if _STROKE_RF_CACHE["model"] is not None and _STROKE_RF_CACHE["meta"] is not None:
        return _STROKE_RF_CACHE["model"], _STROKE_RF_CACHE["meta"]
    if not RF_MODEL_PATH.is_file() or not META_PATH.is_file():
        return None
    import __main__

    setattr(__main__, "StrokeProbaWrapper", StrokeProbaWrapper)
    meta = _load_meta()
    model = joblib.load(RF_MODEL_PATH)
    feature_columns: list[str] = list(meta.get("feature_columns") or [])
    pi = float(meta.get("metrics", {}).get("positive_rate_test", meta.get("positive_rate_test", 0.5)))
    if not np.isfinite(pi) or pi <= 0 or pi >= 1:
        pi = 0.5
    if not getattr(model, "is_tolerant_model", False):
        uncertain_prior = float(meta.get("uncertain_prior", pi))
        model = StrokeProbaWrapper(
            base_model=model,
            feature_columns=feature_columns,
            feature_medians=None,
            uncertain_prior=uncertain_prior,
        )
    _STROKE_RF_CACHE["model"] = model
    _STROKE_RF_CACHE["meta"] = meta
    return model, meta


def predict_stroke_from_user_flat_dict(row: dict[str, Any]) -> tuple[float | None, list[dict[str, Any]], str]:
    """
    供 FastAPI ``risk_engine`` 调用：问卷扁平字典 -> (门控融合脑卒中概率, 因子列表, 模式标签)。

    模式标签：成功时为 ``model``；无法计算时为 ``none``（由上层回退启发式）。
    """
    cdc = _user_flat_to_cdc_features(row)
    img_path = str(row.get("stroke_image_path") or "").strip()
    has_img = bool(img_path)

    loaded = _ensure_stroke_rf_loaded()
    meta: dict[str, Any] | None = (loaded[1] if loaded else None) or (
        _load_meta() if META_PATH.is_file() else None
    )
    feature_columns: list[str] = list((meta or {}).get("feature_columns") or [])
    sample_row: dict[str, float] = {}
    for c in feature_columns:
        if c in cdc:
            try:
                v = float(cdc[c])
                if np.isfinite(v):
                    sample_row[c] = v
            except (TypeError, ValueError):
                pass
    struct_effective = len(sample_row) > 0

    if not struct_effective and not has_img:
        return None, [], "none"

    img_probs: dict[str, Any] | None = None
    if has_img:
        try:
            img_probs = predict_image_probs(img_path, conf_threshold=0.25)
        except Exception:
            img_probs = None

    p_rf: float | None = None
    model = None
    if struct_effective and loaded:
        model, meta = loaded
        assert meta is not None
        try:
            p_rf = _predict_struct_stroke_proba(model, feature_columns, sample_row)
        except Exception:
            p_rf = None

    p_fused: float | None = None
    if struct_effective and has_img and p_rf is not None and img_probs is not None:
        p_img = float(img_probs["p_img_stroke"])
        main_zh = str(img_probs.get("main_zh", ""))
        if main_zh == "正常":
            p_fused = float(p_rf)
        else:
            p_fused = float(p_img)
    elif struct_effective and p_rf is not None and not has_img:
        p_fused = float(p_rf)
    elif has_img and img_probs is not None and not struct_effective:
        p_fused = float(img_probs["p_img_stroke"])
    elif has_img and img_probs is not None and struct_effective and p_rf is None:
        p_fused = float(img_probs["p_img_stroke"])

    if p_fused is None:
        return None, [], "none"

    p_out = float(np.clip(p_fused, 0.0, 1.0))

    fac: list[dict[str, Any]] = []
    if struct_effective and model is not None and p_rf is not None:
        try:
            name_zh_map, _ = _load_feature_importance_hints()
            X_one = _align_features_no_impute(pd.DataFrame([sample_row]), feature_columns)
            local_imp = _local_importance_by_nan_drop(
                model=model,
                X_one_aligned=X_one,
                feature_columns=feature_columns,
                base_proba=float(p_rf),
                name_zh_map=name_zh_map,
                top_k=10,
            )
            fac = _factors_from_local_imp_df(local_imp)
        except Exception:
            fac = []

    return p_out, fac, "model"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", type=str, default="", help="image path (jpg/png) for YOLO")
    parser.add_argument("--struct-json", type=str, default="", help='path to JSON: {"RIDAGEYR": 65, ...}')
    parser.add_argument("--struct-csv", type=str, default="", help="path to CSV; first row will be used")
    parser.add_argument("--interactive-struct", action="store_true", help="prompt for structured features")
    parser.add_argument("--conf-thr", type=float, default=0.25, help="YOLO conf threshold")
    args = parser.parse_args()

    if not RF_MODEL_PATH.is_file():
        raise FileNotFoundError(f"未找到结构化模型：{RF_MODEL_PATH}")
    if not META_PATH.is_file():
        raise FileNotFoundError(f"未找到训练元数据：{META_PATH}")

    meta = _load_meta()
    feature_columns: list[str] = meta.get("feature_columns", [])
    if not feature_columns:
        raise RuntimeError("training_meta.json 中未找到 feature_columns")

    # Use the same prior as training/test prevalence when possible
    pi = float(meta.get("metrics", {}).get("positive_rate_test", meta.get("positive_rate_test", 0.5)))
    if not np.isfinite(pi) or pi <= 0 or pi >= 1:
        pi = 0.5

    model = joblib.load(RF_MODEL_PATH)
    if not getattr(model, "is_tolerant_model", False):
        uncertain_prior = float(pi)
        model = StrokeProbaWrapper(
            base_model=model,
            feature_columns=feature_columns,
            feature_medians=None,
            uncertain_prior=uncertain_prior,
        )

    ordered_features = _choose_struct_features_order(meta)
    risk_thresholds, risk_threshold_source = _recompute_risk_thresholds(
        model=model,
        feature_columns=feature_columns,
    )

    has_struct = bool(args.struct_json or args.struct_csv or args.interactive_struct)
    has_img = bool(args.image)

    # 交互输入提示：中文含义/值说明
    name_zh_map, val_note_map = _load_feature_importance_hints()

    # If nothing passed, optionally prompt in tty
    if not has_struct and not has_img and sys.stdin.isatty():
        go = input("是否输入结构化数据？(y/n)：").strip().lower()
        if go == "y":
            mode = input("结构化输入方式：1手动 2json 3csv (默认1)：").strip() or "1"
            if mode == "1":
                args.interactive_struct = True
            elif mode == "2":
                args.struct_json = input("请输入 struct_json 路径：").strip()
            elif mode == "3":
                args.struct_csv = input("请输入 struct_csv 路径：").strip()
        go2 = input("是否输入图像？(y/n)：").strip().lower()
        if go2 == "y":
            args.image = input("请输入 image path：").strip()
        has_struct = bool(args.struct_json or args.struct_csv or args.interactive_struct)
        has_img = bool(args.image)

    if not has_struct and not has_img:
        raise RuntimeError("未提供结构化数据和图像数据（两者都为空）。")

    p_rf: float | None = None
    img_probs: dict[str, Any] | None = None
    p_fused: float | None = None
    struct_effective = has_struct
    sample_row: dict[str, float] = {}

    if has_struct:
        if args.interactive_struct:
            sample_row = _prompt_struct_interactively(
                ordered_features,
                name_zh_map=name_zh_map,
                val_note_map=val_note_map,
            )
        elif args.struct_json:
            sample_row = _load_struct_from_json(Path(args.struct_json))
        elif args.struct_csv:
            sample_row = _load_struct_from_csv_first_row(Path(args.struct_csv))
        else:
            sample_row = {}

        # 如果用户没有提供任何有效结构化特征，则按“未提供结构化模态”处理，
        # 避免封装在全缺失行时把 p_rf 固定为 0，从而把融合概率错误压扁。
        if len(sample_row) == 0:
            struct_effective = False
            p_rf = None
        else:
            _print_struct_missing_stats(sample_row, feature_columns, show_top_n=20)
            p_rf = _predict_struct_stroke_proba(model, feature_columns, sample_row)

    if has_img:
        img_probs = predict_image_probs(args.image, conf_threshold=args.conf_thr)

    if struct_effective and has_img:
        assert p_rf is not None and img_probs is not None
        p_img = float(img_probs["p_img_stroke"])
        main_zh = str(img_probs.get("main_zh", ""))
        if main_zh == "正常":
            p_fused = float(p_rf)
        else:
            p_fused = float(p_img)
    else:
        p_fused = None
        if not struct_effective:
            # pure image mode
            has_struct = False

    _print_outputs(
        has_struct=has_struct,
        has_img=has_img,
        p_rf=p_rf,
        img_probs=img_probs,
        p_fused=p_fused,
        pi=pi,
    )

    # 风险等级 + 健康评分（基于本次用于决策的脑卒中概率）
    p_for_score: float | None = None
    if has_struct and has_img and p_fused is not None:
        p_for_score = float(p_fused)
        prob_source = "门控融合概率（正常→结构化，卒中→图像）"
    elif has_struct and (p_rf is not None):
        p_for_score = float(p_rf)
        prob_source = "结构化概率 P(D=1 | x_rf)"
    elif has_img and (img_probs is not None):
        p_for_score = float(img_probs["p_img_stroke"])
        prob_source = "图像概率 P(D=1 | x_img)"
    else:
        prob_source = "未知"

    if p_for_score is not None:
        tier = _prob_to_risk_tier(p_for_score, risk_thresholds)
        tier_name = _tier_label_zh(tier)
        score = _health_score(p_for_score, tier)
        t1, t2, t3 = risk_thresholds
        print("\n=== 风险等级与健康评分 ===")
        print(f"概率来源：{prob_source}")
        print(
            "阈值来源：训练样本重算分位数（Q1/Q2/Q3），"
            f"数据={risk_threshold_source.name}，阈值=[{t1:.4f}, {t2:.4f}, {t3:.4f}]"
        )
        print(f"风险等级：{tier}（{tier_name}）")
        print(f"脑卒中健康评分（0-100，越高越健康）：{score:.2f}")
        print(
            "评分解释：基础分=100*(1-概率)，再按风险档惩罚 "
            "档1/2/3/4 分别扣 0/8/18/30 分。"
        )

    # 只要有有效结构化输入：输出本次输入的局部重要性 Top10（|Δp|）
    if struct_effective and p_rf is not None:
        X_one = _align_features_no_impute(pd.DataFrame([sample_row]), feature_columns)
        local_imp = _local_importance_by_nan_drop(
            model=model,
            X_one_aligned=X_one,
            feature_columns=feature_columns,
            base_proba=float(p_rf),
            name_zh_map=name_zh_map,
            top_k=10,
        )
        print("\n=== 本次输入：局部重要性 Top10（将单个特征置 NaN 的 |Δp|）===")
        if len(local_imp):
            show_cols = [c for c in ["feature", "中文含义", "value", "p_drop_to_nan", "delta_p", "abs_delta_p"] if c in local_imp.columns]
            print(local_imp[show_cols].to_string(index=False))
        else:
            print("无非缺失特征可消融（特征名与模型列不一致或本行全为缺失）。")


if __name__ == "__main__":
    main()

