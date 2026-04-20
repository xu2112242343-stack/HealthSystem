"""肝病模型（lite）固定映射：数据库/扁平问卷字段 -> liver 模型特征。"""

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


def _gender_to_riagendr(v: Any) -> float | None:
    if isinstance(v, (int, float)):
        x = float(v)
        if x in (1.0, 2.0):
            return x
    if isinstance(v, str):
        s = v.strip().lower()
        if s in {"male", "m", "男", "1"}:
            return 1.0
        if s in {"female", "f", "女", "2"}:
            return 2.0
    return None


def _yes_no_to_12(v: Any) -> float | None:
    if v is True or v == 1:
        return 1.0
    if v is False or v == 0:
        return 2.0
    if isinstance(v, str):
        s = v.strip().lower()
        if s in {"1", "yes", "y", "true", "是"}:
            return 1.0
        if s in {"2", "no", "n", "false", "否"}:
            return 2.0
    return None


def _alcohol_to_alq111(v: Any) -> float | None:
    """
    ALQ111（是否饮酒）：
    - drinking_frequency: "0/1/2/3"；0 视作不饮酒(2)，其余视作饮酒(1)
    - 兼容直接传 yes/no 或 1/2 编码
    """
    if v is None:
        return None
    yn = _yes_no_to_12(v)
    if yn is not None:
        return yn
    try:
        iv = int(str(v).strip())
    except (TypeError, ValueError):
        return None
    return 2.0 if iv <= 0 else 1.0


def map_user_flat_to_liver_lite_features(d: dict[str, Any]) -> dict[str, float]:
    """
    按 liver lite 特征集生成模型输入（不改字段名）：
    RIDAGEYR, RIAGENDR, BMXWT, BMXHT, BMXBMI, BMXWAIST, BPXSY1, BPXDI1,
    LBXSATSI, LBXSASSI, LBXSGTSI, LBXSTB, LBXSAL, LBXGLU, LBXGH, LBDHDD,
    LBXTR, LBDLDL, LBXSUA, ALQ111, SMQ020, TyG, ALT_AST_ratio, TC_HDL_ratio, BRI
    """
    out: dict[str, float] = {}

    def put(name: str, *aliases: str) -> None:
        v = _as_float(_first_present(d, *aliases, name))
        if v is not None:
            out[name] = v

    put("RIDAGEYR", "age")
    g = _gender_to_riagendr(_first_present(d, "gender", "RIAGENDR"))
    if g is not None:
        out["RIAGENDR"] = g

    put("BMXWT", "weightKg", "weight")
    put("BMXHT", "heightCm", "height")
    put("BMXBMI", "bmi")
    if "BMXBMI" not in out:
        h = _as_float(_first_present(d, "heightCm", "height"))
        w = _as_float(_first_present(d, "weightKg", "weight"))
        if h and w and h > 0:
            out["BMXBMI"] = w / ((h / 100.0) ** 2)

    put("BMXWAIST", "waistCm", "waistline")
    put("BPXSY1", "sbp", "systolic_bp")
    put("BPXDI1", "dbp", "diastolic_bp")

    put("LBXSATSI", "alt")
    put("LBXSASSI", "ast")
    put("LBXSGTSI", "ggt")
    put("LBXSTB", "totalBilirubin", "total_bilirubin")
    put("LBXSAL", "albumin")
    put("LBXGLU", "fpg", "fasting_blood_glucose")
    put("LBXGH", "hba1c")
    put("LBDHDD", "hdl", "hdl_c")
    put("LBXTR", "tg", "triglyceride")
    put("LBDLDL", "ldl", "ldl_c")
    put("LBXSUA", "uricAcid", "uric_acid")

    alq = _alcohol_to_alq111(_first_present(d, "drinking_frequency", "drinkingLevel", "ALQ111"))
    if alq is not None:
        out["ALQ111"] = alq
    smq = _yes_no_to_12(_first_present(d, "smoking", "SMQ020"))
    if smq is not None:
        out["SMQ020"] = smq

    # Derived
    tyg = _as_float(_first_present(d, "tyg", "TyG"))
    if tyg is None:
        tg = out.get("LBXTR")
        glu = out.get("LBXGLU")
        if tg and glu and tg > 0 and glu > 0:
            tyg = float(math.log(tg * glu / 2.0))
    if tyg is not None:
        out["TyG"] = tyg

    alt_ast = _as_float(_first_present(d, "alt_ast_ratio", "ALT_AST_ratio"))
    if alt_ast is None:
        alt = out.get("LBXSATSI")
        ast = out.get("LBXSASSI")
        if alt is not None and ast is not None and ast != 0:
            alt_ast = alt / ast
    if alt_ast is not None:
        out["ALT_AST_ratio"] = alt_ast

    tc_hdl = _as_float(_first_present(d, "tc_hdl_ratio", "TC_HDL_ratio"))
    if tc_hdl is None:
        tc = _as_float(_first_present(d, "tc", "total_cholesterol"))
        hdl = out.get("LBDHDD")
        if tc is not None and hdl is not None and hdl != 0:
            tc_hdl = tc / hdl
    if tc_hdl is not None:
        out["TC_HDL_ratio"] = tc_hdl

    bri = _as_float(_first_present(d, "bri", "BRI"))
    if bri is not None:
        out["BRI"] = bri

    return out

