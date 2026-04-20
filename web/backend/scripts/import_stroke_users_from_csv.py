from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.models import UserHealthInfo  # noqa: E402
from app.persistence import SessionLocal, init_db  # noqa: E402
from app.portal_auth import register_user  # noqa: E402


@dataclass
class Counters:
    high: int = 0
    medium: int = 0
    low: int = 0


def _risk_prefix(risk_group: str) -> str:
    s = str(risk_group or "").strip()
    if "高" in s:
        return "nczg"
    if "中" in s:
        return "nczz"
    return "nczd"


def _yn_12(v: Any) -> str | None:
    """NHANES 常见编码：1=是 2=否。"""
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    try:
        i = int(float(v))
    except Exception:
        return None
    if i == 1:
        return "是"
    if i == 2:
        return "否"
    return None


def _yn_smoking(v: Any) -> str | None:
    """
    SMQ040：你这份数据里常见为 1 或 3。
    - 3 通常表示“不吸烟/从不”
    - 1/2 常表示“吸烟”
    这里只做粗映射到 是/否。
    """
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    try:
        i = int(float(v))
    except Exception:
        return None
    if i == 3:
        return "否"
    if i in (1, 2):
        return "是"
    return None


def _drinking_freq(v: Any) -> str | None:
    """ALQ121：项目里 drinking_frequency 约定为 '0'/'1'/'2'/'3' 字符串。"""
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    try:
        i = int(float(v))
    except Exception:
        return None
    if i in (0, 1, 2, 3):
        return str(i)
    return None


def _gender_12(v: Any) -> str | None:
    """RIAGENDR：1=男 2=女。"""
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    try:
        i = int(float(v))
    except Exception:
        return None
    if i == 1:
        return "男"
    if i == 2:
        return "女"
    return None


def _int(v: Any) -> int | None:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    try:
        return int(round(float(v)))
    except Exception:
        return None


def _float(v: Any) -> float | None:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    try:
        f = float(v)
    except Exception:
        return None
    return f if pd.notna(f) else None


def _create_unique_user(db, base_account: str, password: str) -> UserHealthInfo:
    """避免账号冲突：若已存在则在末尾递增重试。"""
    suffix = 0
    while True:
        acc = base_account if suffix == 0 else f"{base_account}_{suffix}"
        try:
            return register_user(db, acc, password)
        except ValueError as e:
            if "已注册" in str(e) or "已被使用" in str(e):
                suffix += 1
                continue
            raise


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True, help="path to balanced_test_stroke_userinfo_32cols.csv")
    ap.add_argument("--password", default="123123", help="default password for created users")
    ap.add_argument("--limit", type=int, default=0, help="optional limit rows (0=all)")
    args = ap.parse_args()

    csv_path = Path(args.csv)
    if not csv_path.is_file():
        raise FileNotFoundError(csv_path)

    init_db()
    df = pd.read_csv(csv_path, low_memory=False)
    if df.empty:
        print("CSV is empty, nothing to import.")
        return

    need_cols = {"risk_group"}
    miss = [c for c in need_cols if c not in df.columns]
    if miss:
        raise ValueError(f"CSV 缺少列: {', '.join(miss)}")

    counters = Counters()
    created = 0
    updated = 0

    with SessionLocal() as db:
        rows = df.to_dict(orient="records")
        if args.limit and args.limit > 0:
            rows = rows[: args.limit]

        for r in rows:
            prefix = _risk_prefix(r.get("risk_group"))
            if prefix == "nczg":
                counters.high += 1
                account = f"{prefix}{counters.high}"
            elif prefix == "nczz":
                counters.medium += 1
                account = f"{prefix}{counters.medium}"
            else:
                counters.low += 1
                account = f"{prefix}{counters.low}"

            user = _create_unique_user(db, account, args.password)
            created += 1

            # 写入字段（按 user_info 列名）
            user.age = _int(r.get("age"))
            user.gender = _gender_12(r.get("gender")) or user.gender

            user.systolic_bp = _int(r.get("systolic_bp"))
            user.diastolic_bp = _int(r.get("diastolic_bp"))
            user.map = _float(r.get("map"))
            user.bmi = _float(r.get("bmi"))

            user.ldl_c = _float(r.get("ldl_c"))
            user.hdl_c = _float(r.get("hdl_c"))
            user.total_cholesterol = _float(r.get("total_cholesterol"))
            user.triglyceride = _float(r.get("triglyceride"))

            user.fasting_blood_glucose = _float(r.get("fasting_blood_glucose"))
            user.hba1c = _float(r.get("hba1c"))

            user.serum_creatinine = _float(r.get("serum_creatinine"))
            user.urea_nitrogen = _float(r.get("urea_nitrogen"))
            user.chlorine = _float(r.get("chlorine"))
            user.serum_iron = _float(r.get("serum_iron"))

            user.hemoglobin = _float(r.get("hemoglobin"))
            user.hematocrit = _float(r.get("hematocrit"))
            user.rbc = _float(r.get("rbc"))
            user.rdw = _float(r.get("rdw"))
            user.lymphocyte_percent = _float(r.get("lymphocyte_percent"))

            user.has_hypertension = _yn_12(r.get("has_hypertension")) or user.has_hypertension
            user.has_coronary_heart_disease = _yn_12(r.get("has_coronary_heart_disease")) or user.has_coronary_heart_disease
            user.has_angina = _yn_12(r.get("has_angina")) or user.has_angina
            user.has_myocardial_infarction = _yn_12(r.get("has_myocardial_infarction")) or user.has_myocardial_infarction

            user.smoking = _yn_smoking(r.get("smoking")) or user.smoking
            user.moderate_high_intensity_exercise = _yn_12(r.get("moderate_high_intensity_exercise")) or user.moderate_high_intensity_exercise
            user.sedentary_time_daily = _float(r.get("sedentary_time_daily"))
            user.drinking_frequency = _drinking_freq(r.get("drinking_frequency")) or user.drinking_frequency

            db.add(user)
            updated += 1

        db.commit()

    print(
        f"done. created={created} updated={updated} "
        f"(high={counters.high} medium={counters.medium} low={counters.low})"
    )


if __name__ == "__main__":
    main()

