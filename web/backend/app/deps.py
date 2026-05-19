"""FastAPI 依赖：当前登录用户等。"""

from __future__ import annotations

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.auth_accounts import decode_access_token
from app.models import AdminAccount, DoctorAccount, UserHealthInfo
from app.persistence import get_db

bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user_health(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> UserHealthInfo:
    if creds is None or creds.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="未登录或缺少访问令牌")
    try:
        payload = decode_access_token(creds.credentials)
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="令牌无效或已过期") from None

    if payload.get("role") != "user":
        raise HTTPException(status_code=403, detail="仅普通用户可更新健康问卷")

    sub = str(payload.get("sub") or "")
    if not sub.startswith("user:"):
        raise HTTPException(status_code=401, detail="令牌主体无效")
    try:
        uid = int(sub.split(":", 1)[1])
    except (ValueError, IndexError):
        raise HTTPException(status_code=401, detail="令牌主体无效")

    row = db.get(UserHealthInfo, uid)
    if row is None:
        raise HTTPException(status_code=401, detail="账户不存在或已注销，请重新登录")
    return row


def get_optional_user_health(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> UserHealthInfo | None:
    """已登录且 role=user 时返回 ``user_info`` 行；无头或医生令牌时返回 None（走演示默认画像）。"""
    if creds is None or creds.scheme.lower() != "bearer":
        return None
    try:
        payload = decode_access_token(creds.credentials)
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="令牌无效或已过期") from None

    if payload.get("role") != "user":
        return None

    sub = str(payload.get("sub") or "")
    if not sub.startswith("user:"):
        raise HTTPException(status_code=401, detail="令牌主体无效")
    try:
        uid = int(sub.split(":", 1)[1])
    except (ValueError, IndexError):
        raise HTTPException(status_code=401, detail="令牌主体无效")

    row = db.get(UserHealthInfo, uid)
    if row is None:
        raise HTTPException(status_code=401, detail="账户不存在或已注销，请重新登录")
    return row


def get_current_doctor_account(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> DoctorAccount:
    if creds is None or creds.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="未登录或缺少访问令牌")
    try:
        payload = decode_access_token(creds.credentials)
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="令牌无效或已过期") from None

    if payload.get("role") != "doctor":
        raise HTTPException(status_code=403, detail="仅医生可访问此接口")

    sub = str(payload.get("sub") or "")
    if not sub.startswith("doctor:"):
        raise HTTPException(status_code=401, detail="令牌主体无效")
    try:
        did = int(sub.split(":", 1)[1])
    except (ValueError, IndexError):
        raise HTTPException(status_code=401, detail="令牌主体无效")

    row = db.get(DoctorAccount, did)
    if row is None:
        raise HTTPException(status_code=404, detail="医生账户不存在")
    return row


def get_current_admin_account(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> AdminAccount:
    if creds is None or creds.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="未登录或缺少访问令牌")
    try:
        payload = decode_access_token(creds.credentials)
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="令牌无效或已过期") from None

    if payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="仅管理员可访问此接口")

    sub = str(payload.get("sub") or "")
    if not sub.startswith("admin:"):
        raise HTTPException(status_code=401, detail="令牌主体无效")
    try:
        aid = int(sub.split(":", 1)[1])
    except (ValueError, IndexError):
        raise HTTPException(status_code=401, detail="令牌主体无效")

    row = db.get(AdminAccount, aid)
    if row is None:
        raise HTTPException(status_code=404, detail="管理员账户不存在")
    return row
