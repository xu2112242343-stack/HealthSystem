"""门户注册/登录：写入 user_info、doctor_accounts、校验 admin_accounts。"""

from __future__ import annotations

import os
import time
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth_accounts import hash_password, verify_password
from app.models import AdminAccount, DoctorAccount, UserHealthInfo
from app.persistence import SessionLocal


def normalize_login(account: str) -> str:
    return account.strip().lower()


def register_user(db: Session, account: str, password: str) -> UserHealthInfo:
    raw = account.strip()
    key = normalize_login(raw)
    if not key:
        raise ValueError("请输入账号")
    if len(password) < 6:
        raise ValueError("密码至少 6 位")
    dup = db.scalars(
        select(UserHealthInfo).where(func.lower(UserHealthInfo.user_account) == key),
    ).first()
    if dup is not None:
        raise ValueError("该账号已注册")
    row = UserHealthInfo(
        user_account=raw,
        user_password=hash_password(password),
        is_active=True,
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ValueError("该账号已注册") from None
    db.refresh(row)
    return row


def register_doctor(
    db: Session,
    account: str,
    password: str,
    license_code: str,
    doctor_name: str,
) -> DoctorAccount:
    raw = account.strip()
    key = normalize_login(raw)
    lc = license_code.strip()
    name = doctor_name.strip()
    if not key:
        raise ValueError("请输入账号")
    if len(password) < 6:
        raise ValueError("密码至少 6 位")
    if not lc:
        raise ValueError("请填写医师执照号")
    if not name:
        raise ValueError("请填写医生姓名")
    dup_lic = db.scalars(select(DoctorAccount).where(DoctorAccount.license_code == lc)).first()
    if dup_lic is not None:
        raise ValueError("该医师执照号已注册")
    dup_acc = db.scalars(select(DoctorAccount).where(func.lower(DoctorAccount.login_key) == key)).first()
    if dup_acc is not None:
        raise ValueError("该医生登录账号已被使用")
    row = DoctorAccount(
        login_name=raw,
        login_key=key,
        password_hash=hash_password(password),
        license_code=lc,
        name=name,
        is_active=True,
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ValueError("注册失败，请检查执照号或账号是否重复") from None
    db.refresh(row)
    return row


def authenticate_user(db: Session, account: str, password: str) -> UserHealthInfo | None:
    key = normalize_login(account)
    if not key:
        return None
    row = db.scalars(
        select(UserHealthInfo).where(func.lower(UserHealthInfo.user_account) == key),
    ).first()
    if row is None:
        return None
    if not row.is_active:
        return None
    if not verify_password(password, row.user_password):
        return None
    return row


def authenticate_doctor(db: Session, account: str, password: str) -> DoctorAccount | None:
    key = normalize_login(account)
    if not key:
        return None
    row = db.scalars(
        select(DoctorAccount).where(func.lower(DoctorAccount.login_key) == key),
    ).first()
    if row is None:
        return None
    if not row.is_active:
        return None
    if not verify_password(password, row.password_hash):
        return None
    return row


def authenticate_admin(db: Session, account: str, password: str) -> AdminAccount | None:
    key = normalize_login(account)
    if not key:
        return None
    row = db.scalars(
        select(AdminAccount).where(func.lower(AdminAccount.account) == key),
    ).first()
    if row is None:
        return None
    if not verify_password(password, row.password_hash):
        return None
    return row


def seed_default_admin_if_empty() -> None:
    """库中无任何管理员时，按环境变量插入一条（默认 admin / admin123，生产请修改）。"""
    raw = os.environ.get("HEALTH_ADMIN_LOGIN", "admin").strip()
    password = os.environ.get("HEALTH_ADMIN_PASSWORD", "admin123")
    if not raw:
        return
    with SessionLocal() as db:
        if db.scalars(select(AdminAccount).limit(1)).first() is not None:
            return
        db.add(
            AdminAccount(
                account=raw,
                username=os.environ.get("HEALTH_ADMIN_USERNAME", "系统管理员"),
                password_hash=hash_password(password),
            ),
        )
        db.commit()


def build_session_dict(
    *,
    role: str,
    account: str,
    user_id: int | None = None,
    license_code: str | None = None,
) -> dict[str, Any]:
    sess: dict[str, Any] = {
        "role": role,
        "account": account,
        "iat": int(time.time() * 1000),
    }
    if user_id is not None:
        sess["userId"] = user_id
    if license_code:
        sess["licenseCode"] = license_code
    return sess
