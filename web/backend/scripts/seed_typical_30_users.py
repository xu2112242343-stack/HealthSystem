"""从 typical_30_frontend_bundle.json 中挑选双低/双中样本，注册用户并写入 user_info。

需求：
- 挑 2 条 tier_tabular + tier_image 均为「低风险」
- 挑 2 条 tier_tabular + tier_image 均为「中风险」
- 注册/更新账号：gand1、gand2、gangz1、gangz2；密码均为 123123

说明：
- 该文件中 tier_* 文本可能存在乱码，但 tier_level_tab / tier_level_img 为 0/1/2，
  其中 0=低、1=中、2=高。脚本以 level 为准。
- CDC/NHANES 变量映射沿用 scripts/seed_cdc_bundle_users.py 的逻辑，并通过
  apply_questionnaire_to_user 落库，确保与 user_info 字段一致。

用法::

    cd web/backend
    python -m scripts.seed_typical_30_users --json "c:\\path\\typical_30_frontend_bundle.json"

可选：
- 环境变量 MERGE_VALID_IMAGE_ROOT：若设置，会尝试把 record.image_paths 的相对路径拼成绝对路径，
  找到则写入三病 *_image_path（便于触发图像模型）。未找到则忽略。
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

# 复用 CDC/NHANES → questionnaire 映射
from scripts.seed_cdc_bundle_users import (  # noqa: E402
    cdc_bundle_record_to_questionnaire,
    _resolve_first_image_abs,
)


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


def _pick(records: list[dict[str, Any]], *, level: int, n: int) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for r in records:
        if r.get("tier_level_tab") == level and r.get("tier_level_img") == level:
            out.append(r)
            if len(out) >= n:
                break
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="从 typical_30_frontend_bundle 生成 4 个典型用户（双低/双中）")
    parser.add_argument(
        "--json",
        default=r"c:\Users\21122\xwechat_files\wxid_p6jnc01rxek322_9c5c\msg\file\2026-04\typical_30_frontend_bundle.json",
        help="typical_30_frontend_bundle.json 路径",
    )
    args = parser.parse_args()

    json_path = Path(args.json).resolve()
    data = json.loads(json_path.read_text(encoding="utf-8"))
    records: list[dict[str, Any]] = data["records"]

    dual_low = _pick(records, level=0, n=2)
    dual_mid = _pick(records, level=1, n=2)
    if len(dual_low) < 2 or len(dual_mid) < 2:
        raise SystemExit(f"双低={len(dual_low)} 双中={len(dual_mid)}，不足 2 条/组")

    accounts: list[tuple[str, dict[str, Any]]] = [
        ("gand1", dual_low[0]),
        ("gand2", dual_low[1]),
        ("gangz1", dual_mid[0]),
        ("gangz2", dual_mid[1]),
    ]

    init_db()
    db = SessionLocal()
    try:
        for acc, rec in accounts:
            pid = rec.get("patient_id") or rec.get("paired_image_patient_id") or rec.get("synthetic_id") or "?"
            print(
                f"处理 {acc} <- pid={pid} "
                f"tier_level_tab={rec.get('tier_level_tab')} tier_level_img={rec.get('tier_level_img')}",
            )

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
            if img_abs and Path(img_abs).is_file():
                row.liver_image_path = img_abs
                row.diabetes_image_path = img_abs
                row.stroke_image_path = img_abs
                print(f"  影像路径: {img_abs}")
            else:
                # 不强制：多数 typical_30 文件只提供相对路径
                pass

            db.add(row)
            db.commit()
            print(f"  已写入 user_info id={row.id} account={row.user_account!r}")
    finally:
        db.close()


if __name__ == "__main__":
    main()

