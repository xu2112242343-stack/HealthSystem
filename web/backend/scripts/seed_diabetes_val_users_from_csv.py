"""根据 merged_val_questionnaire_image_user_snake_v2_subset_3x3_tiers.csv 注册 4 个用户并写入 user_info。

CSV 字段已接近前端问卷的 CDC/NHANES 风格，但命名不同；本脚本将其映射到
``apply_questionnaire_to_user(basic/lifestyle/indicators/derived)`` 所需的 key，
确保与 user_info 表字段一致。

账号：
- tnbd1、tnbd2：取 p_image_risk_tier 为 low 的前两条
- tnbg1、tnbg2：取 p_image_risk_tier 为 high 的前两条

密码：均为 123123（若账号已存在则重置密码并覆盖健康数据）。

用法::

    cd web/backend
    python -m scripts.seed_diabetes_val_users_from_csv --csv "path/to/merged_val_questionnaire_image_user_snake_v2_subset_3x3_tiers.csv"
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

import pandas as pd
from sqlalchemy import func, select

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.auth_accounts import hash_password  # noqa: E402
from app.models import UserHealthInfo  # noqa: E402
from app.persistence import SessionLocal, init_db  # noqa: E402
from app.portal_auth import register_user  # noqa: E402
from app.questionnaire_save import apply_questionnaire_to_user  # noqa: E402


def _b01(v: Any) -> bool | None:
    if v is None:
        return None
    try:
        i = int(float(v))
    except (TypeError, ValueError):
        return None
    if i == 1:
        return True
    if i == 0:
        return False
    return None


def _gender_01(v: Any) -> str | None:
    """数据集中 gender 常见为 0/1；这里按 0=女、1=男 映射到库内中文性别。"""
    if v is None:
        return None
    try:
        i = int(float(v))
    except (TypeError, ValueError):
        return None
    if i == 0:
        return "女"
    if i == 1:
        return "男"
    return None


def _num(v: Any) -> float | None:
    if v is None or (isinstance(v, str) and not v.strip()):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if f != f:
        return None
    return f


def _int(v: Any) -> int | None:
    f = _num(v)
    if f is None:
        return None
    return int(round(f))


def _get_or_create_user(db, account: str, password: str) -> UserHealthInfo:
    key = account.strip().lower()
    row = db.scalars(select(UserHealthInfo).where(func.lower(UserHealthInfo.user_account) == key)).first()
    if row is None:
        return register_user(db, account, password)
    row.user_password = hash_password(password)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _row_to_questionnaire(r: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], dict[str, Any]]:
    basic: dict[str, Any] = {}
    lifestyle: dict[str, Any] = {}
    indicators: dict[str, Any] = {}
    derived: dict[str, Any] = {}

    if (age := _int(r.get("age"))) is not None:
        basic["age"] = age
    if (g := _gender_01(r.get("gender"))) is not None:
        basic["gender"] = g
    if (bmi := _num(r.get("bmi"))) is not None:
        derived["bmi"] = bmi

    for k_csv, k_q in [
        ("family_diabetes", "familyHistoryDiabetes"),
        ("has_gestational_diabetes", "gestationalDiabetes"),
        ("has_pcos", "pcos"),
        ("pre_diabetes", "prediabetes"),
        ("has_hypertension", "hypertension"),
    ]:
        b = _b01(r.get(k_csv))
        if b is not None:
            basic[k_q] = b

    if (sbp := _int(r.get("systolic_bp"))) is not None:
        indicators["sbp"] = sbp
    if (dbp := _int(r.get("diastolic_bp"))) is not None:
        indicators["dbp"] = dbp

    if (sm := _b01(r.get("smoking"))) is not None:
        lifestyle["smoking"] = sm

    if (alc := _int(r.get("drinking_score"))) is not None:
        lifestyle["scaleAlcoholAmount"] = alc

    if (wk := _num(r.get("weekly_exercise_time"))) is not None:
        lifestyle["scaleWeeklyActivity"] = wk

    for k_csv, k_q in [
        ("diet_quality", "scaleDietQuality"),
        ("sleep_quality", "scaleSleepQuality"),
        ("life_quality", "scaleQualityOfLife"),
        ("health_knowledge", "scaleHealthKnowledge"),
        ("fatigue_level", "scaleFatigue"),
    ]:
        v = _int(r.get(k_csv))
        if v is not None:
            lifestyle[k_q] = v

    for k_csv, k_q in [
        ("use_antihypertensive", "antihypertensiveDrugs"),
        ("use_hypoglycemic", "hypoglycemicDrugs"),
        ("frequent_urination", "symptomPolyuria"),
        ("excessive_thirst", "symptomThirst"),
        ("unexplained_weight_loss", "symptomWeightLoss"),
        ("blurred_vision", "symptomBlurVision"),
        ("slow_wound_healing", "symptomSlowHealing"),
    ]:
        b = _b01(r.get(k_csv))
        if b is not None:
            basic[k_q] = b

    for k_csv, k_q in [
        ("fasting_blood_glucose", "fpg"),
        ("hba1c", "hba1c"),
        ("serum_creatinine", "creatinine"),
        ("urea_nitrogen", "bun"),
        ("total_cholesterol", "tc"),
        ("ldl_c", "ldl"),
        ("hdl_c", "hdl"),
        ("triglyceride", "tg"),
    ]:
        v = _num(r.get(k_csv))
        if v is not None:
            indicators[k_q] = v

    # 这些 CSV 没有 map/tyg/bri；留空即可
    return basic, lifestyle, indicators, derived


def main() -> None:
    parser = argparse.ArgumentParser(description="从糖尿病验证集 CSV 生成 4 个示例用户")
    parser.add_argument(
        "--csv",
        default=r"c:\Users\21122\Desktop\健康系统\图像\糖尿病\merged_val_questionnaire_image_user_snake_v2_subset_3x3_tiers.csv",
        help="CSV 路径",
    )
    args = parser.parse_args()

    csv_path = Path(args.csv).resolve()
    df = pd.read_csv(csv_path)
    rows = df.to_dict(orient="records")

    low = [r for r in rows if str(r.get("p_image_risk_tier") or "").startswith("low")]
    high = [r for r in rows if str(r.get("p_image_risk_tier") or "").startswith("high")]
    if len(low) < 2 or len(high) < 2:
        raise SystemExit(f"low={len(low)} high={len(high)}，不足 2 条/组")

    picks: list[tuple[str, dict[str, Any]]] = [
        ("tnbd1", low[0]),
        ("tnbd2", low[1]),
        ("tnbg1", high[0]),
        ("tnbg2", high[1]),
    ]

    init_db()
    db = SessionLocal()
    try:
        for acc, r in picks:
            pid = r.get("PatientID")
            tier = r.get("p_image_risk_tier")
            img = str(r.get("img_file_path") or "").strip()
            print(f"处理 {acc} <- PatientID={pid} tier={tier}")

            basic, lifestyle, indicators, derived = _row_to_questionnaire(r)
            row = _get_or_create_user(db, acc, "123123")
            apply_questionnaire_to_user(row, basic=basic, lifestyle=lifestyle, indicators=indicators, derived=derived)
            if pid is not None:
                row.name = str(pid)[:20]
            if img:
                row.diabetes_image_path = img
            db.add(row)
            db.commit()
            print(f"  已写入 user_info id={row.id} account={row.user_account!r}")
    finally:
        db.close()


if __name__ == "__main__":
    main()

