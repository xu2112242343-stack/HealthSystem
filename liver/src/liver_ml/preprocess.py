"""数据清洗、标签构造、排除规则与特征工程。"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from .config import (
    CAP_COL,
    CAP_NAFLD_THRESHOLD,
    CORE_NONMISSING,
    LIVERDISEASE_CSV,
    MCQ_COLS,
    PA_BINARY,
    STROKE_METABOLISM_CSV,
)

# NHANES ALQ121（近年问卷）：饮酒频率类别 → 近似「每周饮酒天数」
_ALQ121_DAYS_PER_WEEK = {
    1: 7.0,
    2: 5.5,
    3: 3.5,
    4: 2.0,
    5: 1.0,
    6: 0.58,
    7: 0.25,
    8: 0.17,
    9: 0.09,
    10: 0.03,
}

# 标准 US 饮酒：约 14 g 乙醇
_G_PER_STANDARD_DRINK = 14.0


def merge_liverdisease(base: pd.DataFrame, liver_path: Path | None = None) -> pd.DataFrame:
    """将 liverdisease.csv 中合并表没有的列按 SEQN 左连接并入。"""
    liver_path = liver_path or LIVERDISEASE_CSV
    if not Path(liver_path).exists():
        return base
    ld = pd.read_csv(liver_path, low_memory=False)
    extra = [c for c in ld.columns if c != "SEQN" and c not in base.columns]
    if not extra:
        return base
    b = base.copy()
    b["SEQN"] = pd.to_numeric(b["SEQN"], errors="coerce").astype("Int64")
    ld = ld.copy()
    ld["SEQN"] = pd.to_numeric(ld["SEQN"], errors="coerce").astype("Int64")
    return b.merge(ld[["SEQN"] + extra], on="SEQN", how="left")


def merge_stroke_metabolism_supplement(
    base: pd.DataFrame,
    stroke_path: Path | None = None,
) -> pd.DataFrame:
    """
    从 merged_stroke_metabolism.csv 按 SEQN 合并参考脂质、饮酒、HCV 相关列。
    主表已有值优先，缺失处用补充表填充。
    """
    stroke_path = stroke_path or STROKE_METABOLISM_CSV
    if not Path(stroke_path).exists():
        return base
    want = [
        "LBDHDD",
        "LBDHDDSI",
        "LBXTR",
        "LBDTRSI",
        "LBDLDL",
        "LBDLDLSI",
        "LBDHCI",
        "LBXHCR",
        "LBXHCG",
        "ALQ111",
        "ALQ121",
        "ALQ130",
        "ALQ142",
    ]
    sm = pd.read_csv(stroke_path, low_memory=False)
    cols = [c for c in want if c in sm.columns]
    if not cols:
        return base
    sm = sm[["SEQN"] + cols].drop_duplicates(subset=["SEQN"], keep="first")
    b = base.copy()
    b["SEQN"] = pd.to_numeric(b["SEQN"], errors="coerce").astype("Int64")
    sm["SEQN"] = pd.to_numeric(sm["SEQN"], errors="coerce").astype("Int64")
    sm_idx = sm.set_index("SEQN")
    for c in cols:
        if c not in b.columns:
            b[c] = b["SEQN"].map(sm_idx[c])
        else:
            fill = b["SEQN"].map(sm_idx[c])
            b[c] = b[c].where(pd.notna(b[c]), fill)
    return b


def replace_sentinels(df: pd.DataFrame) -> pd.DataFrame:
    """
    将明显为填充/缺失哨兵的值转为 NaN。
    另：NHANES 问卷 ALQ111、SMQ020 中 7=拒绝回答、9=不知道 → 视为缺失。
    """
    out = df.copy()
    for c in out.select_dtypes(include=[np.number]).columns:
        v = pd.to_numeric(out[c], errors="coerce")
        mask_tiny = (v > 0) & (v < 1e-6)
        v = v.where(~mask_tiny, np.nan)
        for sentinel in (7777, 9999, 777, 999):
            v = v.where(v != sentinel, np.nan)
        out[c] = v
    for c in ("ALQ111", "SMQ020"):
        if c not in out.columns:
            continue
        v = pd.to_numeric(out[c], errors="coerce")
        out[c] = v.where(~v.isin([7, 9]), np.nan)
    return out


def derive_mcq_binary(df: pd.DataFrame, col: str) -> pd.Series:
    """MCQ 单题：1=是 → 1；2=否 → 0；7/9/缺失 → NaN。"""
    if col not in df.columns:
        return pd.Series(np.nan, index=df.index)
    s = pd.to_numeric(df[col], errors="coerce")
    out = np.full(len(df), np.nan)
    out[(s == 1).to_numpy()] = 1.0
    out[(s == 2).to_numpy()] = 0.0
    return pd.Series(out, index=df.index)


def derive_mcq_liver_any_yes(df: pd.DataFrame) -> pd.Series:
    """
    1=四题任一为是；0=四题均为否；否则缺失。
    MCQ: 1=是 2=否 7/9=拒绝/不知道
    """
    s = df.reindex(columns=MCQ_COLS).apply(pd.to_numeric, errors="coerce")
    y1 = (s == 1).any(axis=1)
    y79 = s.isin([7, 9]).any(axis=1)
    ynan = s.isna().any(axis=1)
    yall2 = (s == 2).all(axis=1) & (~ynan)
    out = np.full(len(df), np.nan)
    out[y1.to_numpy()] = 1.0
    m = (~y1 & y79).to_numpy()
    out[m] = np.nan
    m = (~y1 & ~y79 & ynan).to_numpy()
    out[m] = np.nan
    m = (~y1 & ~y79 & ~ynan & yall2).to_numpy()
    out[m] = 0.0
    return pd.Series(out, index=df.index)


def derive_nafld_label_cap(df: pd.DataFrame) -> pd.Series:
    """
    NAFLD 金标准：CAP 中位数 ≥ 248 dB/m（与论文一致）。
    返回：1=NAFLD，0=非 NAFLD；CAP 缺失或无效为 NaN。
    """
    if CAP_COL not in df.columns:
        return pd.Series(np.nan, index=df.index)
    cap = pd.to_numeric(df[CAP_COL], errors="coerce")
    out = np.full(len(df), np.nan)
    valid = cap.notna() & (cap >= 0)
    out[valid.to_numpy() & (cap >= CAP_NAFLD_THRESHOLD).to_numpy()] = 1.0
    out[valid.to_numpy() & (cap < CAP_NAFLD_THRESHOLD).to_numpy()] = 0.0
    return pd.Series(out, index=df.index)


def _alcohol_days_per_week(alq121: pd.Series) -> pd.Series:
    v = pd.to_numeric(alq121, errors="coerce")
    mapped = v.map(_ALQ121_DAYS_PER_WEEK)
    mapped = mapped.where(mapped.notna(), np.nan)
    return mapped


def estimate_daily_alcohol_g(df: pd.DataFrame) -> pd.Series:
    """
    估算平均每日乙醇摄入（克）。NHANES 近似：每周饮酒天数 × 每次杯数 × 14g / 7。
    ALQ111=否 → 0；从不饮酒以外若无法估算 → NaN（不据此排除过量饮酒）。
    """
    idx = df.index
    alq111 = pd.to_numeric(df["ALQ111"], errors="coerce") if "ALQ111" in df.columns else pd.Series(np.nan, index=idx)
    out = pd.Series(np.nan, index=idx, dtype=float)
    out.loc[alq111 == 2] = 0.0

    alq130 = pd.to_numeric(df["ALQ130"], errors="coerce") if "ALQ130" in df.columns else pd.Series(np.nan, index=idx)
    alq130 = alq130.clip(upper=50)
    days_wk = _alcohol_days_per_week(df["ALQ121"]) if "ALQ121" in df.columns else pd.Series(np.nan, index=idx)
    weekly_drinks = days_wk * alq130
    g_per_day = weekly_drinks * _G_PER_STANDARD_DRINK / 7.0

    need = out.isna()
    out.loc[need] = g_per_day.loc[need]
    return out


def mask_excess_alcohol(df: pd.DataFrame) -> pd.Series:
    """True=应排除（过量饮酒）。男性 >30 g/d，女性 >20 g/d；乙醇不可估时不排除。"""
    g = estimate_daily_alcohol_g(df)
    sex = pd.to_numeric(df.get("RIAGENDR"), errors="coerce")
    thr = pd.Series(np.where(sex == 1, 30.0, 20.0), index=df.index)
    excess = (g > thr) & g.notna()
    return excess.fillna(False)


def feature_engineering(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    # TyG = ln( TG_mg/dL * FPG_mg/dL / 2 )
    tg = pd.to_numeric(out.get("LBXTR"), errors="coerce")
    if tg.isna().all():
        tg = pd.to_numeric(out.get("LBXSTR"), errors="coerce")
    glu = pd.to_numeric(out.get("LBXGLU"), errors="coerce")
    out["TyG"] = np.log(np.maximum(tg * glu / 2.0, 1e-8))

    alt = pd.to_numeric(out.get("LBXSATSI"), errors="coerce")
    ast = pd.to_numeric(out.get("LBXSASSI"), errors="coerce")
    out["ALT_AST_ratio"] = alt / ast.replace(0, np.nan)

    alb_si = pd.to_numeric(out.get("LBDSALSI"), errors="coerce")
    glob_si = pd.to_numeric(out.get("LBDSGBSI"), errors="coerce")
    out["ALB_GLOB_ratio"] = alb_si / glob_si.replace(0, np.nan)

    tc = pd.to_numeric(out.get("LBXSCH"), errors="coerce")
    hdl = pd.to_numeric(out.get("LBDHDD"), errors="coerce")
    out["TC_HDL_ratio"] = tc / hdl.replace(0, np.nan)

    waist = pd.to_numeric(out.get("BMXWAIST"), errors="coerce")
    height_cm = pd.to_numeric(out.get("BMXHT"), errors="coerce")
    half_h = 0.5 * height_cm
    rad = waist / (2 * np.pi)
    ratio = (rad ** 2) / (half_h.replace(0, np.nan) ** 2)
    inner = 1.0 - ratio
    inner = np.clip(inner, 0.0, 1.0)
    out["BRI"] = 364.2 - 365.5 * np.sqrt(inner)

    # Confirmed HCV antibody: 1/4 positive, 2/3 negative, others missing.
    hcv_ab = pd.to_numeric(out.get("LBDHCI"), errors="coerce")
    out["HCV_AB_POS"] = np.where(hcv_ab.isin([1, 4]), 1.0, np.where(hcv_ab.isin([2, 3]), 0.0, np.nan))

    return out


def apply_exclusions(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    排除：年龄<18；CAP 缺失或 <0；过量饮酒；乙肝表面抗原阳性；HCV RNA 阳性或
    （无实验室时）自述肝炎 MCQ160N；自述其他肝病 MCQ160O。
    """
    d = df.copy()
    n0 = len(d)
    steps = [("initial", n0)]

    mask_age = pd.to_numeric(d["RIDAGEYR"], errors="coerce") >= 18
    d = d.loc[mask_age]
    steps.append(("age>=18", len(d)))

    if CAP_COL in d.columns:
        cap = pd.to_numeric(d[CAP_COL], errors="coerce")
        mask_cap = cap.notna() & (cap >= 0)
        d = d.loc[mask_cap]
        steps.append(("CAP_valid", len(d)))

    if "LBDHBG" in d.columns:
        hbs = pd.to_numeric(d["LBDHBG"], errors="coerce")
        d = d.loc[(hbs != 1) | hbs.isna()]
        steps.append(("exclude_HBsAg+", len(d)))

    if "LBDHD" in d.columns:
        hdv = pd.to_numeric(d["LBDHD"], errors="coerce")
        d = d.loc[(hdv != 1) | hdv.isna()]
        steps.append(("exclude_HDV+", len(d)))

    if "LBXHCR" in d.columns:
        hcv = pd.to_numeric(d["LBXHCR"], errors="coerce")
        d = d.loc[(hcv != 1) | hcv.isna()]
        steps.append(("exclude_HCV_RNA+", len(d)))

    # 无 HCV RNA（LBXHCR）结果时：用自述肝炎 MCQ160N 作为替代排除（局限性中说明）
    if "MCQ160N_yes" in d.columns:
        mcn = pd.to_numeric(d["MCQ160N_yes"], errors="coerce")
        if "LBXHCR" in d.columns:
            hcv = pd.to_numeric(d["LBXHCR"], errors="coerce")
            drop_mcq = (mcn == 1) & hcv.isna()
        else:
            drop_mcq = mcn == 1
        d = d.loc[~drop_mcq]
        steps.append(("exclude_self_report_hepatitis_if_no_HCV_RNA", len(d)))

    if "MCQ160O_yes" in d.columns:
        mco = pd.to_numeric(d["MCQ160O_yes"], errors="coerce")
        d = d.loc[(mco != 1) | mco.isna()]
        steps.append(("exclude_other_liver_disease", len(d)))

    ex_alc = mask_excess_alcohol(d)
    d = d.loc[~ex_alc]
    steps.append(("exclude_excess_alcohol", len(d)))

    meta = pd.DataFrame(steps, columns=["step", "n"])
    return d, meta


def build_feature_matrix(
    df: pd.DataFrame,
    numeric_cols: list[str],
    categorical_cols: list[str],
    pa_binary: list[str],
) -> tuple[pd.DataFrame, list[str], list[str]]:
    """组装建模用特征表；类别列转为 str 以便 one-hot。"""
    cat_use = [c for c in categorical_cols if c in df.columns]
    pa_use = [c for c in pa_binary if c in df.columns]
    num_use = [c for c in numeric_cols if c in df.columns]

    num_df = pd.DataFrame({c: pd.to_numeric(df[c], errors="coerce") for c in num_use}, index=df.index)
    cat_df = pd.DataFrame(
        {
            c: df[c].where(pd.notna(df[c]), "missing").astype(str)
            for c in cat_use + pa_use
        },
        index=df.index,
    )
    X = pd.concat([num_df, cat_df], axis=1)

    num_final = list(num_use)
    cat_final = cat_use + pa_use
    return X, num_final, cat_final


def full_preprocess(
    csv_path,
    liver_path: Path | None = None,
    stroke_path: Path | None = None,
) -> tuple[pd.DataFrame, pd.Series, pd.DataFrame]:
    """
    读入 CSV，合并 liverdisease 与 stroke 补充表，清洗，构造 CAP 结局与特征。
    辅助列：MCQ_liver_any_yes 供敏感度分析。
    """
    raw = pd.read_csv(csv_path, low_memory=False)
    raw = merge_liverdisease(raw, liver_path)
    raw = merge_stroke_metabolism_supplement(raw, stroke_path)
    raw = raw.copy()
    raw = replace_sentinels(raw)
    raw["MCQ_liver_any_yes"] = derive_mcq_liver_any_yes(raw)
    raw["MCQ160N_yes"] = derive_mcq_binary(raw, "MCQ160N")
    raw["MCQ160O_yes"] = derive_mcq_binary(raw, "MCQ160O")

    raw = feature_engineering(raw)
    filtered, _ = apply_exclusions(raw)

    y = derive_nafld_label_cap(filtered)
    mask_label = y.notna()
    filtered = filtered.loc[mask_label]
    y = y.loc[mask_label]

    m = pd.Series(True, index=filtered.index)
    for c in CORE_NONMISSING:
        if c not in filtered.columns:
            continue
        if c == "RIAGENDR":
            m &= filtered[c].notna()
        else:
            m &= pd.to_numeric(filtered[c], errors="coerce").notna()
    filtered = filtered.loc[m]
    y = y.loc[m]

    sidecar = filtered[["SEQN"]].copy() if "SEQN" in filtered.columns else pd.DataFrame(index=filtered.index)

    return filtered, y.astype(int), sidecar
