"""糖尿病模型固定映射：数据库/扁平问卷字段 -> diabetes feature_columns。"""

from __future__ import annotations

import math
from typing import Any


def _first_present(d: dict[str, Any], *keys: str) -> Any:
    for k in keys:
        if k in d and d.get(k) is not None:
            return d.get(k)
    return None


def _as_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(f):
        return None
    return f


def _bool01(v: Any) -> float:
    if v is True or v == 1:
        return 1.0
    if isinstance(v, str):
        s = v.strip().lower()
        if s in {"1", "yes", "y", "true", "是"}:
            return 1.0
    return 0.0


def _bmi_from_user_flat(d: dict[str, Any]) -> float:
    b = _as_float(_first_present(d, "bmi", "BMI"))
    if b is not None:
        return b
    h = _as_float(_first_present(d, "heightCm", "height"))
    w = _as_float(_first_present(d, "weightKg", "weight"))
    if h is None or w is None or h <= 0:
        return 24.0
    return w / ((h / 100.0) ** 2)


def _gender_code(v: Any) -> float:
    if isinstance(v, (int, float)):
        x = float(v)
        if x in (1.0, 2.0):
            return 1.0 if x == 1.0 else 0.0
    if isinstance(v, str):
        s = v.strip().lower()
        if s in {"male", "m", "男", "1"}:
            return 1.0
    return 0.0


def map_user_flat_to_diabetes_features(d: dict[str, Any]) -> dict[str, float]:
    """
    生成与 diabetes training_meta.feature_columns 一致的 33 维特征。
    不改模型字段名，仅做数据库/问卷字段对齐与单位换算。
    """
    bmi = _bmi_from_user_flat(d)
    age = _as_float(_first_present(d, "age", "Age")) or 45.0
    gender = _gender_code(_first_present(d, "gender", "Gender"))
    fpg_mmol = _as_float(_first_present(d, "fpg", "fasting_blood_glucose")) or 5.5
    fpg_mg = fpg_mmol * 18.0
    hba1c = _as_float(_first_present(d, "hba1c", "HbA1c")) or 5.5

    sbp = _as_float(_first_present(d, "sbp", "systolic_bp")) or 120.0
    dbp = _as_float(_first_present(d, "dbp", "diastolic_bp")) or 80.0

    tc_mmol = _as_float(_first_present(d, "tc", "total_cholesterol")) or 5.0
    ldl_mmol = _as_float(_first_present(d, "ldl", "ldl_c")) or 3.0
    hdl_mmol = _as_float(_first_present(d, "hdl", "hdl_c")) or 1.2
    tg_mmol = _as_float(_first_present(d, "tg", "triglyceride")) or 1.5

    creatinine = _as_float(_first_present(d, "creatinine", "serum_creatinine")) or 1.0
    bun = _as_float(_first_present(d, "bun", "urea_nitrogen")) or 15.0

    scale_weekly_activity = _as_float(_first_present(d, "scaleWeeklyActivity", "weekly_exercise_time")) or 3.0
    scale_diet = _as_float(_first_present(d, "scaleDietQuality", "diet_quality")) or 5.0
    scale_sleep = _as_float(_first_present(d, "scaleSleepQuality", "sleep_quality")) or 5.0
    scale_fatigue = _as_float(_first_present(d, "scaleFatigue", "fatigue_level")) or 5.0
    scale_qol = _as_float(_first_present(d, "scaleQualityOfLife", "life_quality")) or 6.0
    scale_health_knowledge = _as_float(_first_present(d, "scaleHealthKnowledge", "health_knowledge")) or 6.0

    alcohol = _as_float(_first_present(d, "drinkingLevel", "drinking_frequency")) or 0.0

    smoking = _bool01(_first_present(d, "smoking", "SMQ020"))
    fh_dm = _bool01(_first_present(d, "familyHistoryDiabetes", "family_diabetes"))
    pre_dm = _bool01(_first_present(d, "prediabetes", "pre_diabetes"))
    htn = _bool01(_first_present(d, "hypertension", "has_hypertension"))
    anti_htn = _bool01(_first_present(d, "antihypertensiveDrugs", "use_antihypertensive"))
    anti_dm = _bool01(_first_present(d, "hypoglycemicDrugs", "use_hypoglycemic"))

    frequent_uri = _bool01(_first_present(d, "symptomPolyuria", "frequent_urination")) or (1.0 if fpg_mmol >= 7.0 else 0.0)
    thirst = _bool01(_first_present(d, "symptomThirst", "excessive_thirst")) or (1.0 if fpg_mmol >= 7.0 else 0.0)
    weight_loss = _bool01(_first_present(d, "symptomWeightLoss", "unexplained_weight_loss"))
    blur = _bool01(_first_present(d, "symptomBlurVision", "blurred_vision"))
    slow_heal = _bool01(_first_present(d, "symptomSlowHealing", "slow_wound_healing"))

    return {
        "Age": age,
        "Gender": gender,
        "BMI": bmi,
        "Smoking": smoking,
        "AlcoholConsumption": alcohol,
        "PhysicalActivity": scale_weekly_activity,
        "DietQuality": scale_diet,
        "SleepQuality": scale_sleep,
        "FamilyHistoryDiabetes": fh_dm,
        "GestationalDiabetes": 0.0,
        "PolycysticOvarySyndrome": 0.0,
        "PreviousPreDiabetes": pre_dm,
        "Hypertension": htn,
        "SystolicBP": sbp,
        "DiastolicBP": dbp,
        "FastingBloodSugar": fpg_mg,
        "HbA1c": hba1c,
        "SerumCreatinine": creatinine,
        "BUNLevels": bun,
        "CholesterolTotal": tc_mmol * 38.67,
        "CholesterolLDL": ldl_mmol * 38.67,
        "CholesterolHDL": hdl_mmol * 38.67,
        "CholesterolTriglycerides": tg_mmol * 88.57,
        "AntihypertensiveMedications": anti_htn,
        "AntidiabeticMedications": anti_dm,
        "FrequentUrination": frequent_uri,
        "ExcessiveThirst": thirst,
        "UnexplainedWeightLoss": weight_loss,
        "FatigueLevels": scale_fatigue,
        "BlurredVision": blur,
        "SlowHealingSores": slow_heal,
        "QualityOfLifeScore": scale_qol * 10.0,
        "HealthLiteracy": scale_health_knowledge,
    }

