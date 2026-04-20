"""MySQL 数据库连接（SQLAlchemy）。

优先使用环境变量 ``HEALTH_DATABASE_URL`` 完整连接串；未设置时由 ``HEALTH_MYSQL_*`` 分项组装。

表结构在 ``app.models`` 中声明；``init_db()`` 会 ``create_all()``：**仅创建当前库中尚不存在的表**，
不会对已有表做列变更。改字段请用 Alembic 或手动 ``ALTER TABLE``（见 ``models.py`` 文件头注释）。
启动时会对 ``user_info`` 做少量增量补丁（``ensure_user_info_*``），用于补列而非删列。

示例连接串::

    mysql+pymysql://用户:密码@127.0.0.1:3306/库名?charset=utf8mb4
"""

from __future__ import annotations

import os
from collections.abc import Generator
from pathlib import Path
from urllib.parse import quote_plus

from dotenv import load_dotenv
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

_env = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(_env)


def _build_mysql_url_from_parts() -> str:
    user = os.environ.get("HEALTH_MYSQL_USER", "root")
    password = os.environ.get("HEALTH_MYSQL_PASSWORD", "")
    host = os.environ.get("HEALTH_MYSQL_HOST", "127.0.0.1")
    port = os.environ.get("HEALTH_MYSQL_PORT", "3306")
    database = os.environ.get("HEALTH_MYSQL_DATABASE", "health_platform")
    pwd = quote_plus(password)
    return f"mysql+pymysql://{user}:{pwd}@{host}:{port}/{database}?charset=utf8mb4"


DATABASE_URL = os.environ.get("HEALTH_DATABASE_URL") or _build_mysql_url_from_parts()

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def ensure_user_info_profile_columns() -> None:
    """已有库追加 ``phone`` / ``email`` / ``is_active``（create_all 不会改表结构）。"""
    try:
        insp = inspect(engine)
    except Exception:
        return
    if not insp.has_table("user_info"):
        return
    cols = {c["name"] for c in insp.get_columns("user_info")}
    with engine.begin() as conn:
        if "phone" not in cols:
            conn.execute(
                text("ALTER TABLE user_info ADD COLUMN phone VARCHAR(32) NULL COMMENT '联系电话'"),
            )
        if "email" not in cols:
            conn.execute(
                text("ALTER TABLE user_info ADD COLUMN email VARCHAR(255) NULL COMMENT '邮箱'"),
            )
        if "is_active" not in cols:
            conn.execute(
                text(
                    "ALTER TABLE user_info ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1 COMMENT '账户是否可登录'",
                ),
            )


def ensure_user_info_derived_ratio_columns() -> None:
    """已有库追加 ``alt_ast_ratio`` / ``tc_hdl_ratio``（create_all 不会改表结构）。"""
    try:
        insp = inspect(engine)
    except Exception:
        return
    if not insp.has_table("user_info"):
        return
    cols = {c["name"] for c in insp.get_columns("user_info")}
    with engine.begin() as conn:
        if "alt_ast_ratio" not in cols:
            conn.execute(
                text(
                    "ALTER TABLE user_info ADD COLUMN alt_ast_ratio DECIMAL(5,2) NULL COMMENT 'ALT/AST'",
                ),
            )
        if "tc_hdl_ratio" not in cols:
            conn.execute(
                text(
                    "ALTER TABLE user_info ADD COLUMN tc_hdl_ratio DECIMAL(5,2) NULL COMMENT 'TC/HDL'",
                ),
            )


def ensure_user_info_ldl_column_precision() -> None:
    """LDL（mg/dL）常见值可超 99，将 ldl_c 扩为 DECIMAL(5,2)。"""
    try:
        insp = inspect(engine)
    except Exception:
        return
    if not insp.has_table("user_info"):
        return
    cols = {c["name"] for c in insp.get_columns("user_info")}
    if "ldl_c" not in cols:
        return
    with engine.begin() as conn:
        conn.execute(
            text(
                "ALTER TABLE user_info MODIFY COLUMN ldl_c DECIMAL(5,2) NULL COMMENT '低密度脂蛋白胆固醇'",
            ),
        )


def ensure_user_info_fpg_column_precision() -> None:
    """空腹血糖 FPG（mg/dL）可能>99，将 fasting_blood_glucose 扩为 DECIMAL(5,2)。"""
    try:
        insp = inspect(engine)
    except Exception:
        return
    if not insp.has_table("user_info"):
        return
    cols = {c["name"] for c in insp.get_columns("user_info")}
    if "fasting_blood_glucose" not in cols:
        return
    with engine.begin() as conn:
        conn.execute(
            text(
                "ALTER TABLE user_info MODIFY COLUMN fasting_blood_glucose DECIMAL(5,2) NULL COMMENT '空腹血糖'",
            ),
        )


def ensure_user_info_image_path_columns() -> None:
    """已有库追加三病影像路径字段（create_all 不会改表结构）。"""
    try:
        insp = inspect(engine)
    except Exception:
        return
    if not insp.has_table("user_info"):
        return
    cols = {c["name"] for c in insp.get_columns("user_info")}
    with engine.begin() as conn:
        if "liver_image_path" not in cols:
            conn.execute(
                text("ALTER TABLE user_info ADD COLUMN liver_image_path TEXT NULL COMMENT '肝病影像路径（绝对路径）'"),
            )
        if "diabetes_image_path" not in cols:
            conn.execute(
                text("ALTER TABLE user_info ADD COLUMN diabetes_image_path TEXT NULL COMMENT '糖尿病影像路径（绝对路径）'"),
            )
        if "stroke_image_path" not in cols:
            conn.execute(
                text("ALTER TABLE user_info ADD COLUMN stroke_image_path TEXT NULL COMMENT '卒中影像路径（绝对路径）'"),
            )


def ensure_health_articles_show_in_guide_column() -> None:
    """已有库追加 show_in_health_guide（create_all 不会改表结构）。"""
    try:
        insp = inspect(engine)
    except Exception:
        return
    if not insp.has_table("health_articles"):
        return
    cols = {c["name"] for c in insp.get_columns("health_articles")}
    with engine.begin() as conn:
        if "show_in_health_guide" not in cols:
            conn.execute(
                text(
                    "ALTER TABLE health_articles ADD COLUMN show_in_health_guide TINYINT(1) NOT NULL DEFAULT 1 "
                    "COMMENT '是否在用户端健康生活指南中展示'",
                ),
            )


def ensure_health_article_image_storage_columns() -> None:
    """health_article_images 增量补丁：添加 image_path，并将 image_data 改为可空。"""
    try:
        insp = inspect(engine)
    except Exception:
        return
    if not insp.has_table("health_article_images"):
        return

    cols = {c["name"] for c in insp.get_columns("health_article_images")}
    with engine.begin() as conn:
        if "image_path" not in cols:
            conn.execute(
                text("ALTER TABLE health_article_images ADD COLUMN image_path TEXT NULL COMMENT '图片绝对路径'"),
            )
        if "image_data" in cols:
            conn.execute(
                text("ALTER TABLE health_article_images MODIFY COLUMN image_data LONGBLOB NULL COMMENT '兼容旧结构，已弃用'"),
            )


def ensure_health_article_image_blob_type() -> None:
    """兼容旧流程保留：若 image_data 存在则升级为 LONGBLOB。"""
    try:
        insp = inspect(engine)
    except Exception:
        return
    if not insp.has_table("health_article_images"):
        return

    image_col = None
    for c in insp.get_columns("health_article_images"):
        if c.get("name") == "image_data":
            image_col = c
            break
    if image_col is None:
        return

    col_type = str(image_col.get("type") or "").upper()
    if "LONGBLOB" in col_type:
        return

    with engine.begin() as conn:
        conn.execute(
            text(
                "ALTER TABLE health_article_images "
                "MODIFY COLUMN image_data LONGBLOB NOT NULL COMMENT '图片二进制'",
            ),
        )


def ensure_user_health_history_doctor_advice_column() -> None:
    """已有库追加 doctor_advice（create_all 不会改表结构）。"""
    try:
        insp = inspect(engine)
    except Exception:
        return
    if not insp.has_table("user_health_history"):
        return
    cols = {c["name"] for c in insp.get_columns("user_health_history")}
    with engine.begin() as conn:
        if "doctor_advice" not in cols:
            conn.execute(
                text("ALTER TABLE user_health_history ADD COLUMN doctor_advice TEXT NULL COMMENT '医生建议'"),
            )


def init_db() -> None:
    # 导入模型以注册到 Base.metadata；create_all 只建缺失的表
    from app import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    ensure_user_info_profile_columns()
    ensure_user_info_derived_ratio_columns()
    ensure_user_info_ldl_column_precision()
    ensure_user_info_fpg_column_precision()
    ensure_user_info_image_path_columns()
    ensure_health_articles_show_in_guide_column()
    ensure_health_article_image_storage_columns()
    ensure_health_article_image_blob_type()
    ensure_user_health_history_doctor_advice_column()


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def check_db_connection() -> bool:
    """执行 ``SELECT 1``，成功返回 True。"""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False
