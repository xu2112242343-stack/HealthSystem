"""将前端问卷 JSON（basic / lifestyle / indicators / derived）写入 UserHealthInfo。"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any

from app.models import UserHealthInfo


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_int(v: Any) -> int | None:
    if v is None:
        return None
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return v
    s = str(v).strip()
    if not s:
        return None
    try:
        return int(round(float(s)))
    except (ValueError, TypeError, OverflowError):
        return None


def _parse_float(v: Any) -> float | None:
    if v is None:
        return None
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip()
    if not s:
        return None
    try:
        return float(s)
    except (ValueError, TypeError):
        return None


def _parse_decimal(v: Any) -> Decimal | None:
    f = _parse_float(v)
    if f is None:
        return None
    try:
        return Decimal(str(f))
    except (InvalidOperation, ValueError):
        return None


def _yn_db(v: Any) -> str | None:
    if v is None or v == "":
        return None
    if v is True or v == "yes":
        return "是"
    if v is False or v == "no":
        return "否"
    return None


def _set_yn(row: UserHealthInfo, attr: str, d: dict[str, Any], key: str) -> None:
    if key not in d:
        return
    val = _yn_db(d[key])
    setattr(row, attr, val)


def _set_int(row: UserHealthInfo, attr: str, d: dict[str, Any], key: str) -> None:
    if key not in d:
        return
    v = d[key]
    if v is None or (isinstance(v, str) and not str(v).strip()):
        setattr(row, attr, None)
        return
    n = _parse_int(v)
    setattr(row, attr, n)


def _set_float_dec(row: UserHealthInfo, attr: str, d: dict[str, Any], key: str) -> None:
    if key not in d:
        return
    v = d[key]
    if v is None or (isinstance(v, str) and not str(v).strip()):
        setattr(row, attr, None)
        return
    dec = _parse_decimal(v)
    setattr(row, attr, dec)


def _set_int_metric(row: UserHealthInfo, attr: str, d: dict[str, Any], key: str) -> None:
    if key not in d:
        return
    v = d[key]
    if v is None or (isinstance(v, str) and not str(v).strip()):
        setattr(row, attr, None)
        return
    setattr(row, attr, _parse_int(v))


def _set_str(row: UserHealthInfo, attr: str, d: dict[str, Any], key: str) -> None:
    if key not in d:
        return
    v = d[key]
    if v is None:
        setattr(row, attr, None)
        return
    s = str(v).strip()
    setattr(row, attr, s or None)


def apply_basic(row: UserHealthInfo, d: dict[str, Any]) -> None:
    _set_int(row, "age", d, "age")
    _set_str(row, "gender", d, "gender")
    _set_float_dec(row, "height", d, "height")
    _set_float_dec(row, "weight", d, "weight")
    _set_float_dec(row, "waistline", d, "waist")
    _set_yn(row, "has_hypertension", d, "hypertension")
    _set_yn(row, "has_myocardial_infarction", d, "myocardialInfarction")
    _set_yn(row, "has_coronary_heart_disease", d, "coronaryHeartDisease")
    _set_yn(row, "has_angina", d, "angina")
    _set_yn(row, "has_gestational_diabetes", d, "gestationalDiabetes")
    _set_yn(row, "has_pcos", d, "pcos")
    _set_yn(row, "family_diabetes", d, "familyHistoryDiabetes")
    _set_yn(row, "pre_diabetes", d, "prediabetes")
    _set_yn(row, "use_antihypertensive", d, "antihypertensiveDrugs")
    _set_yn(row, "use_hypoglycemic", d, "hypoglycemicDrugs")
    _set_yn(row, "frequent_urination", d, "symptomPolyuria")
    _set_yn(row, "unexplained_weight_loss", d, "symptomWeightLoss")
    _set_yn(row, "excessive_thirst", d, "symptomThirst")
    _set_yn(row, "blurred_vision", d, "symptomBlurVision")
    _set_yn(row, "slow_wound_healing", d, "symptomSlowHealing")


def apply_lifestyle(row: UserHealthInfo, d: dict[str, Any]) -> None:
    _set_yn(row, "smoking", d, "smoking")
    _set_yn(row, "moderate_high_intensity_exercise", d, "vigorousExercise")
    if "drinkingFrequency" in d:
        v = d["drinkingFrequency"]
        if v is None or v == "":
            row.drinking_frequency = None
        else:
            s = str(v).strip()
            row.drinking_frequency = s if s in {"0", "1", "2", "3"} else s or None
    _set_int(row, "drinking_score", d, "scaleAlcoholAmount")
    if "scaleWeeklyActivity" in d:
        v = d["scaleWeeklyActivity"]
        if v is None or (isinstance(v, str) and not str(v).strip()):
            row.weekly_exercise_time = None
        else:
            row.weekly_exercise_time = str(v).strip()
    _set_int(row, "diet_quality", d, "scaleDietQuality")
    _set_int(row, "sleep_quality", d, "scaleSleepQuality")
    _set_int(row, "health_knowledge", d, "scaleHealthKnowledge")
    _set_int(row, "life_quality", d, "scaleQualityOfLife")
    _set_int(row, "fatigue_level", d, "scaleFatigue")
    _set_float_dec(row, "sedentary_time_daily", d, "sedentaryMinutesPerDay")


def apply_indicators(row: UserHealthInfo, d: dict[str, Any]) -> None:
    int_pairs: list[tuple[str, str]] = [
        ("sbp", "systolic_bp"),
        ("dbp", "diastolic_bp"),
        ("alt", "alt"),
        ("ast", "ast"),
        ("ggt", "ggt"),
        ("ldh", "ldoh"),
    ]
    for json_key, col in int_pairs:
        _set_int_metric(row, col, d, json_key)

    float_pairs: list[tuple[str, str]] = [
        ("fpg", "fasting_blood_glucose"),
        ("hba1c", "hba1c"),
        ("tg", "triglyceride"),
        ("tc", "total_cholesterol"),
        ("hdl", "hdl_c"),
        ("ldl", "ldl_c"),
        ("totalBilirubin", "total_bilirubin"),
        ("albumin", "albumin"),
        ("creatinine", "serum_creatinine"),
        ("bun", "urea_nitrogen"),
        ("chloride", "chlorine"),
        ("serumIron", "serum_iron"),
        ("hematocrit", "hematocrit"),
        ("rbc", "rbc"),
        ("rdw", "rdw"),
        ("hemoglobin", "hemoglobin"),
        ("lymphocytePct", "lymphocyte_percent"),
        ("uricAcid", "uric_acid"),
    ]
    for json_key, col in float_pairs:
        _set_float_dec(row, col, d, json_key)


def apply_derived(row: UserHealthInfo, d: dict[str, Any]) -> None:
    """前端计算的衍生指标（可选）。ALT/AST、TC/HDL 比值见 ``_sync_alt_ast_and_tc_hdl_ratios``。"""
    _set_float_dec(row, "map", d, "map")
    _set_float_dec(row, "bmi", d, "bmi")
    _set_float_dec(row, "tyg", d, "tyg")
    _set_float_dec(row, "bri", d, "bri")


def apply_questionnaire_to_user(
    row: UserHealthInfo,
    *,
    basic: dict[str, Any] | None = None,
    lifestyle: dict[str, Any] | None = None,
    indicators: dict[str, Any] | None = None,
    derived: dict[str, Any] | None = None,
) -> None:
    if basic is not None:
        apply_basic(row, basic)
    if lifestyle is not None:
        apply_lifestyle(row, lifestyle)
    if indicators is not None:
        apply_indicators(row, indicators)
    if derived is not None:
        apply_derived(row, derived)
    _sync_alt_ast_and_tc_hdl_ratios(row)
    row.updated_at = _utc_now()


def _db_yn_to_bool(v: Any) -> bool | None:
    if v is None:
        return None
    s = str(v).strip()
    if s == "是":
        return True
    if s == "否":
        return False
    return None


def _dec_to_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _sync_alt_ast_and_tc_hdl_ratios(row: UserHealthInfo) -> None:
    """由 ALT/AST 与总胆固醇/HDL 写入 alt_ast_ratio、tc_hdl_ratio（与前端 computeDerived 一致，分母为 0 则置空）。"""
    alt_v = row.alt
    ast_v = row.ast
    if alt_v is not None and ast_v is not None:
        try:
            a_f, b_f = float(alt_v), float(ast_v)
            if b_f != 0:
                row.alt_ast_ratio = Decimal(str(round(a_f / b_f, 2)))
            else:
                row.alt_ast_ratio = None
        except (TypeError, ValueError):
            row.alt_ast_ratio = None
    else:
        row.alt_ast_ratio = None

    tc = _dec_to_float(row.total_cholesterol)
    hdl = _dec_to_float(row.hdl_c)
    if tc is not None and hdl is not None and hdl != 0:
        row.tc_hdl_ratio = Decimal(str(round(tc / hdl, 2)))
    else:
        row.tc_hdl_ratio = None


def user_health_to_predict_dict(row: UserHealthInfo) -> dict[str, Any]:
    """将 ``user_info`` 行转为 ``risk_engine.predict_triple`` 使用的扁平字段（仅含已存值）。"""
    out: dict[str, Any] = {}

    if row.age is not None:
        out["age"] = int(row.age)

    if row.gender:
        g = str(row.gender).strip().lower()
        if g in ("male", "m", "男"):
            out["gender"] = "male"
        elif g in ("female", "f", "女"):
            out["gender"] = "female"
        else:
            out["gender"] = str(row.gender).strip()

    hf = _dec_to_float(row.height)
    if hf is not None:
        out["heightCm"] = hf
    wf = _dec_to_float(row.weight)
    if wf is not None:
        out["weightKg"] = wf
    wst = _dec_to_float(row.waistline)
    if wst is not None:
        out["waistCm"] = wst

    for api_key, attr in [
        ("hypertension", "has_hypertension"),
        ("familyHistoryDiabetes", "family_diabetes"),
        ("prediabetes", "pre_diabetes"),
        ("antihypertensiveDrugs", "use_antihypertensive"),
        ("hypoglycemicDrugs", "use_hypoglycemic"),
        ("smoking", "smoking"),
        ("myocardialInfarction", "has_myocardial_infarction"),
        ("coronaryHeartDisease", "has_coronary_heart_disease"),
        ("angina", "has_angina"),
        ("vigorousExercise", "moderate_high_intensity_exercise"),
    ]:
        b = _db_yn_to_bool(getattr(row, attr, None))
        if b is not None:
            out[api_key] = b

    dfreq = row.drinking_frequency
    if dfreq is not None and str(dfreq).strip() in {"0", "1", "2", "3"}:
        out["drinkingLevel"] = int(str(dfreq).strip())

    if row.drinking_score is not None:
        out["scaleAlcoholAmount"] = int(row.drinking_score)

    if row.weekly_exercise_time is not None and str(row.weekly_exercise_time).strip() != "":
        try:
            out["scaleWeeklyActivity"] = int(round(float(str(row.weekly_exercise_time).strip())))
        except (ValueError, TypeError):
            pass

    if row.diet_quality is not None:
        out["scaleDietQuality"] = int(row.diet_quality)
    if row.sleep_quality is not None:
        out["scaleSleepQuality"] = int(row.sleep_quality)
    if row.health_knowledge is not None:
        out["scaleHealthKnowledge"] = int(row.health_knowledge)
    if row.life_quality is not None:
        out["scaleQualityOfLife"] = int(row.life_quality)
    if row.fatigue_level is not None:
        out["scaleFatigue"] = int(row.fatigue_level)

    sed = _dec_to_float(row.sedentary_time_daily)
    if sed is not None:
        out["sedentaryMinutesPerDay"] = sed

    if row.systolic_bp is not None:
        out["sbp"] = int(row.systolic_bp)
    if row.diastolic_bp is not None:
        out["dbp"] = int(row.diastolic_bp)

    fpg = _dec_to_float(row.fasting_blood_glucose)
    if fpg is not None:
        out["fpg"] = fpg
    hb = _dec_to_float(row.hba1c)
    if hb is not None:
        out["hba1c"] = hb
    for api_k, attr, caster in [
        ("tg", "triglyceride", _dec_to_float),
        ("tc", "total_cholesterol", _dec_to_float),
        ("hdl", "hdl_c", _dec_to_float),
        ("ldl", "ldl_c", _dec_to_float),
    ]:
        v = caster(getattr(row, attr, None))
        if v is not None:
            out[api_k] = v

    for api_k, attr in [
        ("alt", "alt"),
        ("ast", "ast"),
        ("ggt", "ggt"),
    ]:
        iv = getattr(row, attr, None)
        if iv is not None:
            out[api_k] = int(iv)

    ua = _dec_to_float(row.uric_acid)
    if ua is not None:
        out["uricAcid"] = ua

    for api_k, attr, caster in [
        ("creatinine", "serum_creatinine", _dec_to_float),
        ("bun", "urea_nitrogen", _dec_to_float),
        ("chloride", "chlorine", _dec_to_float),
        ("lymphocytePct", "lymphocyte_percent", _dec_to_float),
        ("hematocrit", "hematocrit", _dec_to_float),
        ("rbc", "rbc", _dec_to_float),
        ("rdw", "rdw", _dec_to_float),
        ("hemoglobin", "hemoglobin", _dec_to_float),
        ("serumIron", "serum_iron", _dec_to_float),
        ("map", "map", _dec_to_float),
        ("bmi", "bmi", _dec_to_float),
        ("alt_ast_ratio", "alt_ast_ratio", _dec_to_float),
        ("tc_hdl_ratio", "tc_hdl_ratio", _dec_to_float),
    ]:
        v = caster(getattr(row, attr, None))
        if v is not None:
            out[api_k] = v

    if row.ldoh is not None:
        out["ldh"] = float(row.ldoh)

    # 影像路径（用于服务端触发图像模型推理 + 融合）
    if getattr(row, "liver_image_path", None):
        out["liver_image_path"] = str(row.liver_image_path)
    if getattr(row, "diabetes_image_path", None):
        out["diabetes_image_path"] = str(row.diabetes_image_path)
    sip = getattr(row, "stroke_image_path", None)
    if sip is not None and str(sip).strip():
        out["stroke_image_path"] = str(sip).strip()

    return out


# 新注册用户仅有账号密码时 predict 字典为空；完成问卷并保存后通常远多于此。
_MIN_PREDICT_KEYS_FOR_FULL_APP_NAVIGATION = 3


def _user_has_any_axis_image(row: UserHealthInfo) -> bool:
    """任一类影像已落库（肝超 / 眼底 / 卒中 CT 等）即视为有足够数据走图像侧评估。"""
    for attr in ("liver_image_path", "diabetes_image_path", "stroke_image_path"):
        p = getattr(row, attr, None)
        if p is not None and str(p).strip():
            return True
    return False


def user_has_health_profile_for_full_navigation(row: UserHealthInfo) -> bool:
    """是否允许用户端浏览首页/风险评估/干预等。

    - 结构化：``user_health_to_predict_dict`` 键数达到阈值；或
    - 影像：已上传至少一类轴的图像路径（可不填基础信息/生活方式/体检指标）。
    """
    if len(user_health_to_predict_dict(row)) >= _MIN_PREDICT_KEYS_FOR_FULL_APP_NAVIGATION:
        return True
    return _user_has_any_axis_image(row)


def _yn_db_to_yesno_string(v: Any) -> str:
    if v is None:
        return ""
    s = str(v).strip()
    if s == "是":
        return "yes"
    if s == "否":
        return "no"
    return ""


def _gender_db_to_form(v: Any) -> str:
    if v is None:
        return ""
    s = str(v).strip().lower()
    if s in ("male", "m", "男"):
        return "male"
    if s in ("female", "f", "女"):
        return "female"
    return ""


def _num_str_for_form(v: Any) -> str:
    if v is None:
        return ""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return ""
    if not math.isfinite(f):
        return ""
    rf = round(f)
    if abs(f - rf) < 1e-6:
        return str(int(rf))
    t = f"{f:.8f}".rstrip("0").rstrip(".")
    return t


def _int_str_for_form(v: Any) -> str:
    if v is None:
        return ""
    try:
        return str(int(v))
    except (TypeError, ValueError):
        return ""


def user_health_to_questionnaire_bundle(row: UserHealthInfo) -> dict[str, Any]:
    """将 ``user_info`` 行还原为前端 DataCollection 的 basic / lifestyle / indicators / derived。"""
    basic: dict[str, Any] = {
        "age": str(row.age) if row.age is not None else "",
        "gender": _gender_db_to_form(row.gender),
        "height": _num_str_for_form(row.height),
        "weight": _num_str_for_form(row.weight),
        "waist": _num_str_for_form(row.waistline),
        "hypertension": _yn_db_to_yesno_string(row.has_hypertension),
        "myocardialInfarction": _yn_db_to_yesno_string(row.has_myocardial_infarction),
        "coronaryHeartDisease": _yn_db_to_yesno_string(row.has_coronary_heart_disease),
        "angina": _yn_db_to_yesno_string(row.has_angina),
        "gestationalDiabetes": _yn_db_to_yesno_string(row.has_gestational_diabetes),
        "pcos": _yn_db_to_yesno_string(row.has_pcos),
        "familyHistoryDiabetes": _yn_db_to_yesno_string(row.family_diabetes),
        "prediabetes": _yn_db_to_yesno_string(row.pre_diabetes),
        "antihypertensiveDrugs": _yn_db_to_yesno_string(row.use_antihypertensive),
        "hypoglycemicDrugs": _yn_db_to_yesno_string(row.use_hypoglycemic),
        "symptomPolyuria": _yn_db_to_yesno_string(row.frequent_urination),
        "symptomWeightLoss": _yn_db_to_yesno_string(row.unexplained_weight_loss),
        "symptomThirst": _yn_db_to_yesno_string(row.excessive_thirst),
        "symptomBlurVision": _yn_db_to_yesno_string(row.blurred_vision),
        "symptomSlowHealing": _yn_db_to_yesno_string(row.slow_wound_healing),
    }

    df = row.drinking_frequency
    df_s = str(df).strip() if df is not None else ""
    drinking_frequency = df_s if df_s in {"0", "1", "2", "3"} else ""

    lifestyle: dict[str, Any] = {
        "smoking": _yn_db_to_yesno_string(row.smoking),
        "vigorousExercise": _yn_db_to_yesno_string(row.moderate_high_intensity_exercise),
        "drinkingFrequency": drinking_frequency,
        "scaleAlcoholAmount": str(row.drinking_score) if row.drinking_score is not None else "",
        "scaleWeeklyActivity": str(row.weekly_exercise_time).strip()
        if row.weekly_exercise_time is not None and str(row.weekly_exercise_time).strip()
        else "",
        "scaleDietQuality": str(row.diet_quality) if row.diet_quality is not None else "",
        "scaleSleepQuality": str(row.sleep_quality) if row.sleep_quality is not None else "",
        "scaleHealthKnowledge": str(row.health_knowledge) if row.health_knowledge is not None else "",
        "scaleQualityOfLife": str(row.life_quality) if row.life_quality is not None else "",
        "scaleFatigue": str(row.fatigue_level) if row.fatigue_level is not None else "",
        "sedentaryMinutesPerDay": _num_str_for_form(row.sedentary_time_daily),
    }

    indicators: dict[str, Any] = {
        "sbp": _int_str_for_form(row.systolic_bp),
        "dbp": _int_str_for_form(row.diastolic_bp),
        "fpg": _num_str_for_form(row.fasting_blood_glucose),
        "hba1c": _num_str_for_form(row.hba1c),
        "tg": _num_str_for_form(row.triglyceride),
        "tc": _num_str_for_form(row.total_cholesterol),
        "hdl": _num_str_for_form(row.hdl_c),
        "ldl": _num_str_for_form(row.ldl_c),
        "alt": _int_str_for_form(row.alt),
        "ast": _int_str_for_form(row.ast),
        "ggt": _int_str_for_form(row.ggt),
        "totalBilirubin": _num_str_for_form(row.total_bilirubin),
        "albumin": _num_str_for_form(row.albumin),
        "creatinine": _num_str_for_form(row.serum_creatinine),
        "bun": _num_str_for_form(row.urea_nitrogen),
        "ldh": _int_str_for_form(row.ldoh),
        "chloride": _num_str_for_form(row.chlorine),
        "serumIron": _num_str_for_form(row.serum_iron),
        "hematocrit": _num_str_for_form(row.hematocrit),
        "rbc": _num_str_for_form(row.rbc),
        "rdw": _num_str_for_form(row.rdw),
        "hemoglobin": _num_str_for_form(row.hemoglobin),
        "lymphocytePct": _num_str_for_form(row.lymphocyte_percent),
        "uricAcid": _num_str_for_form(row.uric_acid),
    }

    derived: dict[str, str] = {}
    if row.map is not None:
        derived["map"] = _num_str_for_form(row.map)
    if row.bmi is not None:
        derived["bmi"] = _num_str_for_form(row.bmi)
    if row.tyg is not None:
        derived["tyg"] = _num_str_for_form(row.tyg)
    if row.alt_ast_ratio is not None:
        derived["altAst"] = _num_str_for_form(row.alt_ast_ratio)
    if row.tc_hdl_ratio is not None:
        derived["tcHdl"] = _num_str_for_form(row.tc_hdl_ratio)
    if row.bri is not None:
        derived["bri"] = _num_str_for_form(row.bri)

    return {"basic": basic, "lifestyle": lifestyle, "indicators": indicators, "derived": derived}
