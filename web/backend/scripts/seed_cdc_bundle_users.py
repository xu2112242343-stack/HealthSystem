"""从 merge_valid_original_frontend_bundle JSON 选取双高风险样本，注册/更新用户并写入 user_info。

CDC / NHANES 变量（features_numeric、categorical）映射到问卷四段（basic / lifestyle / indicators / derived），
经 ``apply_questionnaire_to_user`` 落库，与前端采集规范一致。

用法::

    cd web/backend
    python -m scripts.seed_cdc_bundle_users --json \"path/to/merge_valid_original_frontend_bundle_abs02.json\"

环境变量 ``MERGE_VALID_IMAGE_ROOT``：若设置，则与 JSON 内 ``image_paths`` 相对路径拼接，存在则写入三病影像路径。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sqlalchemy import func, select  # noqa: E402

from app.auth_accounts import hash_password  # noqa: E402
from app.models import UserHealthInfo  # noqa: E402
from app.persistence import SessionLocal, init_db  # noqa: E402
from app.portal_auth import register_user  # noqa: E402
from app.questionnaire_save import apply_questionnaire_to_user  # noqa: E402


def _f(x: Any) -> float | None:
    if x is None:
        return None
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    if v != v:  # NaN
        return None
    return v


def _i(x: Any) -> int | None:
    f = _f(x)
    if f is None:
        return None
    return int(round(f))


def _nhanes_gender_to_basic(riagendr: Any) -> str | None:
    try:
        v = int(float(riagendr))
    except (TypeError, ValueError):
        return None
    if v == 1:
        return "男"
    if v == 2:
        return "女"
    return None


def _nhanes_smoke_to_bool(smq020: Any) -> bool | None:
    """SMQ020：1=是（吸过≥100支烟），2=否。"""
    try:
        v = int(float(smq020))
    except (TypeError, ValueError):
        return None
    if v == 1:
        return True
    if v == 2:
        return False
    return None


def _nhanes_alq_to_drinking_freq(alq111: Any) -> str | None:
    """ALQ111：1=有过饮酒，2=从未饮酒（简化为 1 / 0 档）。"""
    try:
        v = int(float(alq111))
    except (TypeError, ValueError):
        return None
    if v == 2:
        return "0"
    if v == 1:
        return "1"
    return None


def _resolve_first_image_abs(record: dict[str, Any], json_path: Path) -> str | None:
    paths = record.get("image_paths") or []
    if not paths:
        return None
    roots: list[Path] = []
    env_root = os.environ.get("MERGE_VALID_IMAGE_ROOT", "").strip()
    if env_root:
        roots.append(Path(env_root))
    roots.append(json_path.parent)
    roots.append(json_path.parent.parent)
    for rel in paths:
        rel_s = str(rel).replace("\\", "/")
        for root in roots:
            cand = (root / rel_s).resolve()
            if cand.is_file():
                return str(cand)
    return None


def cdc_bundle_record_to_questionnaire(record: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], dict[str, Any]]:
    fn: dict[str, Any] = dict(record.get("features_numeric") or {})
    fc: dict[str, Any] = dict(record.get("features_categorical") or {})

    age = _i(fn.get("RIDAGEYR"))
    gender = _nhanes_gender_to_basic(fc.get("RIAGENDR"))
    height = _f(fn.get("BMXHT"))
    weight = _f(fn.get("BMXWT"))
    waist = _f(fn.get("BMXWAIST"))
    sbp = _i(fn.get("BPXSY1"))
    dbp = _i(fn.get("BPXDI1"))

    basic: dict[str, Any] = {}
    if age is not None:
        basic["age"] = age
    if gender:
        basic["gender"] = gender
    if height is not None:
        basic["height"] = height
    if weight is not None:
        basic["weight"] = weight
    if waist is not None:
        basic["waist"] = waist
    if sbp is not None and dbp is not None:
        basic["hypertension"] = sbp >= 140 or dbp >= 90

    lifestyle: dict[str, Any] = {}
    sm = _nhanes_smoke_to_bool(fc.get("SMQ020"))
    if sm is not None:
        lifestyle["smoking"] = sm
    df = _nhanes_alq_to_drinking_freq(fc.get("ALQ111"))
    if df is not None:
        lifestyle["drinkingFrequency"] = df

    indicators: dict[str, Any] = {}
    if sbp is not None:
        indicators["sbp"] = sbp
    if dbp is not None:
        indicators["dbp"] = dbp
    for src, dst in [
        ("LBXGLU", "fpg"),
        ("LBXGH", "hba1c"),
        ("LBXTR", "tg"),
        ("LBDHDD", "hdl"),
        ("LBDLDL", "ldl"),
        ("LBXSATSI", "alt"),
        ("LBXSASSI", "ast"),
        ("LBXSGTSI", "ggt"),
        ("LBXSTB", "totalBilirubin"),
        ("LBXSAL", "albumin"),
        ("LBXSUA", "uricAcid"),
    ]:
        v = _f(fn.get(src))
        if v is not None:
            indicators[dst] = v

    ratio_tc_hdl = _f(fn.get("TC_HDL_ratio"))
    hdl_v = _f(fn.get("LBDHDD"))
    if ratio_tc_hdl is not None and hdl_v is not None and hdl_v > 0:
        indicators["tc"] = round(ratio_tc_hdl * hdl_v, 4)

    derived: dict[str, Any] = {}
    bmi = _f(fn.get("BMXBMI"))
    if bmi is not None:
        derived["bmi"] = bmi
    tyg = _f(fn.get("TyG"))
    if tyg is not None:
        derived["tyg"] = tyg
    bri = _f(fn.get("BRI"))
    if bri is not None:
        derived["bri"] = bri
    if sbp is not None and dbp is not None:
        derived["map"] = round(dbp + (sbp - dbp) / 3.0, 4)

    return basic, lifestyle, indicators, derived


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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--json",
        default=r"c:\Users\21122\xwechat_files\wxid_p6jnc01rxek322_9c5c\msg\file\2026-04\merge_valid_original_frontend_bundle_abs02.json",
        help="merge_valid_original_frontend_bundle_*.json 路径",
    )
    args = parser.parse_args()

    json_path = Path(args.json).resolve()
    data = json.loads(json_path.read_text(encoding="utf-8"))
    records: list[dict[str, Any]] = data["records"]
    dual_high = [r for r in records if r.get("tier_tabular") == "高风险" and r.get("tier_image") == "高风险"]
    if len(dual_high) < 2:
        raise SystemExit(f"双高风险记录不足 2 条（当前 {len(dual_high)}）")

    picked = dual_high[:2]
    accounts = [("gang1", picked[0]), ("gang2", picked[1])]

    init_db()
    db = SessionLocal()
    try:
        for acc, rec in accounts:
            pid = rec.get("patient_id", "?")
            print(f"处理 {acc} <- patient_id={pid} tier_tabular={rec.get('tier_tabular')} tier_image={rec.get('tier_image')}")

            basic, lifestyle, indicators, derived = cdc_bundle_record_to_questionnaire(rec)
            row = _get_or_create_user(db, acc, "123123")
            apply_questionnaire_to_user(
                row,
                basic=basic,
                lifestyle=lifestyle,
                indicators=indicators,
                derived=derived,
            )
            nm = str(pid).strip() or None
            if nm:
                row.name = nm[:20]

            img_abs = _resolve_first_image_abs(rec, json_path)
            if img_abs:
                row.liver_image_path = img_abs
                row.diabetes_image_path = img_abs
                row.stroke_image_path = img_abs
                print(f"  影像路径: {img_abs}")
            else:
                print("  未找到本地影像文件（可设 MERGE_VALID_IMAGE_ROOT 或拷贝 data/merge_valid 目录）")

            db.add(row)
            db.commit()
            print(f"  已写入 user_info id={row.id} account={row.user_account!r}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
