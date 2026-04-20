"""密码哈希与 JWT 签发。登录/注册请在你自建的用户表、医生表上实现后调用此处工具函数。"""

from __future__ import annotations

import os
import time
from typing import Any

import jwt

try:
    import bcrypt
except ImportError as e:
    raise ImportError(
        "未安装 bcrypt。请执行: pip install \"bcrypt>=4.0.0\""
    ) from e


def ensure_bcrypt_usable() -> None:
    """
    启动时检查 bcrypt 是否可用。

    若环境中 ``bcrypt`` 为损坏的命名空间包（例如 site-packages/bcrypt 下仅有
    ``_bcrypt.pyd.conda_trash``、无 ``checkpw``），登录会 500。
    修复：``pip uninstall bcrypt -y && pip install "bcrypt>=4.0.0"``
    """
    if not hasattr(bcrypt, "checkpw") or not hasattr(bcrypt, "hashpw") or not hasattr(bcrypt, "gensalt"):
        raise RuntimeError(
            "bcrypt 安装异常（模块无 checkpw/hashpw/gensalt），无法校验密码。"
            "常见原因：conda/pip 更新中断，仅留下 _bcrypt.pyd.conda_trash。"
            "请在本虚拟环境中执行: pip uninstall bcrypt -y && pip install \"bcrypt>=4.0.0\""
        )

JWT_SECRET = os.environ.get("HEALTH_JWT_SECRET", "dev-insecure-change-me")
JWT_ALG = "HS256"
JWT_EXPIRE_SEC = int(os.environ.get("HEALTH_JWT_EXPIRE_SEC", str(7 * 24 * 3600)))


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("ascii")


def verify_password(plain: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), password_hash.encode("ascii"))
    except (ValueError, TypeError):
        return False


def decode_access_token(token: str) -> dict[str, Any]:
    """校验 JWT，失败时抛出 jwt.PyJWTError。"""
    return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])


def make_access_token(*, subject: str, role: str, login_name: str) -> str:
    """subject 建议形如 user:123、doctor:执照号、admin:1，便于区分身份与主键。"""
    now = int(time.time())
    payload = {
        "sub": subject,
        "role": role,
        "account": login_name,
        "iat": now,
        "exp": now + JWT_EXPIRE_SEC,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)
