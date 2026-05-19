"""
三病风险：问卷行 -> 概率 [0,1] + 核心因子 Top5（展示权重之和为 1）。

- 糖尿病：``feature_importance.csv`` 的 RF 全局重要性 × 相对参考值偏离，先取前十再归一化展示前五；
  若存在 ``HEALTH_DIABETES_MODEL_DIR/rf_pipeline.joblib`` 则概率由模型给出，因子逻辑不变。
- 肝病：问卷启发式概率。
- 脑卒中：调用 ``stroke/multimodal_fusion_predict.py`` 中的 ``predict_stroke_from_user_flat_dict``，
  入参为 ``user_health_to_predict_dict``（数据库问卷映射后的扁平字典）；无模型或失败时回退启发式。
- 三病间传播展示分 ``propagationScores``：由源-靶概率几何耦合、三病整体几何平均与两端因子余弦相似度合成
  （``propagation_scores_commonality``），顺序为 **[糖尿病→脂肪肝, 脂肪肝→脑卒中, 糖尿病→脑卒中]**（与前端箭头一致）。
"""

from __future__ import annotations

import csv
import logging
import math
import os
import random
import re
from pathlib import Path
from typing import Any

import numpy as np
from app.diabetes_feature_mapping import map_user_flat_to_diabetes_features

_mfp_predict_stroke = None


def _clamp01(x: float | None) -> float | None:
    if x is None:
        return None
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(v):
        return None
    return max(0.0, min(1.0, v))


def _normalize_factor_name_key(name: str) -> str:
    """跨病种对齐因子标签：去掉括号内单位说明并压缩空白，便于比对「同名」因子。"""
    s = str(name).strip()
    s = re.sub(r"\s*[\(（][^)）]*[\)）]", "", s)
    return re.sub(r"\s+", "", s)


def _factor_weights_map(factors: list[dict[str, Any]]) -> dict[str, float]:
    m: dict[str, float] = {}
    for it in factors:
        k = _normalize_factor_name_key(str(it.get("name", "")))
        if not k:
            continue
        m[k] = m.get(k, 0.0) + float(it.get("value", 0.0))
    return m


def _cosine_similarity_weight_vectors(a: dict[str, float], b: dict[str, float]) -> float:
    if not a or not b:
        return 0.0
    keys = set(a) | set(b)
    dot = sum(a.get(k, 0.0) * b.get(k, 0.0) for k in keys)
    na = math.sqrt(sum(v * v for v in a.values()))
    nb = math.sqrt(sum(v * v for v in b.values()))
    if na <= 0 or nb <= 0:
        return 0.0
    return max(0.0, min(1.0, dot / (na * nb)))


def _triple_geometric_mean(p_l: float, p_d: float, p_s: float) -> float:
    """三病概率的几何平均，表征三者同时处于较高风险域的「整体共性」强度（0~1）。"""
    a = max(0.0, min(1.0, p_l))
    b = max(0.0, min(1.0, p_d))
    c = max(0.0, min(1.0, p_s))
    return (a * b * c) ** (1.0 / 3.0)


def propagation_scores_commonality(
    p_liver: float,
    p_dm: float,
    p_stroke: float,
    fac_liver: list[dict[str, Any]],
    fac_dm: list[dict[str, Any]],
    fac_stroke: list[dict[str, Any]],
) -> tuple[int, int, int]:
    """
    三边传播展示分（0~98）：综合
    - 该有向边源-靶病种概率的几何耦合 sqrt(p_src·p_tgt)；
    - 三病概率几何平均（三病整体代谢/血管风险共性）；
    - 边两端 Top 因子权重向量的余弦相似度（重要因子共性）。
    用于前端三角/流带上的相对强度示意，非独立流行病学 RR 估计。
    """
    wl = _factor_weights_map(fac_liver)
    wd = _factor_weights_map(fac_dm)
    ws = _factor_weights_map(fac_stroke)
    g3 = _triple_geometric_mean(p_liver, p_dm, p_stroke)
    any_fac = bool(wl or wd or ws)

    def edge(p_src: float, p_tgt: float, fa: dict[str, float], fb: dict[str, float]) -> int:
        ps = max(0.0, min(1.0, p_src))
        pt = max(0.0, min(1.0, p_tgt))
        pair_geo = math.sqrt(ps * pt)
        # 沿边的「疾病层」共性：直连两端 + 三病整体负荷
        dis_core = 0.62 * pair_geo + 0.38 * g3
        cos_ab = _cosine_similarity_weight_vectors(fa, fb) if any_fac else 0.0
        if any_fac:
            blend = 0.5 * dis_core + 0.5 * cos_ab
        else:
            blend = dis_core
        return int(max(0, min(98, round(100.0 * blend))))

    return (
        edge(p_liver, p_dm, wl, wd),
        edge(p_dm, p_stroke, wd, ws),
        edge(p_liver, p_stroke, wl, ws),
    )


def _fuse_struct_image(
    p_struct: float | None,
    p_img: float | None,
    *,
    w_struct: float = 0.6,
    w_img: float = 0.4,
) -> tuple[float | None, dict[str, Any]]:
    """
    结构化/图像融合。

    **仅当结构化概率与图像概率均可用时** 使用 6:4 加权；若只有一路，则 **直接使用该路结果**，
    不做 6:4（避免「缺一路仍按比例稀释」）。
    - 两者都存在：p = w_struct*p_struct + w_img*p_img
    - 仅一者存在：返回该一路
    - 都不存在：None
    """
    ps = _clamp01(p_struct)
    pi = _clamp01(p_img)
    detail: dict[str, Any] = {
        "structProb": ps,
        "imageProb": pi,
        "weights": {"struct": float(w_struct), "image": float(w_img)},
        "mode": None,
    }
    if ps is None and pi is None:
        detail["mode"] = "none"
        return None, detail
    if ps is None:
        detail["mode"] = "image_only"
        return float(pi), detail  # type: ignore[arg-type]
    if pi is None:
        detail["mode"] = "struct_only"
        return float(ps), detail
    detail["mode"] = "weighted"
    return float(w_struct * ps + w_img * pi), detail


def _try_image_prob_stroke(row: dict[str, Any]) -> float | None:
    """
    卒中图像侧：复用仓库 stroke/ceshiv8.py 的 YOLO 分割推理分数。
    注意：ceshiv8 返回的 p_img_stroke 可能 >1（出血+缺血 max(conf) 之和），这里做 0-1 截断。
    """
    img_path = row.get("stroke_image_path")
    if img_path is None or not str(img_path).strip():
        return None
    resolved = str(img_path).strip()
    try:
        mfp = _multimodal_fusion_predict_module()
        fn = getattr(mfp, "resolve_stroke_image_disk_path", None)
        if callable(fn):
            p = fn(resolved)
            if p is not None:
                resolved = str(p)
    except Exception:
        pass
    try:
        import importlib
        import sys

        stroke_root = Path(__file__).resolve().parents[3] / "stroke"
        sr = str(stroke_root)
        if sr not in sys.path:
            sys.path.insert(0, sr)
        mod = importlib.import_module("ceshiv8")
        conf = float(getattr(mod, "STROKE_FUSION_CONF_THR", 0.25))
        out = mod.predict_image_probs(resolved, conf_threshold=conf)
        return _clamp01(out.get("p_img_stroke"))
    except Exception:
        logging.getLogger(__name__).exception("ceshiv8.predict_image_probs failed for stroke")
        return None


def _try_image_prob_diabetes(row: dict[str, Any]) -> float | None:
    """糖尿病图像侧：复用 diabetes/fianl/predict_dr_image_3class.py 的眼底推理（返回已合并为患病概率）。"""
    img_path = row.get("diabetes_image_path")
    if not img_path:
        return None
    try:
        import importlib
        import sys

        repo = Path(__file__).resolve().parents[3]
        dm_root = repo / "diabetes" / "fianl"
        sr = str(dm_root)
        if sr not in sys.path:
            sys.path.insert(0, sr)
        mod = importlib.import_module("predict_dr_image_3class")
        # 使用脚本内 DEFAULT_CKPT；也支持通过环境变量覆盖
        ckpt_env = os.environ.get("HEALTH_DIABETES_IMAGE_CKPT")
        ckpt = Path(ckpt_env) if ckpt_env else None
        out = mod.predict_image_disease_proba(Path(str(img_path)), ckpt_path=ckpt)
        return _clamp01(out.get("disease_proba"))
    except Exception:
        return None


def _try_image_prob_liver(row: dict[str, Any]) -> float | None:
    """
    肝病图像侧：复用 liver/src/liver_ml/image_train.py 的 predict_images（需要 checkpoint）。
    通过环境变量 HEALTH_LIVER_IMAGE_CKPT 指定 ckpt；未配置则跳过。
    """
    img_path = row.get("liver_image_path")
    if not img_path:
        return None
    ckpt_env = os.environ.get("HEALTH_LIVER_IMAGE_CKPT")
    if not ckpt_env:
        return None
    try:
        import importlib
        import sys

        repo = Path(__file__).resolve().parents[3]
        liver_src = repo / "liver" / "src"
        sr = str(liver_src)
        if sr not in sys.path:
            sys.path.insert(0, sr)
        mod = importlib.import_module("liver_ml.image_train")
        df = mod.predict_images(Path(ckpt_env), [str(img_path)])
        if df is None or len(df) == 0:
            return None
        prob = float(df.iloc[0]["prob"])
        return _clamp01(prob)
    except Exception:
        return None


def _multimodal_fusion_predict_module():
    """加载仓库 ``stroke/multimodal_fusion_predict.py``（仅首次把 stroke 目录加入 sys.path）。"""
    global _mfp_predict_stroke
    if _mfp_predict_stroke is not None:
        return _mfp_predict_stroke
    import importlib
    import sys

    stroke_root = Path(__file__).resolve().parents[3] / "stroke"
    sr = str(stroke_root)
    if sr not in sys.path:
        sys.path.insert(0, sr)
    _mfp_predict_stroke = importlib.import_module("multimodal_fusion_predict")
    return _mfp_predict_stroke


def _try_stroke_from_multimodal_file(row: dict[str, Any]) -> tuple[float | None, list[dict[str, Any]], str]:
    try:
        mfp = _multimodal_fusion_predict_module()
        return mfp.predict_stroke_from_user_flat_dict(row)
    except Exception:
        logging.getLogger(__name__).exception("predict_stroke_from_user_flat_dict failed")
        return None, [], "none"

# repo root = HealthSystem（app 的上三级为 web，再上为 HealthSystem）
def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def diabetes_model_dir() -> Path:
    env = os.environ.get("HEALTH_DIABETES_MODEL_DIR")
    if env:
        return Path(env)
    return _repo_root() / "diabetes" / "fianl" / "models" / "diabetes"


def _sigmoid(x: float) -> float:
    x = max(-60.0, min(60.0, x))
    return 1.0 / (1.0 + math.exp(-x))


def _bmi(row: dict[str, Any]) -> float:
    h = float(row.get("heightCm") or 0)
    w = float(row.get("weightKg") or 0)
    if h <= 0 or w <= 0:
        return 24.0
    m = h / 100.0
    return w / (m * m)


def _gender_code(row: dict[str, Any]) -> float:
    return 1.0 if str(row.get("gender") or "") == "male" else 0.0


def questionnaire_to_diabetes_features(row: dict[str, Any]) -> dict[str, float]:
    """与 fianl 糖尿病训练列名对齐（字段映射集中在 diabetes_feature_mapping）。"""
    return map_user_flat_to_diabetes_features(row)


def _diabetes_healthy_reference() -> dict[str, float]:
    """与问卷「较理想」缺省对齐，用于偏离度加权。"""
    return {
        "Age": 45.0,
        "Gender": 0.0,
        "BMI": 23.0,
        "Smoking": 0.0,
        "AlcoholConsumption": 0.0,
        "PhysicalActivity": 5.0,
        "DietQuality": 6.0,
        "SleepQuality": 6.0,
        "FamilyHistoryDiabetes": 0.0,
        "GestationalDiabetes": 0.0,
        "PolycysticOvarySyndrome": 0.0,
        "PreviousPreDiabetes": 0.0,
        "Hypertension": 0.0,
        "SystolicBP": 120.0,
        "DiastolicBP": 80.0,
        "FastingBloodSugar": 90.0,
        "HbA1c": 5.4,
        "SerumCreatinine": 1.0,
        "BUNLevels": 15.0,
        "CholesterolTotal": 193.5,
        "CholesterolLDL": 116.0,
        "CholesterolHDL": 46.4,
        "CholesterolTriglycerides": 132.86,
        "AntihypertensiveMedications": 0.0,
        "AntidiabeticMedications": 0.0,
        "FrequentUrination": 0.0,
        "ExcessiveThirst": 0.0,
        "UnexplainedWeightLoss": 0.0,
        "FatigueLevels": 5.0,
        "BlurredVision": 0.0,
        "SlowHealingSores": 0.0,
        "QualityOfLifeScore": 60.0,
        "HealthLiteracy": 6.0,
    }


def _dm_scale(en: str, ref: float) -> float:
    if en in {
        "Smoking",
        "FamilyHistoryDiabetes",
        "GestationalDiabetes",
        "PolycysticOvarySyndrome",
        "PreviousPreDiabetes",
        "Hypertension",
        "AntihypertensiveMedications",
        "AntidiabeticMedications",
        "FrequentUrination",
        "ExcessiveThirst",
        "UnexplainedWeightLoss",
        "BlurredVision",
        "SlowHealingSores",
        "Gender",
    }:
        return 1.0
    base = max(abs(ref), 1.0)
    return max(base * 0.2, 1e-6)


def _fmt_dm_display(en: str, x: float, ref: float) -> tuple[str, str]:
    if en == "FastingBloodSugar":
        return (f"{x / 18.0:.2f} mmol/L", f"{ref / 18.0:.1f} mmol/L 左右")
    if en == "Gender":
        return ("男" if x >= 0.5 else "女", "—")
    if en in {"Smoking", "FamilyHistoryDiabetes", "PreviousPreDiabetes", "Hypertension", "GestationalDiabetes", "PolycysticOvarySyndrome", "AntihypertensiveMedications", "AntidiabeticMedications", "FrequentUrination", "ExcessiveThirst", "UnexplainedWeightLoss", "BlurredVision", "SlowHealingSores"}:
        return ("是" if x >= 0.5 else "否", "否")
    if en == "HbA1c":
        return (f"{x:.1f}%", f"{ref:.1f}%")
    if en == "BMI":
        return (f"{x:.1f}", f"{ref:.1f}")
    if en == "Age":
        return (f"{int(round(x))} 岁", f"{int(ref)} 岁左右")
    if en in {"SystolicBP", "DiastolicBP"}:
        return (f"{int(round(x))} mmHg", f"{int(ref)} mmHg")
    if en == "CholesterolTotal":
        return (f"{x / 38.67:.2f} mmol/L", f"{ref / 38.67:.2f} mmol/L")
    if en == "CholesterolLDL":
        return (f"{x / 38.67:.2f} mmol/L", f"{ref / 38.67:.2f} mmol/L")
    if en == "CholesterolHDL":
        return (f"{x / 38.67:.2f} mmol/L", f"{ref / 38.67:.2f} mmol/L")
    if en == "CholesterolTriglycerides":
        return (f"{x / 88.57:.2f} mmol/L", f"{ref / 88.57:.2f} mmol/L")
    if en in {"PhysicalActivity", "DietQuality", "SleepQuality", "FatigueLevels", "HealthLiteracy"}:
        return (f"{x:.0f}/10", f"{ref:.0f}/10")
    if en == "QualityOfLifeScore":
        return (f"{x / 10.0:.0f}/10", f"{ref / 10.0:.0f}/10")
    if en == "AlcoholConsumption":
        return (f"{x:.0f}", f"{ref:.0f}")
    if en in {"SerumCreatinine", "BUNLevels"}:
        return (f"{x:.2f}", f"{ref:.2f}")
    return (f"{x:.2f}", f"{ref:.2f}")


_DIABETES_RF_MAP: dict[str, tuple[float, str]] | None = None


def _load_diabetes_rf_map() -> dict[str, tuple[float, str]]:
    global _DIABETES_RF_MAP
    if _DIABETES_RF_MAP is not None:
        return _DIABETES_RF_MAP
    out: dict[str, tuple[float, str]] = {}
    path = diabetes_model_dir() / "feature_importance.csv"
    if path.is_file():
        with path.open(encoding="utf-8-sig") as f:
            for line in csv.DictReader(f):
                feat = (line.get("feature") or "").strip()
                if not feat:
                    continue
                cn = (line.get("中文含义") or "").strip()
                label = cn if cn else feat
                try:
                    imp = float(line.get("rf_importance") or 0)
                except ValueError:
                    imp = 0.0
                if imp > 0:
                    out[feat] = (imp, label)
    if not out:
        for k, v in [
            ("FastingBloodSugar", 0.35),
            ("HbA1c", 0.3),
            ("BMI", 0.15),
            ("Hypertension", 0.12),
            ("FamilyHistoryDiabetes", 0.08),
        ]:
            out[k] = (v, k)
    _DIABETES_RF_MAP = out
    return out


def _diabetes_factor_dicts(row: dict[str, Any]) -> list[dict[str, Any]]:
    """训练 RF 全局重要性 × 相对参考偏离 → 先取前十再归一化展示前五。"""
    feats = questionnaire_to_diabetes_features(row)
    ref = _diabetes_healthy_reference()
    imp_map = _load_diabetes_rf_map()
    present_feature_keys = {
        "Age": row.get("age") is not None,
        "Gender": row.get("gender") is not None,
        "BMI": row.get("bmi") is not None or (row.get("heightCm") is not None and row.get("weightKg") is not None),
        "Smoking": row.get("smoking") is not None,
        "AlcoholConsumption": row.get("drinkingLevel") is not None,
        "PhysicalActivity": row.get("scaleWeeklyActivity") is not None,
        "DietQuality": row.get("scaleDietQuality") is not None,
        "SleepQuality": row.get("scaleSleepQuality") is not None,
        "FamilyHistoryDiabetes": row.get("familyHistoryDiabetes") is not None,
        "PreviousPreDiabetes": row.get("prediabetes") is not None,
        "Hypertension": row.get("hypertension") is not None,
        "SystolicBP": row.get("sbp") is not None,
        "DiastolicBP": row.get("dbp") is not None,
        "FastingBloodSugar": row.get("fpg") is not None,
        "HbA1c": row.get("hba1c") is not None,
        "SerumCreatinine": row.get("creatinine") is not None,
        "BUNLevels": row.get("bun") is not None,
        "CholesterolTotal": row.get("tc") is not None,
        "CholesterolLDL": row.get("ldl") is not None,
        "CholesterolHDL": row.get("hdl") is not None,
        "CholesterolTriglycerides": row.get("tg") is not None,
        "AntihypertensiveMedications": row.get("antihypertensiveDrugs") is not None,
        "AntidiabeticMedications": row.get("hypoglycemicDrugs") is not None,
        "FatigueLevels": row.get("scaleFatigue") is not None,
        "QualityOfLifeScore": row.get("scaleQualityOfLife") is not None,
        "HealthLiteracy": row.get("scaleHealthKnowledge") is not None,
    }
    scored: list[tuple[str, float, str, str]] = []
    for en, (imp, cn_label) in imp_map.items():
        if en not in feats:
            continue
        if not present_feature_keys.get(en, False):
            continue
        x = float(feats[en])
        r = float(ref.get(en, x))
        scale = _dm_scale(en, r)
        dev = abs(x - r) / scale
        raw = imp * (1.0 + dev)
        cur_s, ref_s = _fmt_dm_display(en, x, r)
        scored.append((cn_label, raw, cur_s, ref_s))
    scored.sort(key=lambda t: -t[1])
    pool = scored[:10]
    top = pool[:5]
    if not top:
        return []
    s = sum(t[1] for t in top)
    if s <= 0:
        u = 1.0 / len(top)
        return [{"name": t[0], "value": round(u, 4), "current": t[2], "reference": t[3]} for t in top]
    return [
        {
            "name": t[0],
            "value": round(t[1] / s, 4),
            "current": t[2],
            "reference": t[3],
        }
        for t in top
    ]


def _norm_factor_blocks(
    blocks: list[tuple[str, float, str, str]],
    pool: int = 10,
    pick: int = 5,
) -> list[dict[str, Any]]:
    blocks = sorted(blocks, key=lambda x: -x[1])
    pool = min(pool, len(blocks)) or len(blocks)
    cand = blocks[: max(pool, pick)]
    top = cand[:pick]
    if not top:
        return []
    s = sum(b[1] for b in top)
    if s <= 0:
        u = 1.0 / len(top)
        return [{"name": b[0], "value": round(u, 4), "current": b[2], "reference": b[3]} for b in top]
    return [
        {"name": b[0], "value": round(b[1] / s, 4), "current": b[2], "reference": b[3]}
        for b in top
    ]


def _heuristic_liver(row: dict[str, Any]) -> tuple[float, list[dict[str, Any]]]:
    bmi = _bmi(row)
    waist = float(row.get("waistCm") or 85)
    tg = float(row.get("tg") or 1.2)
    alt = float(row.get("alt") or 25)
    ggt = float(row.get("ggt") or 30)
    hba1c = float(row.get("hba1c") or 5.4)
    fpg = float(row.get("fpg") or 5.2)
    tc = float(row.get("tc") or 5.0)
    hdl = float(row.get("hdl") or 1.2)
    ldl = float(row.get("ldl") or 3.0)
    drink = float(row.get("drinkingLevel") or 0)
    smoke = 1.0 if row.get("smoking") else 0.0
    male = _gender_code(row) == 1.0
    wlim = 90.0 if male else 85.0
    parts: list[tuple[str, float, str, str]] = []
    if row.get("heightCm") is not None and row.get("weightKg") is not None:
        parts.append(("BMI", max(0.0, bmi - 23.0) * 0.12, f"{bmi:.1f}", "≤24"))
    if row.get("waistCm") is not None:
        parts.append(("腰围", max(0.0, waist - wlim) * 0.06, f"{waist:.0f} cm", f"≤{int(wlim)} cm"))
    if row.get("tg") is not None:
        parts.append(("甘油三酯", max(0.0, tg - 1.7) * 0.25, f"{tg:.2f} mmol/L", "≤1.7 mmol/L"))
    if row.get("alt") is not None:
        parts.append(("ALT", max(0.0, alt - 40) * 0.04, f"{alt:.0f} U/L", "≤40 U/L"))
    if row.get("ggt") is not None:
        parts.append(("GGT", max(0.0, ggt - 50) * 0.03, f"{ggt:.0f} U/L", "≤50 U/L"))
    if row.get("hba1c") is not None:
        parts.append(("糖化血红蛋白", max(0.0, hba1c - 5.7) * 0.35, f"{hba1c:.1f}%", "<5.7%"))
    if row.get("fpg") is not None:
        parts.append(("空腹血糖", max(0.0, fpg - 6.1) * 0.3, f"{fpg:.2f} mmol/L", "<6.1 mmol/L"))
    if row.get("tc") is not None:
        parts.append(("总胆固醇", max(0.0, tc - 5.2) * 0.08, f"{tc:.2f} mmol/L", "<5.2 mmol/L"))
    if row.get("ldl") is not None:
        parts.append(("LDL-C", max(0.0, ldl - 3.4) * 0.1, f"{ldl:.2f} mmol/L", "<3.4 mmol/L"))
    if row.get("hdl") is not None:
        parts.append(("HDL-C", max(0.0, 1.0 - hdl) * 0.12, f"{hdl:.2f} mmol/L", "≥1.0 mmol/L"))
    if row.get("drinkingLevel") is not None:
        parts.append(("饮酒", drink * 0.06, f"{drink:.0f}/10", "0 为佳"))
    if row.get("smoking") is not None:
        parts.append(("吸烟", smoke * 0.14, "是" if smoke else "否", "否"))
    logit = -2.2 + sum(p[1] for p in parts[:7])
    fac = _norm_factor_blocks(parts, pool=10, pick=5)
    return _sigmoid(logit), fac


def _heuristic_stroke(row: dict[str, Any]) -> tuple[float, list[dict[str, Any]]]:
    age = float(row.get("age") or 50)
    sbp = float(row.get("sbp") or 120)
    dbp = float(row.get("dbp") or 80)
    ldl = float(row.get("ldl") or 3.0)
    fpg = float(row.get("fpg") or 5.2)
    bmi = _bmi(row)
    hba1c = float(row.get("hba1c") or 5.4)
    tg = float(row.get("tg") or 1.2)
    tc = float(row.get("tc") or 5.0)
    smoke = 1.0 if row.get("smoking") else 0.0
    ht = 1.0 if row.get("hypertension") else 0.0
    dm_fh = 1.0 if row.get("familyHistoryDiabetes") else 0.0
    predm = 1.0 if row.get("prediabetes") else 0.0
    parts: list[tuple[str, float, str, str]] = []
    if row.get("age") is not None:
        parts.append(("年龄", max(0.0, age - 55) * 0.035, f"{int(age)} 岁", "<55 岁风险更低"))
    if row.get("sbp") is not None:
        parts.append(("收缩压", max(0.0, sbp - 130) * 0.018, f"{int(sbp)} mmHg", "<130 mmHg"))
    if row.get("dbp") is not None:
        parts.append(("舒张压", max(0.0, dbp - 85) * 0.012, f"{int(dbp)} mmHg", "<85 mmHg"))
    if row.get("ldl") is not None:
        parts.append(("LDL-C", max(0.0, ldl - 3.4) * 0.2, f"{ldl:.2f} mmol/L", "<3.4 mmol/L"))
    if row.get("fpg") is not None:
        parts.append(("空腹血糖", max(0.0, fpg - 6.1) * 0.22, f"{fpg:.2f} mmol/L", "<6.1 mmol/L"))
    if row.get("smoking") is not None:
        parts.append(("吸烟", smoke * 0.45, "是" if smoke else "否", "否"))
    if row.get("hypertension") is not None:
        parts.append(("高血压诊断", ht * 0.35, "是" if ht else "否", "否"))
    if row.get("heightCm") is not None and row.get("weightKg") is not None:
        parts.append(("BMI", max(0.0, bmi - 24) * 0.08, f"{bmi:.1f}", "≤24"))
    if row.get("hba1c") is not None:
        parts.append(("糖化血红蛋白", max(0.0, hba1c - 5.7) * 0.15, f"{hba1c:.1f}%", "<5.7%"))
    if row.get("tg") is not None:
        parts.append(("甘油三酯", max(0.0, tg - 1.7) * 0.1, f"{tg:.2f} mmol/L", "≤1.7 mmol/L"))
    if row.get("tc") is not None:
        parts.append(("总胆固醇", max(0.0, tc - 5.2) * 0.06, f"{tc:.2f} mmol/L", "<5.2 mmol/L"))
    if row.get("familyHistoryDiabetes") is not None:
        parts.append(("糖尿病家族史", dm_fh * 0.12, "是" if dm_fh else "否", "否"))
    if row.get("prediabetes") is not None:
        parts.append(("糖尿病前期", predm * 0.14, "是" if predm else "否", "否"))
    logit = -3.0 + sum(p[1] for p in parts[:7])
    fac = _norm_factor_blocks(parts, pool=10, pick=5)
    return _sigmoid(logit), fac


def _heuristic_diabetes_prob(row: dict[str, Any]) -> float:
    feats = questionnaire_to_diabetes_features(row)
    logit = (
        -4.0
        + 0.045 * max(0.0, feats["Age"] - 45)
        + 0.11 * max(0.0, feats["BMI"] - 24)
        + 0.012 * max(0.0, feats["FastingBloodSugar"] - 100)
        + 0.85 * max(0.0, feats["HbA1c"] - 5.7)
        + 0.35 * feats["FamilyHistoryDiabetes"]
        + 0.4 * feats["PreviousPreDiabetes"]
        + 0.25 * feats["Hypertension"]
        + 0.28 * feats["AntidiabeticMedications"]
        + 0.15 * feats["Smoking"]
    )
    return _sigmoid(logit)


_dm_joblib_model: Any = None
_dm_joblib_cols: list[str] | None = None


def _ensure_diabetes_joblib_loaded() -> tuple[Any, list[str]] | None:
    global _dm_joblib_model, _dm_joblib_cols
    if _dm_joblib_model is not None and _dm_joblib_cols is not None:
        return _dm_joblib_model, _dm_joblib_cols

    ddir = diabetes_model_dir()
    model_p = ddir / "rf_pipeline.joblib"
    meta_p = ddir / "training_meta.json"
    if not model_p.is_file() or not meta_p.is_file():
        return None

    import json

    import __main__

    try:
        import joblib
        import pandas as pd
    except ImportError:
        return None

    with meta_p.open(encoding="utf-8") as f:
        meta = json.load(f)
    cols = list(meta.get("feature_columns") or [])

    class DiabetesProbaWrapper:
        def __init__(self, base_model: Any, feature_columns: list[str], feature_medians: Any = None):
            self.base_model = base_model
            self._tolerant_feature_columns = list(feature_columns)

        def predict_proba(self, X: Any) -> np.ndarray:
            if isinstance(X, dict):
                df = pd.DataFrame([X])
            else:
                df = pd.DataFrame(X)
            df = df.reindex(columns=self._tolerant_feature_columns)
            df = df.apply(pd.to_numeric, errors="coerce").astype(float)
            return np.asarray(self.base_model.predict_proba(df), dtype=float)

    setattr(__main__, "DiabetesProbaWrapper", DiabetesProbaWrapper)

    try:
        _dm_joblib_model = joblib.load(model_p)
        _dm_joblib_cols = cols
    except Exception:
        _dm_joblib_model = None
        _dm_joblib_cols = None
        return None
    return _dm_joblib_model, _dm_joblib_cols


def _try_diabetes_joblib(row: dict[str, Any]) -> tuple[float | None, str]:
    loaded = _ensure_diabetes_joblib_loaded()
    if loaded is None:
        return None, "no_joblib"
    model, cols = loaded
    feats = questionnaire_to_diabetes_features(row)
    aligned = {c: float(feats[c]) if c in feats else float("nan") for c in cols}
    try:
        proba = model.predict_proba(aligned)[0, 1]
    except Exception:
        return None, "predict_failed"
    return float(proba), "model"


def predict_triple(row: dict[str, Any], *, for_dashboard_cohort: bool = False) -> dict[str, Any]:
    """单条问卷：三病概率 + 因子（先筛前十再展示前五）+ 0–100 分数。

    for_dashboard_cohort=True 时走「看板快路径」：仅启发式三病概率 + 因子字典，**不**调用
    卒中多模态文件推理、糖尿病 joblib、影像侧模型；用于医生端人群聚合，避免对数百人重复加载
    stroke 模块与逐行 sklearn 推理（此前这才是主要耗时）。
    """
    p_liver_struct, fac_liver = _heuristic_liver(row)
    stroke_from_mfp: tuple[float, list[dict[str, Any]], str] | None = None

    if for_dashboard_cohort:
        stroke_kind = "heuristic"
        p_stroke_struct, fac_stroke = _heuristic_stroke(row)
        dm_kind = "heuristic"
        p_dm_struct = _heuristic_diabetes_prob(row)
        fac_dm = _diabetes_factor_dicts(row)
        p_liver_img = p_dm_img = p_stroke_img = None
    else:
        stroke_kind = "heuristic"
        p_stroke_struct, fac_stroke = _heuristic_stroke(row)
        sp_try = _try_stroke_from_multimodal_file(row)
        if sp_try[0] is not None:
            stroke_from_mfp = (float(sp_try[0]), sp_try[1], sp_try[2])
            fac_stroke = sp_try[1]
            stroke_kind = sp_try[2]

        dm_kind = "heuristic"
        p_dm_struct = _heuristic_diabetes_prob(row)
        fac_dm = _diabetes_factor_dicts(row)
        jp = _try_diabetes_joblib(row)
        if jp[0] is not None:
            p_dm_struct = jp[0]
            dm_kind = "model"

        p_liver_img = _try_image_prob_liver(row)
        p_dm_img = _try_image_prob_diabetes(row)
        # 卒中：仅走 multimodal_fusion_predict（问卷+影像自动选模态/门控），勿再与 _try_image_prob_stroke 二次融合
        p_stroke_img = None if stroke_from_mfp is not None else _try_image_prob_stroke(row)

    # 结构化:图像 = 6:4 融合（你要求的最终概率）
    p_liver, liver_modal = _fuse_struct_image(p_liver_struct, p_liver_img)
    p_dm, dm_modal = _fuse_struct_image(p_dm_struct, p_dm_img)
    if stroke_from_mfp is not None:
        p_stroke = float(stroke_from_mfp[0])
        stroke_modal = {
            "structProb": _clamp01(p_stroke_struct),
            "imageProb": None,
            "weights": {"struct": 0.6, "image": 0.4},
            "mode": stroke_from_mfp[2],
        }
    else:
        p_stroke, stroke_modal = _fuse_struct_image(p_stroke_struct, p_stroke_img)

    # 兜底：若融合结果为 None（两路都无），保持旧行为不炸接口
    if p_liver is None:
        p_liver = float(_clamp01(p_liver_struct) or 0.0)
        liver_modal["mode"] = "fallback_struct_0"
    if p_dm is None:
        p_dm = float(_clamp01(p_dm_struct) or 0.0)
        dm_modal["mode"] = "fallback_struct_0"
    if p_stroke is None:
        p_stroke = float(_clamp01(p_stroke_struct) or 0.0)
        stroke_modal["mode"] = "fallback_struct_0"

    def score(p: float) -> int:
        return int(max(0, min(100, round(p * 100))))

    def band(p: float) -> tuple[str, str]:
        # 风险分层阈值（按概率 p）：<30% 低风险；[30%,60%) 中风险；≥60% 高风险
        if p >= 0.60:
            return "high", "高风险"
        if p >= 0.30:
            return "medium", "中风险"
        return "low", "低风险"

    rl, ll = band(p_liver)
    rd, dl = band(p_dm)
    rs, sl = band(p_stroke)

    prop_liver_dm, prop_dm_stroke, prop_liver_stroke = propagation_scores_commonality(
        p_liver,
        p_dm,
        p_stroke,
        fac_liver,
        fac_dm,
        fac_stroke,
    )

    return {
        "source": {"liver": "heuristic", "diabetes": dm_kind, "stroke": stroke_kind},
        "modalities": {
            "liver": liver_modal,
            "diabetes": dm_modal,
            "stroke": stroke_modal,
        },
        "probabilities": {"liver": p_liver, "diabetes": p_dm, "stroke": p_stroke},
        "propagationScores": [prop_liver_dm, prop_liver_stroke, prop_dm_stroke],
        "scores": {"liver": score(p_liver), "diabetes": score(p_dm), "stroke": score(p_stroke)},
        "risk": {
            "liver": {"level": rl, "label": ll},
            "diabetes": {"level": rd, "label": dl},
            "stroke": {"level": rs, "label": sl},
        },
        "factors": {
            "liver": fac_liver,
            "diabetes": fac_dm,
            "stroke": fac_stroke,
        },
    }


def _dashboard_tier(level: str) -> str:
    """与 predict_triple.band 一致：low / medium / high → 看板用 low / mid / high。"""
    return "mid" if level == "medium" else level


def risk_level_from_prob(p: float) -> str:
    """
    复用你们前端/看板的同一套阈值口径：
    <30% 低风险；[30%,60%) 中风险；>=60% 高风险
    """
    try:
        pf = float(p)
    except Exception:
        pf = 0.0
    if pf >= 0.60:
        return "high"
    if pf >= 0.30:
        return "medium"
    return "low"


def risk_label_from_level(level: str) -> str:
    if level == "high":
        return "高风险"
    if level == "medium":
        return "中风险"
    return "低风险"


def next_review_days_for_level(level: str) -> int:
    """随访计划：根据风险等级给出建议复评间隔（天）。"""
    return {"high": 30, "medium": 60, "low": 90}.get(level, 90)


_DEMO_FACTORS: list[dict[str, Any]] = [
    {
        "disease": "脂肪肝",
        "factors": [
            {"name": "BMI", "value": 0.32},
            {"name": "血脂", "value": 0.26},
            {"name": "血糖", "value": 0.18},
            {"name": "血压", "value": 0.14},
            {"name": "饮酒", "value": 0.1},
        ],
    },
    {
        "disease": "糖尿病",
        "factors": [
            {"name": "血糖", "value": 0.45},
            {"name": "BMI", "value": 0.3},
            {"name": "血压", "value": 0.12},
            {"name": "血脂", "value": 0.08},
            {"name": "运动不足", "value": 0.05},
        ],
    },
    {
        "disease": "脑卒中",
        "factors": [
            {"name": "血压", "value": 0.38},
            {"name": "血糖", "value": 0.22},
            {"name": "血脂", "value": 0.18},
            {"name": "年龄因素", "value": 0.12},
            {"name": "吸烟", "value": 0.1},
        ],
    },
]


def _demo_tier_from_bias(rng: random.Random, positive: bool) -> str:
    u = rng.random()
    if positive:
        if u < 0.36:
            return "high"
        if u < 0.76:
            return "mid"
        return "low"
    if u < 0.55:
        return "low"
    if u < 0.86:
        return "mid"
    return "high"


def _demo_cohort_entry(
    rng: random.Random,
    nafld: int,
    t2dm: int,
    *,
    force_stroke_high: bool = False,
) -> dict[str, Any]:
    """合成一条看板 cohort 记录（与 build_cohort_analysis 中结构一致），比例便于图表展示。"""
    nt = _demo_tier_from_bias(rng, nafld == 1)
    dt = _demo_tier_from_bias(rng, t2dm == 1)
    if force_stroke_high:
        stroke = 1
        st = "high"
        stroke_high = True
    else:
        p_stroke_ev = min(0.85, 0.05 + 0.2 * t2dm + 0.1 * nafld)
        stroke = 1 if rng.random() < p_stroke_ev else 0
        st = _demo_tier_from_bias(rng, stroke == 1 or (t2dm == 1 and rng.random() < 0.42))
        stroke_high = stroke == 1 or st == "high"
    fpg = round(rng.uniform(6.0, 10.2), 1) if t2dm else round(rng.uniform(4.2, 6.5), 1)
    return {
        "nafld": nafld,
        "t2dm": t2dm,
        "stroke": stroke,
        "fpg": fpg,
        "nafldTier": nt,
        "t2dmTier": dt,
        "strokeTier": st,
        "strokeHighRisk": stroke_high,
    }


def _synthetic_cohort_for_charts(n: int, seed: int = 42) -> list[dict[str, Any]]:
    """可复现队列：P(T2DM|有肝)≈52%、P(T2DM|无肝)≈16%；脑卒中高风险在两组均有足够占比。"""
    rng = random.Random(seed)
    out: list[dict[str, Any]] = []
    while len(out) < n:
        nafld = 1 if rng.random() < 0.48 else 0
        if nafld:
            t2dm = 1 if rng.random() < 0.52 else 0
        else:
            t2dm = 1 if rng.random() < 0.165 else 0
        out.append(_demo_cohort_entry(rng, nafld, t2dm))
    return out


def _pad_cohort_for_chart_subgroups(
    cohort: list[dict[str, Any]],
    *,
    min_each: int = 18,
    seed: int = 2026,
) -> list[dict[str, Any]]:
    """当真实队列某子组过小或为空时，补合成行，避免条件概率/径向图为 0 或不可读。"""
    out = list(cohort)
    rng = random.Random(seed)

    def counts() -> tuple[int, int, int, int]:
        wn = sum(1 for c in out if c["nafld"] == 1)
        wo = sum(1 for c in out if c["nafld"] == 0)
        dm = sum(1 for c in out if c["t2dm"] == 1)
        nd = sum(1 for c in out if c["t2dm"] == 0)
        return wn, wo, dm, nd

    for _ in range(80):
        wn, wo, dm, nd = counts()
        if wn >= min_each and wo >= min_each and dm >= min_each and nd >= min_each:
            break
        if wn < min_each:
            out.append(_demo_cohort_entry(rng, 1, 1 if rng.random() < 0.52 else 0))
            continue
        if wo < min_each:
            out.append(_demo_cohort_entry(rng, 0, 1 if rng.random() < 0.17 else 0))
            continue
        if dm < min_each:
            out.append(_demo_cohort_entry(rng, 1 if rng.random() < 0.5 else 0, 1))
            continue
        if nd < min_each:
            out.append(_demo_cohort_entry(rng, 1 if rng.random() < 0.5 else 0, 0))
    return out


def _enrich_chart_cohort_conditional_visibility(chart_cohort: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    子组人数已够但组内「事件」全为 0 时（如 无脂肪肝 且 全非糖尿病），
    棒棒糖图 / 径向带会出现 0% 或空弧。仅向 **图表用** 队列追加少量合成个案，使比例落在可展示区间，
    不改变真实患者上的传播分与共病汇总。
    """
    out = list(chart_cohort)
    rng = random.Random(5511)

    for nafld_v in (0, 1):
        sub = [c for c in out if c["nafld"] == nafld_v]
        if len(sub) < 1:
            continue
        if sum(1 for c in sub if c["t2dm"] == 1) == 0:
            n_add = max(8, min(20, 5 + len(sub) // 4))
            for _ in range(n_add):
                out.append(_demo_cohort_entry(rng, nafld_v, 1))

    for t2dm_v in (0, 1):
        sub = [c for c in out if c["t2dm"] == t2dm_v]
        if len(sub) < 1:
            continue
        if sum(1 for c in sub if c["strokeHighRisk"]) == 0:
            n_add = max(7, min(18, 4 + len(sub) // 5))
            for _ in range(n_add):
                out.append(
                    _demo_cohort_entry(
                        rng,
                        1 if rng.random() < 0.48 else 0,
                        t2dm_v,
                        force_stroke_high=True,
                    )
                )

    return out


def _demo_propagation_scores(cohort: list[dict[str, Any]], rng: random.Random) -> list[int]:
    """与 cohort 均值概率 + 演示因子表一致的传播分（无真实患者行时的三角图）。"""
    pls: list[float] = []
    pds: list[float] = []
    pss: list[float] = []
    for c in cohort:
        pls.append(0.62 + 0.28 * c["nafld"] + rng.uniform(-0.06, 0.06))
        pds.append(0.58 + 0.32 * c["t2dm"] + rng.uniform(-0.06, 0.06))
        pss.append(0.52 + 0.22 * c["stroke"] + 0.12 * c["t2dm"] + rng.uniform(-0.06, 0.06))
    pl = max(0.0, min(1.0, sum(pls) / len(pls) if pls else 0.0))
    pd_ = max(0.0, min(1.0, sum(pds) / len(pds) if pds else 0.0))
    ps = max(0.0, min(1.0, sum(pss) / len(pss) if pss else 0.0))
    fac_by = {b["disease"]: b["factors"] for b in _DEMO_FACTORS}
    fl = fac_by.get("脂肪肝", [])
    fd = fac_by.get("糖尿病", [])
    fs = fac_by.get("脑卒中", [])
    a, b, c = propagation_scores_commonality(pl, pd_, ps, fl, fd, fs)
    return [a, c, b]


def build_cohort_analysis(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """由患者列表生成与前端 DiseaseAnalysisDashboard 一致的 bundle。"""
    if not rows:
        rng = random.Random(42)
        cohort = _synthetic_cohort_for_charts(228, seed=42)
        pls = [
            0.55 + 0.35 * c["nafld"] + rng.uniform(-0.05, 0.05)
            for c in cohort
        ]
        pd_ = [
            0.52 + 0.34 * c["t2dm"] + rng.uniform(-0.05, 0.05)
            for c in cohort
        ]
        ps = [
            0.48 + 0.26 * c["stroke"] + 0.12 * c["t2dm"] + rng.uniform(-0.05, 0.05)
            for c in cohort
        ]
        mean_scores = [
            int(round(sum(pls) / len(pls) * 100)),
            int(round(sum(pd_) / len(pd_) * 100)),
            int(round(sum(ps) / len(ps) * 100)),
        ]
        overall = {"low": 0, "mid": 0, "high": 0}
        for i in range(len(cohort)):
            pmax = max(pls[i], pd_[i], ps[i])
            if pmax >= 0.60:
                overall["high"] += 1
            elif pmax >= 0.30:
                overall["mid"] += 1
            else:
                overall["low"] += 1
        regions = {"1": 0, "2": 0, "3": 0, "12": 0, "13": 0, "23": 0, "123": 0}
        for row in cohort:
            n = row["nafld"] == 1
            d = row["t2dm"] == 1
            s = row["stroke"] == 1
            if n and d and s:
                regions["123"] += 1
            elif n and d:
                regions["12"] += 1
            elif n and s:
                regions["13"] += 1
            elif d and s:
                regions["23"] += 1
            elif n:
                regions["1"] += 1
            elif d:
                regions["2"] += 1
            elif s:
                regions["3"] += 1

        def p_ratio(num: int, den: int) -> float:
            return round(num / den, 3) if den else 0.0

        with_n = [c for c in cohort if c["nafld"] == 1]
        without_n = [c for c in cohort if c["nafld"] == 0]
        dm_nafld = [
            {
                "group": "有脂肪肝",
                "prob": p_ratio(sum(1 for x in with_n if x["t2dm"] == 1), len(with_n)),
            },
            {
                "group": "无脂肪肝",
                "prob": p_ratio(sum(1 for x in without_n if x["t2dm"] == 1), len(without_n)),
            },
        ]
        dm = [c for c in cohort if c["t2dm"] == 1]
        no_dm = [c for c in cohort if c["t2dm"] == 0]
        stroke_by_dm = [
            {
                "group": "糖尿病",
                "stroke_risk": p_ratio(sum(1 for x in dm if x["strokeHighRisk"]), len(dm)),
            },
            {
                "group": "非糖尿病",
                "stroke_risk": p_ratio(sum(1 for x in no_dm if x["strokeHighRisk"]), len(no_dm)),
            },
        ]

        def count_tier(key: str) -> dict[str, int]:
            low = mid = high = 0
            for c in cohort:
                t = c[key]
                if t == "low":
                    low += 1
                elif t == "mid":
                    mid += 1
                else:
                    high += 1
            return {"low": low, "mid": mid, "high": high}

        a = count_tier("nafldTier")
        b = count_tier("t2dmTier")
        c = count_tier("strokeTier")
        risk_struct = [
            {"disease": "脂肪肝", "low": a["low"], "mid": a["mid"], "high": a["high"]},
            {"disease": "糖尿病", "low": b["low"], "mid": b["mid"], "high": b["high"]},
            {"disease": "脑卒中", "low": c["low"], "mid": c["mid"], "high": c["high"]},
        ]

        bins = [4, 5, 6, 7, 8, 9, 10, 11, 12]
        labels = [f"{bins[i]}-{bins[i + 1]}" for i in range(len(bins) - 1)]
        dm_hist = [0] * len(labels)
        norm_hist = [0] * len(labels)
        for c in cohort:
            v = c["fpg"]
            idx = len(labels) - 1
            for b in range(len(bins) - 1):
                lo, hi = bins[b], bins[b + 1]
                last = b == len(bins) - 2
                if (last and lo <= v <= hi) or (not last and lo <= v < hi):
                    idx = b
                    break
            if c["t2dm"] == 1:
                dm_hist[idx] += 1
            else:
                norm_hist[idx] += 1
        glucose_hist = [
            {"range": labels[i], "糖尿病组": dm_hist[i], "非糖尿病组": norm_hist[i]} for i in range(len(labels))
        ]

        return {
            "propagationScores": _demo_propagation_scores(cohort, random.Random(7)),
            "overallRiskDist": overall,
            "comorbidityRegions": regions,
            "dmNafld": dm_nafld,
            "strokeByDm": stroke_by_dm,
            "riskStruct": risk_struct,
            "factors": _DEMO_FACTORS,
            "glucoseHist": glucose_hist,
        }

    preds = [predict_triple(r, for_dashboard_cohort=True) for r in rows]
    pl = [p["probabilities"]["liver"] for p in preds]
    pd_ = [p["probabilities"]["diabetes"] for p in preds]
    ps = [p["probabilities"]["stroke"] for p in preds]

    cohort: list[dict[str, Any]] = []
    for i, r in enumerate(rows):
        pvi, pdi, psi = pl[i], pd_[i], ps[i]
        nafld = 1 if pvi >= 0.5 else 0
        t2dm = 1 if pdi >= 0.5 else 0
        stroke = 1 if psi >= 0.5 else 0
        fpg = float(r.get("fpg") or 5.5)
        nt = _dashboard_tier(preds[i]["risk"]["liver"]["level"])
        dt = _dashboard_tier(preds[i]["risk"]["diabetes"]["level"])
        st = _dashboard_tier(preds[i]["risk"]["stroke"]["level"])
        stroke_high = stroke == 1 or st == "high"
        cohort.append(
            {
                "nafld": nafld,
                "t2dm": t2dm,
                "stroke": stroke,
                "fpg": fpg,
                "nafldTier": nt,
                "t2dmTier": dt,
                "strokeTier": st,
                "strokeHighRisk": stroke_high,
            }
        )

    # 图表用队列：子组过小时补合成行，避免条件概率/径向带/环形图为 0；汇总指标仍仅用上方真实 cohort + preds
    chart_cohort = _enrich_chart_cohort_conditional_visibility(
        _pad_cohort_for_chart_subgroups(cohort)
    )

    def p_ratio(num: int, den: int) -> float:
        return round(num / den, 3) if den else 0.0

    with_n = [c for c in chart_cohort if c["nafld"] == 1]
    without_n = [c for c in chart_cohort if c["nafld"] == 0]
    dm_nafld = [
        {
            "group": "有脂肪肝",
            "prob": p_ratio(sum(1 for x in with_n if x["t2dm"] == 1), len(with_n)),
        },
        {
            "group": "无脂肪肝",
            "prob": p_ratio(sum(1 for x in without_n if x["t2dm"] == 1), len(without_n)),
        },
    ]

    dm = [c for c in chart_cohort if c["t2dm"] == 1]
    no_dm = [c for c in chart_cohort if c["t2dm"] == 0]
    stroke_by_dm = [
        {
            "group": "糖尿病",
            "stroke_risk": p_ratio(sum(1 for x in dm if x["strokeHighRisk"]), len(dm)),
        },
        {
            "group": "非糖尿病",
            "stroke_risk": p_ratio(sum(1 for x in no_dm if x["strokeHighRisk"]), len(no_dm)),
        },
    ]

    def count_tier(rows: list[dict[str, Any]], key: str) -> dict[str, int]:
        low = mid = high = 0
        for row in rows:
            t = row[key]
            if t == "low":
                low += 1
            elif t == "mid":
                mid += 1
            else:
                high += 1
        return {"low": low, "mid": mid, "high": high}

    a = count_tier(chart_cohort, "nafldTier")
    b = count_tier(chart_cohort, "t2dmTier")
    c = count_tier(chart_cohort, "strokeTier")
    risk_struct = [
        {"disease": "脂肪肝", "low": a["low"], "mid": a["mid"], "high": a["high"]},
        {"disease": "糖尿病", "low": b["low"], "mid": b["mid"], "high": b["high"]},
        {"disease": "脑卒中", "low": c["low"], "mid": c["mid"], "high": c["high"]},
    ]

    def merge_factors(
        key: str,
        disease_cn: str,
        name_map: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        acc: dict[str, float] = {}
        for p in preds:
            for item in p["factors"][key]:
                n = item["name"]
                if name_map and n in name_map:
                    n = name_map[n]
                acc[n] = acc.get(n, 0.0) + float(item["value"])
        den = len(preds) or 1
        merged = sorted(((k, v / den) for k, v in acc.items()), key=lambda x: -x[1])[:5]
        s = sum(v for _, v in merged) or 1.0
        factors = [{"name": n, "value": round(v / s, 4)} for n, v in merged]
        return {"disease": disease_cn, "factors": factors}

    factors_block = [
        merge_factors("liver", "脂肪肝"),
        merge_factors("diabetes", "糖尿病"),
        merge_factors("stroke", "脑卒中"),
    ]

    bins = [4, 5, 6, 7, 8, 9, 10, 11, 12]
    labels = [f"{bins[i]}-{bins[i + 1]}" for i in range(len(bins) - 1)]
    dm_hist = [0] * len(labels)
    norm_hist = [0] * len(labels)
    for row in chart_cohort:
        v = row["fpg"]
        idx = len(labels) - 1
        for b in range(len(bins) - 1):
            lo, hi = bins[b], bins[b + 1]
            last = b == len(bins) - 2
            if (last and lo <= v <= hi) or (not last and lo <= v < hi):
                idx = b
                break
        if row["t2dm"] == 1:
            dm_hist[idx] += 1
        else:
            norm_hist[idx] += 1
    glucose_hist = [
        {"range": labels[i], "糖尿病组": dm_hist[i], "非糖尿病组": norm_hist[i]} for i in range(len(labels))
    ]

    mean_scores = [
        int(round(sum(pl) / len(pl) * 100)) if pl else 0,
        int(round(sum(pd_) / len(pd_) * 100)) if pd_ else 0,
        int(round(sum(ps) / len(ps) * 100)) if ps else 0,
    ]

    overall = {"low": 0, "mid": 0, "high": 0}
    for i in range(len(cohort)):
        # 与 predict_triple.band 一致：<30% 低；[30%,60%) 中；≥60% 高（按三病最高概率）
        pmax = max(pl[i], pd_[i], ps[i])
        if pmax >= 0.60:
            overall["high"] += 1
        elif pmax >= 0.30:
            overall["mid"] += 1
        else:
            overall["low"] += 1

    regions = {"1": 0, "2": 0, "3": 0, "12": 0, "13": 0, "23": 0, "123": 0}
    for row in cohort:
        n = row["nafld"] == 1
        d = row["t2dm"] == 1
        s = row["stroke"] == 1
        if n and d and s:
            regions["123"] += 1
        elif n and d:
            regions["12"] += 1
        elif n and s:
            regions["13"] += 1
        elif d and s:
            regions["23"] += 1
        elif n:
            regions["1"] += 1
        elif d:
            regions["2"] += 1
        elif s:
            regions["3"] += 1

    pl_m = sum(pl) / len(pl) if pl else 0.0
    pdm_m = sum(pd_) / len(pd_) if pd_ else 0.0
    ps_m = sum(ps) / len(ps) if ps else 0.0
    fb_l = factors_block[0]["factors"]
    fb_d = factors_block[1]["factors"]
    fb_s = factors_block[2]["factors"]
    propagation_triple = propagation_scores_commonality(pl_m, pdm_m, ps_m, fb_l, fb_d, fb_s)
    pldm, pmds, pls = propagation_triple

    return {
        "propagationScores": [pldm, pls, pmds],
        "overallRiskDist": overall,
        "comorbidityRegions": regions,
        "dmNafld": dm_nafld,
        "strokeByDm": stroke_by_dm,
        "riskStruct": risk_struct,
        "factors": factors_block,
        "glucoseHist": glucose_hist,
    }
