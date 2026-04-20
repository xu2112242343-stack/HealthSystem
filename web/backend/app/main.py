"""
健康平台 FastAPI：风险引擎 + 医生端分析等。

数据库：MySQL（见 persistence.py）。门户注册写入 user_info / doctor_accounts；登录校验 admin_accounts。

启动：uvicorn app.main:app --reload --host 0.0.0.0 --port 8001
"""

from __future__ import annotations

import copy
import json
import re
import os
import math
import urllib.request
import urllib.error
import time
from datetime import date, datetime, timedelta, timezone
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import mimetypes
import secrets
from fastapi import Body, Depends, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from sqlalchemy import func, or_, select, text
from sqlalchemy.orm import Session, selectinload

from app.auth_accounts import ensure_bcrypt_usable, hash_password, make_access_token, verify_password
from app.deps import (
    get_current_admin_account,
    get_current_doctor_account,
    get_current_user_health,
    get_optional_user_health,
)
from app.models import (
    AdminAccount,
    DoctorAccount,
    HealthArticle,
    HealthArticleImage,
    Hospital,
    LoginEvent,
    UserHealthInfo,
    UserHealthSnapshot,
)
from app.persistence import check_db_connection, get_db, init_db
from app.questionnaire_save import (
    apply_questionnaire_to_user,
    user_has_health_profile_for_full_navigation,
    user_health_to_predict_dict,
    user_health_to_questionnaire_bundle,
)
from app.portal_auth import (
    authenticate_admin,
    authenticate_doctor,
    authenticate_user,
    build_session_dict,
    register_doctor,
    register_user,
    seed_default_admin_if_empty,
)
from app.guide_recommend import select_health_guides_for_user
from app.risk_engine import build_cohort_analysis, next_review_days_for_level, predict_triple, risk_level_from_prob

DATA_DIR = Path(__file__).resolve().parent / "data"
UPLOAD_DIR = Path(__file__).resolve().parent / "uploads"

with open(DATA_DIR / "patients.json", encoding="utf-8") as f:
    _PATIENTS: list[dict] = json.load(f)

try:
    with open(DATA_DIR / "hospitals.json", encoding="utf-8") as f:
        _HOSPITALS_FOR_INTERVENTION: list[dict[str, Any]] = json.load(f)
except OSError:
    _HOSPITALS_FOR_INTERVENTION = []


@asynccontextmanager
async def lifespan(_app: FastAPI):
    ensure_bcrypt_usable()
    init_db()
    seed_default_admin_if_empty()
    _seed_hospitals_if_empty()
    yield


def _seed_hospitals_if_empty() -> None:
    """若数据库 hospitals 为空，则从 data/hospitals.json 导入一份（开发默认）。"""
    if not _HOSPITALS_FOR_INTERVENTION:
        return
    try:
        db = next(get_db())
    except Exception:
        return
    try:
        exists = db.execute(text("SELECT 1 FROM hospitals LIMIT 1")).scalar()
        if exists:
            return
        for rec in _HOSPITALS_FOR_INTERVENTION:
            try:
                row = Hospital(
                    name=str(rec.get("name") or "").strip() or "未命名医院",
                    level=str(rec.get("level") or "").strip() or None,
                    address=str(rec.get("address") or "").strip() or "—",
                    phone=str(rec.get("phone") or "").strip() or "—",
                    latitude=rec.get("latitude"),
                    longitude=rec.get("longitude"),
                    department=str(rec.get("department") or "").strip() or None,
                    rating=rec.get("rating"),
                    experts=rec.get("experts"),
                    specialties=",".join([str(x).strip() for x in (rec.get("specialties") or []) if str(x).strip()])
                    or None,
                    departments=",".join([str(x).strip() for x in (rec.get("departments") or []) if str(x).strip()])
                    or None,
                    working_hours=str(rec.get("workingHours") or "").strip() or None,
                    is_active=True,
                )
                db.add(row)
            except Exception:
                continue
        db.commit()
    finally:
        try:
            db.close()
        except Exception:
            pass


app = FastAPI(title="Health Platform API", version="0.2.0", lifespan=lifespan)


class DisallowApiCachingMiddleware(BaseHTTPMiddleware):
    """禁止缓存 /api/*：多用户共用同一 GET 路径时，浏览器可能忽略 Authorization 而返回他人响应。"""

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "private, no-store, must-revalidate"
            response.headers["Pragma"] = "no-cache"
            response.headers["Vary"] = "Authorization"
        return response


app.add_middleware(DisallowApiCachingMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5170",
        "http://127.0.0.1:5170",
        "http://localhost:5171",
        "http://127.0.0.1:5171",
        "http://localhost:5172",
        "http://127.0.0.1:5172",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class PortalRegisterBody(BaseModel):
    role: str = Field(..., pattern="^(user|doctor)$")
    account: str = Field(..., min_length=1)
    password: str = Field(..., min_length=6)
    license_code: str | None = None
    doctor_name: str | None = None


class PortalLoginBody(BaseModel):
    role: str = Field(..., pattern="^(user|doctor|admin)$")
    account: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)


class UserQuestionnairePutBody(BaseModel):
    """与前端 DataCollection 的 basic / lifestyle / indicators 对象对齐；键名与 TS 一致。"""

    model_config = ConfigDict(extra="ignore")

    basic: dict[str, Any] | None = None
    lifestyle: dict[str, Any] | None = None
    indicators: dict[str, Any] | None = None
    derived: dict[str, Any] | None = None


_CN_MOBILE = re.compile(r"^1\d{10}$")
_EMAIL_OK = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


class UserProfilePutBody(BaseModel):
    """个人中心：姓名写入 ``user_info.name``；电话、邮箱为独立列；可选修改登录密码。"""

    model_config = ConfigDict(extra="ignore")

    name: str = Field(..., min_length=1, max_length=20)
    phone: str = Field(..., min_length=11, max_length=11)
    email: str = Field(..., min_length=3, max_length=255)
    current_password: str | None = None
    new_password: str | None = None


class DoctorProfilePutBody(BaseModel):
    """医生个人中心：姓名只读展示；电话、邮箱可修改；支持改密。"""

    model_config = ConfigDict(extra="ignore")

    phone: str = Field(..., min_length=11, max_length=11)
    email: str = Field(..., min_length=3, max_length=255)
    current_password: str | None = None
    new_password: str | None = None


class AdminUserCreateBody(BaseModel):
    account: str = Field(..., min_length=1, max_length=50)
    password: str = Field(..., min_length=6, max_length=64)
    name: str | None = Field(default=None, max_length=20)
    phone: str | None = Field(default=None, max_length=32)
    email: str | None = Field(default=None, max_length=255)


class AdminDoctorCreateBody(BaseModel):
    account: str = Field(..., min_length=1, max_length=128)
    password: str = Field(..., min_length=6, max_length=64)
    license_code: str = Field(..., min_length=1, max_length=64)
    name: str = Field(..., min_length=1, max_length=128)
    phone: str | None = Field(default=None, max_length=32)
    email: str | None = Field(default=None, max_length=255)
    specialty: str | None = Field(default=None, max_length=128)
    title: str | None = Field(default=None, max_length=64)
    hospital: str | None = Field(default=None, max_length=255)


class AdminDoctorUpdateBody(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str | None = Field(default=None, max_length=128)
    phone: str | None = Field(default=None, max_length=32)
    email: str | None = Field(default=None, max_length=255)
    specialty: str | None = Field(default=None, max_length=128)
    title: str | None = Field(default=None, max_length=64)
    hospital: str | None = Field(default=None, max_length=255)


class AdminStatusBody(BaseModel):
    active: bool


class AdminResetPasswordBody(BaseModel):
    new_password: str = Field(..., min_length=6, max_length=64)


class DoctorSnapshotAdviceBody(BaseModel):
    doctorAdvice: str = Field(default="", max_length=2000)


class HealthGuideImageOut(BaseModel):
    id: int
    filename: str
    mimeType: str
    desc: str | None = None
    sortOrder: int
    imageUrl: str


class HealthGuideArticleOut(BaseModel):
    id: int
    title: str
    summary: str
    content: str
    disease: list[str]
    type: str
    tags: list[str]
    riskLevel: list[str]
    source: str | None = None
    images: list[HealthGuideImageOut]


def _split_csv_text(v: str | None) -> list[str]:
    if not v:
        return []
    return [x.strip() for x in str(v).replace("，", ",").split(",") if x.strip()]


def _health_article_rows_to_out(rows: list[HealthArticle]) -> list[HealthGuideArticleOut]:
    return [
        HealthGuideArticleOut(
            id=r.id,
            title=r.title,
            summary=r.summary,
            content=r.content,
            disease=_split_csv_text(r.disease),
            type=r.type,
            tags=_split_csv_text(r.tags),
            riskLevel=_split_csv_text(r.risk_level),
            source=r.source,
            images=[
                HealthGuideImageOut(
                    id=img.id,
                    filename=img.filename,
                    mimeType=img.mime_type,
                    desc=img.image_desc,
                    sortOrder=img.sort_order,
                    imageUrl=f"/api/user/intervention/images/{img.id}",
                )
                for img in sorted(r.images, key=lambda x: (x.sort_order, x.id))
            ],
        )
        for r in rows
    ]


def _to_page(page: int, page_size: int) -> tuple[int, int]:
    p = max(1, int(page))
    ps = min(100, max(1, int(page_size)))
    return p, ps


def _dt_iso(v: Any) -> str | None:
    if v is None:
        return None
    try:
        return v.isoformat()
    except Exception:
        return None


def _last_n_days(n: int) -> list[date]:
    today = date.today()
    start = today - timedelta(days=max(1, n) - 1)
    return [start + timedelta(days=i) for i in range(max(1, n))]


def _record_login_event(db: Session, *, role: str, account: str, subject_id: int | None) -> None:
    event = LoginEvent(
        role=role,
        account=account,
        subject_id=subject_id,
        login_at=datetime.now(timezone.utc),
    )
    db.add(event)
    db.commit()


@app.get("/api/admin/users")
def admin_list_users(
    keyword: str = "",
    page: int = 1,
    pageSize: int = 10,
    _admin: AdminAccount = Depends(get_current_admin_account),
    db: Session = Depends(get_db),
):
    p, ps = _to_page(page, pageSize)
    q = db.query(UserHealthInfo)
    kw = keyword.strip()
    if kw:
        like = f"%{kw}%"
        q = q.filter(
            or_(
                UserHealthInfo.user_account.like(like),
                UserHealthInfo.name.like(like),
                UserHealthInfo.phone.like(like),
                UserHealthInfo.email.like(like),
            ),
        )
    total = q.count()
    rows = q.order_by(UserHealthInfo.id.desc()).offset((p - 1) * ps).limit(ps).all()
    items = [
        {
            "id": r.id,
            "account": r.user_account,
            "name": r.name,
            "phone": r.phone,
            "email": r.email,
            "age": r.age,
            "gender": r.gender,
            "isActive": bool(r.is_active),
            "createdAt": _dt_iso(r.created_at),
            "updatedAt": _dt_iso(r.updated_at),
        }
        for r in rows
    ]
    return {"items": items, "total": total, "page": p, "pageSize": ps}


@app.get("/api/admin/dashboard/overview")
def admin_dashboard_overview(
    days: int = 7,
    _admin: AdminAccount = Depends(get_current_admin_account),
    db: Session = Depends(get_db),
):
    window = min(30, max(3, int(days)))
    day_list = _last_n_days(window)
    day_keys = {d.isoformat(): i for i, d in enumerate(day_list)}
    trend = [{"date": d.isoformat(), "user": 0, "doctor": 0} for d in day_list]

    user_total = db.execute(text("SELECT COUNT(*) FROM user_info")).scalar() or 0
    doctor_total = db.execute(text("SELECT COUNT(*) FROM doctor_accounts")).scalar() or 0
    hospital_total = db.execute(text("SELECT COUNT(*) FROM hospitals")).scalar() or 0
    article_total = db.execute(text("SELECT COUNT(*) FROM health_articles")).scalar() or 0

    start = day_list[0].isoformat()
    end = day_list[-1].isoformat()

    user_rows = db.execute(
        text(
            """
            SELECT DATE(DATE_ADD(created_at, INTERVAL 8 HOUR)) AS d, COUNT(*) AS c
            FROM user_info
            WHERE created_at IS NOT NULL
              AND DATE(DATE_ADD(created_at, INTERVAL 8 HOUR)) BETWEEN :start AND :end
            GROUP BY DATE(DATE_ADD(created_at, INTERVAL 8 HOUR))
            """,
        ),
        {"start": start, "end": end},
    ).all()
    for d, c in user_rows:
        if d is None:
            continue
        k = str(d)
        idx = day_keys.get(k)
        if idx is not None:
            trend[idx]["user"] = int(c or 0)

    doctor_rows = db.execute(
        text(
            """
            SELECT DATE(DATE_ADD(created_at, INTERVAL 8 HOUR)) AS d, COUNT(*) AS c
            FROM doctor_accounts
            WHERE created_at IS NOT NULL
              AND DATE(DATE_ADD(created_at, INTERVAL 8 HOUR)) BETWEEN :start AND :end
            GROUP BY DATE(DATE_ADD(created_at, INTERVAL 8 HOUR))
            """,
        ),
        {"start": start, "end": end},
    ).all()
    for d, c in doctor_rows:
        if d is None:
            continue
        k = str(d)
        idx = day_keys.get(k)
        if idx is not None:
            trend[idx]["doctor"] = int(c or 0)

    return {
        "totals": {
            "users": int(user_total),
            "doctors": int(doctor_total),
            "hospitals": int(hospital_total),
            "articles": int(article_total),
        },
        "registrationTrend": trend,
    }


class AdminHealthArticleUpsertBody(BaseModel):
    id: int = Field(..., ge=101)
    title: str
    summary: str
    content: str
    disease: str
    type: str
    tags: str | None = None
    risk_level: str | None = None
    source: str | None = None
    show_in_health_guide: bool = True


@app.get("/api/admin/health-articles")
def admin_list_health_articles(
    keyword: str = "",
    page: int = 1,
    pageSize: int = 10,
    _admin: AdminAccount = Depends(get_current_admin_account),
    db: Session = Depends(get_db),
):
    p, ps = _to_page(page, pageSize)
    q = db.query(HealthArticle).order_by(HealthArticle.id.desc())
    kw = keyword.strip()
    if kw:
        like = f"%{kw}%"
        q = q.filter(
            or_(
                HealthArticle.title.like(like),
                func.cast(HealthArticle.id, String).like(like),
                HealthArticle.tags.like(like),
            ),
        )
    total = q.count()
    rows = q.offset((p - 1) * ps).limit(ps).all()
    items = [
        {
            "id": r.id,
            "title": r.title,
            "summary": r.summary,
            "content": r.content,
            "disease": r.disease,
            "type": r.type,
            "tags": r.tags or "",
            "risk_level": r.risk_level or "",
            "source": r.source or "",
            "show_in_health_guide": bool(getattr(r, "show_in_health_guide", True)),
            "createdAt": _dt_iso(r.created_at),
            "updatedAt": _dt_iso(r.updated_at),
        }
        for r in rows
    ]
    return {"items": items, "total": int(total), "page": p, "pageSize": ps}


@app.get("/api/admin/health-articles/{aid}")
def admin_get_health_article(
    aid: int,
    _admin: AdminAccount = Depends(get_current_admin_account),
    db: Session = Depends(get_db),
):
    r = db.get(HealthArticle, aid)
    if r is None:
        raise HTTPException(status_code=404, detail="文章不存在")
    return {
        "id": r.id,
        "title": r.title,
        "summary": r.summary,
        "content": r.content,
        "disease": r.disease,
        "type": r.type,
        "tags": r.tags or "",
        "risk_level": r.risk_level or "",
        "source": r.source or "",
        "show_in_health_guide": bool(getattr(r, "show_in_health_guide", True)),
        "createdAt": _dt_iso(r.created_at),
        "updatedAt": _dt_iso(r.updated_at),
    }


@app.post("/api/admin/health-articles")
def admin_create_health_article(
    body: AdminHealthArticleUpsertBody,
    _admin: AdminAccount = Depends(get_current_admin_account),
    db: Session = Depends(get_db),
):
    if db.get(HealthArticle, body.id) is not None:
        raise HTTPException(status_code=409, detail="文章编号已存在")
    row = HealthArticle(
        id=int(body.id),
        title=body.title.strip(),
        summary=body.summary.strip(),
        content=body.content.strip(),
        disease=body.disease.strip(),
        type=body.type.strip(),
        tags=(body.tags or "").strip() or None,
        risk_level=(body.risk_level or "").strip() or None,
        source=(body.source or "").strip() or None,
        show_in_health_guide=bool(body.show_in_health_guide),
    )
    db.add(row)
    db.commit()
    return {"ok": True, "id": row.id}


@app.put("/api/admin/health-articles/{aid}")
def admin_update_health_article(
    aid: int,
    body: AdminHealthArticleUpsertBody,
    _admin: AdminAccount = Depends(get_current_admin_account),
    db: Session = Depends(get_db),
):
    if int(body.id) != int(aid):
        raise HTTPException(status_code=400, detail="路径 ID 与 body.id 不一致")
    row = db.get(HealthArticle, aid)
    if row is None:
        raise HTTPException(status_code=404, detail="文章不存在")
    row.title = body.title.strip()
    row.summary = body.summary.strip()
    row.content = body.content.strip()
    row.disease = body.disease.strip()
    row.type = body.type.strip()
    row.tags = (body.tags or "").strip() or None
    row.risk_level = (body.risk_level or "").strip() or None
    row.source = (body.source or "").strip() or None
    row.show_in_health_guide = bool(body.show_in_health_guide)
    db.add(row)
    db.commit()
    return {"ok": True}


@app.delete("/api/admin/health-articles/{aid}")
def admin_delete_health_article(
    aid: int,
    _admin: AdminAccount = Depends(get_current_admin_account),
    db: Session = Depends(get_db),
):
    row = db.get(HealthArticle, aid)
    if row is None:
        raise HTTPException(status_code=404, detail="文章不存在")
    db.delete(row)
    db.commit()
    return {"ok": True}


class AdminHospitalUpsertBody(BaseModel):
    name: str
    level: str | None = None
    address: str
    phone: str
    latitude: float | None = None
    longitude: float | None = None
    department: str | None = None
    departments: str | None = None
    specialties: str | None = None
    working_hours: str | None = None
    rating: float | None = None
    experts: int | None = None
    is_active: bool = True


@app.get("/api/admin/hospitals")
def admin_list_hospitals(
    keyword: str = "",
    page: int = 1,
    pageSize: int = 10,
    _admin: AdminAccount = Depends(get_current_admin_account),
    db: Session = Depends(get_db),
):
    p, ps = _to_page(page, pageSize)
    q = db.query(Hospital).order_by(Hospital.id.desc())
    kw = keyword.strip()
    if kw:
        like = f"%{kw}%"
        q = q.filter(or_(Hospital.name.like(like), Hospital.address.like(like), Hospital.department.like(like)))
    total = q.count()
    rows = q.offset((p - 1) * ps).limit(ps).all()
    items = [
        {
            "id": r.id,
            "name": r.name,
            "level": r.level or "",
            "address": r.address,
            "phone": r.phone,
            "latitude": float(r.latitude) if r.latitude is not None else None,
            "longitude": float(r.longitude) if r.longitude is not None else None,
            "department": r.department or "",
            "departments": r.departments or "",
            "specialties": r.specialties or "",
            "workingHours": r.working_hours or "",
            "rating": float(r.rating) if r.rating is not None else None,
            "experts": int(r.experts) if r.experts is not None else 0,
            "isActive": bool(r.is_active),
            "createdAt": _dt_iso(r.created_at),
            "updatedAt": _dt_iso(r.updated_at),
        }
        for r in rows
    ]
    return {"items": items, "total": int(total), "page": p, "pageSize": ps}


@app.post("/api/admin/hospitals")
def admin_create_hospital(
    body: AdminHospitalUpsertBody,
    _admin: AdminAccount = Depends(get_current_admin_account),
    db: Session = Depends(get_db),
):
    row = Hospital(
        name=body.name.strip(),
        level=(body.level or "").strip() or None,
        address=body.address.strip(),
        phone=body.phone.strip(),
        latitude=body.latitude,
        longitude=body.longitude,
        department=(body.department or "").strip() or None,
        departments=(body.departments or "").strip() or None,
        specialties=(body.specialties or "").strip() or None,
        working_hours=(body.working_hours or "").strip() or None,
        rating=body.rating,
        experts=body.experts,
        is_active=bool(body.is_active),
    )
    db.add(row)
    db.commit()
    return {"ok": True, "id": row.id}


@app.put("/api/admin/hospitals/{hid}")
def admin_update_hospital(
    hid: int,
    body: AdminHospitalUpsertBody,
    _admin: AdminAccount = Depends(get_current_admin_account),
    db: Session = Depends(get_db),
):
    row = db.get(Hospital, hid)
    if row is None:
        raise HTTPException(status_code=404, detail="医院不存在")
    row.name = body.name.strip()
    row.level = (body.level or "").strip() or None
    row.address = body.address.strip()
    row.phone = body.phone.strip()
    row.latitude = body.latitude
    row.longitude = body.longitude
    row.department = (body.department or "").strip() or None
    row.departments = (body.departments or "").strip() or None
    row.specialties = (body.specialties or "").strip() or None
    row.working_hours = (body.working_hours or "").strip() or None
    row.rating = body.rating
    row.experts = body.experts
    row.is_active = bool(body.is_active)
    db.add(row)
    db.commit()
    return {"ok": True}


@app.delete("/api/admin/hospitals/{hid}")
def admin_delete_hospital(
    hid: int,
    _admin: AdminAccount = Depends(get_current_admin_account),
    db: Session = Depends(get_db),
):
    row = db.get(Hospital, hid)
    if row is None:
        raise HTTPException(status_code=404, detail="医院不存在")
    db.delete(row)
    db.commit()
    return {"ok": True}


@app.get("/api/admin/database/stats")
def admin_database_stats(
    days: int = 30,
    _admin: AdminAccount = Depends(get_current_admin_account),
    db: Session = Depends(get_db),
):
    """
    医疗数据库管理统计：
    - healthArticlesByDisease: 按疾病标签聚合（基于 LIKE，非严格规范化）
    - hospitalsByLevel: 医院等级分布（基于 level 前缀）
    - trend: 近 N 天新增文章/医院
    """
    window = min(30, max(3, int(days)))
    day_list = _last_n_days(window)
    day_keys = {d.isoformat(): i for i, d in enumerate(day_list)}
    trend = [{"date": d.isoformat(), "articles": 0, "hospitals": 0} for d in day_list]
    start = day_list[0].isoformat()
    end = day_list[-1].isoformat()

    art_rows = db.execute(
        text(
            """
            SELECT DATE(DATE_ADD(created_at, INTERVAL 8 HOUR)) AS d, COUNT(*) AS c
            FROM health_articles
            WHERE created_at IS NOT NULL
              AND DATE(DATE_ADD(created_at, INTERVAL 8 HOUR)) BETWEEN :start AND :end
            GROUP BY DATE(DATE_ADD(created_at, INTERVAL 8 HOUR))
            """,
        ),
        {"start": start, "end": end},
    ).all()
    for d, c in art_rows:
        k = str(d) if d is not None else ""
        idx = day_keys.get(k)
        if idx is not None:
            trend[idx]["articles"] = int(c or 0)

    hos_rows = db.execute(
        text(
            """
            SELECT DATE(DATE_ADD(created_at, INTERVAL 8 HOUR)) AS d, COUNT(*) AS c
            FROM hospitals
            WHERE created_at IS NOT NULL
              AND DATE(DATE_ADD(created_at, INTERVAL 8 HOUR)) BETWEEN :start AND :end
            GROUP BY DATE(DATE_ADD(created_at, INTERVAL 8 HOUR))
            """,
        ),
        {"start": start, "end": end},
    ).all()
    for d, c in hos_rows:
        k = str(d) if d is not None else ""
        idx = day_keys.get(k)
        if idx is not None:
            trend[idx]["hospitals"] = int(c or 0)

    # content distribution (simple LIKE-based)
    disease_keys = [
        ("非酒精性脂肪肝", ["非酒精性脂肪肝", "代谢相关脂肪性肝病", "脂肪肝", "MAFLD", "NAFLD"]),
        ("2型糖尿病", ["2型糖尿病", "2 型糖尿病", "二型糖尿病", "T2DM", "糖尿病"]),
        ("脑卒中", ["脑卒中", "卒中", "CVA", "脑梗", "脑出血"]),
    ]
    by_disease: list[dict[str, Any]] = []
    for name, keys in disease_keys:
        c = 0
        for kw in keys:
            c = max(
                c,
                int(
                    db.execute(
                        text("SELECT COUNT(*) FROM health_articles WHERE disease LIKE :like"),
                        {"like": f"%{kw}%"},
                    ).scalar()
                    or 0
                ),
            )
        by_disease.append({"name": name, "value": int(c)})

    # hospital level distribution (by prefix; only三级*)
    # 医院等级分布：兼容 "三级甲等综合医院" / "甲等综合" 等多种写法；缺失则归入 未分级
    lv_rows = db.execute(text("SELECT level, COUNT(*) AS c FROM hospitals GROUP BY level")).all()
    buckets: dict[str, int] = {
        "三级甲等": 0,
        "三级乙等": 0,
        "三级丙等": 0,
        "三级（其它）": 0,
        "未分级": 0,
    }

    def _bucket(level: Any) -> str:
        if level is None:
            return "未分级"
        s = str(level).strip()
        if not s:
            return "未分级"
        k = s.replace(" ", "")
        # 先按常见三级细分
        if "三级" in k and ("甲" in k or "三甲" in k):
            return "三级甲等"
        if "三级" in k and ("乙" in k or "三乙" in k):
            return "三级乙等"
        if "三级" in k and ("丙" in k or "三丙" in k):
            return "三级丙等"
        if "三级" in k:
            return "三级（其它）"
        # 兼容只写“甲等/乙等/丙等/甲等综合”等
        if "甲" in k:
            return "三级甲等"
        if "乙" in k:
            return "三级乙等"
        if "丙" in k:
            return "三级丙等"
        return "未分级"

    for lv, c in lv_rows:
        try:
            n = int(c or 0)
        except Exception:
            n = 0
        buckets[_bucket(lv)] = buckets.get(_bucket(lv), 0) + n

    by_level: list[dict[str, Any]] = [
        {"name": k, "value": int(v)}
        for k, v in buckets.items()
        if int(v) > 0
    ]

    return {
        "healthArticlesByDisease": by_disease,
        "hospitalsByLevel": by_level,
        "trend": trend,
    }


@app.get("/api/admin/dashboard/activity-today")
def admin_dashboard_activity_today(
    _admin: AdminAccount = Depends(get_current_admin_account),
    db: Session = Depends(get_db),
):
    slots = [{"hour": f"{h:02d}:00", "users": 0, "doctors": 0} for h in range(24)]
    rows = db.execute(
        text(
            """
            SELECT HOUR(DATE_ADD(login_at, INTERVAL 8 HOUR)) AS h, role, COUNT(*) AS c
            FROM login_events
            WHERE DATE(DATE_ADD(login_at, INTERVAL 8 HOUR)) = CURDATE()
              AND role IN ('user', 'doctor')
            GROUP BY HOUR(DATE_ADD(login_at, INTERVAL 8 HOUR)), role
            """,
        ),
    ).all()
    for h, role, c in rows:
        try:
            hour = int(h)
        except Exception:
            continue
        if hour < 0 or hour > 23:
            continue
        if role == "user":
            slots[hour]["users"] = int(c or 0)
        elif role == "doctor":
            slots[hour]["doctors"] = int(c or 0)
    return {"items": slots}


@app.get("/api/admin/users/{uid}")
def admin_get_user(
    uid: int,
    _admin: AdminAccount = Depends(get_current_admin_account),
    db: Session = Depends(get_db),
):
    row = db.get(UserHealthInfo, uid)
    if row is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    return {
        "id": row.id,
        "account": row.user_account,
        "name": row.name,
        "phone": row.phone,
        "email": row.email,
        "age": row.age,
        "gender": row.gender,
        "isActive": bool(row.is_active),
        "createdAt": _dt_iso(row.created_at),
        "updatedAt": _dt_iso(row.updated_at),
        "questionnaire": user_health_to_questionnaire_bundle(row),
    }


@app.post("/api/admin/users")
def admin_create_user(
    body: AdminUserCreateBody,
    _admin: AdminAccount = Depends(get_current_admin_account),
    db: Session = Depends(get_db),
):
    try:
        row = register_user(db, body.account, body.password)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None
    if body.name is not None:
        row.name = body.name.strip() or None
    if body.phone is not None:
        phone = body.phone.strip()
        if phone and (not _CN_MOBILE.match(phone)):
            raise HTTPException(status_code=400, detail="请输入 11 位大陆手机号")
        row.phone = phone or None
    if body.email is not None:
        email = body.email.strip()
        if email and (not _EMAIL_OK.match(email)):
            raise HTTPException(status_code=400, detail="邮箱格式不正确")
        row.email = email or None
    db.add(row)
    db.commit()
    return {"ok": True, "id": row.id}


@app.put("/api/admin/users/{uid}/status")
def admin_set_user_status(
    uid: int,
    body: AdminStatusBody,
    _admin: AdminAccount = Depends(get_current_admin_account),
    db: Session = Depends(get_db),
):
    row = db.get(UserHealthInfo, uid)
    if row is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    row.is_active = bool(body.active)
    db.add(row)
    db.commit()
    return {"ok": True}


@app.delete("/api/admin/users/{uid}")
def admin_delete_user(
    uid: int,
    _admin: AdminAccount = Depends(get_current_admin_account),
    db: Session = Depends(get_db),
):
    """注销用户：从数据库中删除 user_info 记录（不可恢复）。"""
    row = db.get(UserHealthInfo, uid)
    if row is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    db.delete(row)
    db.commit()
    return {"ok": True}


@app.put("/api/admin/users/{uid}/reset-password")
def admin_reset_user_password(
    uid: int,
    body: AdminResetPasswordBody,
    _admin: AdminAccount = Depends(get_current_admin_account),
    db: Session = Depends(get_db),
):
    row = db.get(UserHealthInfo, uid)
    if row is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    row.user_password = hash_password(body.new_password.strip())
    db.add(row)
    db.commit()
    return {"ok": True}


@app.get("/api/admin/doctors")
def admin_list_doctors(
    keyword: str = "",
    page: int = 1,
    pageSize: int = 10,
    _admin: AdminAccount = Depends(get_current_admin_account),
    db: Session = Depends(get_db),
):
    p, ps = _to_page(page, pageSize)
    q = db.query(DoctorAccount)
    kw = keyword.strip()
    if kw:
        like = f"%{kw}%"
        q = q.filter(
            or_(
                DoctorAccount.login_name.like(like),
                DoctorAccount.name.like(like),
                DoctorAccount.phone.like(like),
                DoctorAccount.email.like(like),
                DoctorAccount.hospital.like(like),
                DoctorAccount.specialty.like(like),
            ),
        )
    total = q.count()
    rows = q.order_by(DoctorAccount.id.desc()).offset((p - 1) * ps).limit(ps).all()
    items = [
        {
            "id": r.id,
            "account": r.login_name,
            "name": r.name,
            "phone": r.phone,
            "email": r.email,
            "specialty": r.specialty,
            "title": r.title,
            "hospital": r.hospital,
            "licenseCode": r.license_code,
            "isActive": bool(r.is_active),
            "createdAt": _dt_iso(r.created_at),
            "updatedAt": _dt_iso(r.updated_at),
        }
        for r in rows
    ]
    return {"items": items, "total": total, "page": p, "pageSize": ps}


@app.get("/api/admin/doctors/{did}")
def admin_get_doctor(
    did: int,
    _admin: AdminAccount = Depends(get_current_admin_account),
    db: Session = Depends(get_db),
):
    row = db.get(DoctorAccount, did)
    if row is None:
        raise HTTPException(status_code=404, detail="医生不存在")
    return {
        "id": row.id,
        "account": row.login_name,
        "name": row.name,
        "phone": row.phone,
        "email": row.email,
        "specialty": row.specialty,
        "title": row.title,
        "hospital": row.hospital,
        "licenseCode": row.license_code,
        "isActive": bool(row.is_active),
        "createdAt": _dt_iso(row.created_at),
        "updatedAt": _dt_iso(row.updated_at),
    }


@app.post("/api/admin/doctors")
def admin_create_doctor(
    body: AdminDoctorCreateBody,
    _admin: AdminAccount = Depends(get_current_admin_account),
    db: Session = Depends(get_db),
):
    try:
        row = register_doctor(db, body.account, body.password, body.license_code, body.name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None
    if body.phone is not None:
        phone = body.phone.strip()
        if phone and (not _CN_MOBILE.match(phone)):
            raise HTTPException(status_code=400, detail="请输入 11 位大陆手机号")
        row.phone = phone or None
    if body.email is not None:
        email = body.email.strip()
        if email and (not _EMAIL_OK.match(email)):
            raise HTTPException(status_code=400, detail="邮箱格式不正确")
        row.email = email or None
    row.specialty = (body.specialty or "").strip() or None
    row.title = (body.title or "").strip() or None
    row.hospital = (body.hospital or "").strip() or None
    db.add(row)
    db.commit()
    return {"ok": True, "id": row.id}


@app.put("/api/admin/doctors/{did}")
def admin_update_doctor(
    did: int,
    body: AdminDoctorUpdateBody,
    _admin: AdminAccount = Depends(get_current_admin_account),
    db: Session = Depends(get_db),
):
    row = db.get(DoctorAccount, did)
    if row is None:
        raise HTTPException(status_code=404, detail="医生不存在")
    if body.name is not None:
        row.name = body.name.strip() or None
    if body.phone is not None:
        phone = body.phone.strip()
        if phone and (not _CN_MOBILE.match(phone)):
            raise HTTPException(status_code=400, detail="请输入 11 位大陆手机号")
        row.phone = phone or None
    if body.email is not None:
        email = body.email.strip()
        if email and (not _EMAIL_OK.match(email)):
            raise HTTPException(status_code=400, detail="邮箱格式不正确")
        row.email = email or None
    if body.specialty is not None:
        row.specialty = body.specialty.strip() or None
    if body.title is not None:
        row.title = body.title.strip() or None
    if body.hospital is not None:
        row.hospital = body.hospital.strip() or None
    db.add(row)
    db.commit()
    return {"ok": True}


@app.put("/api/admin/doctors/{did}/status")
def admin_set_doctor_status(
    did: int,
    body: AdminStatusBody,
    _admin: AdminAccount = Depends(get_current_admin_account),
    db: Session = Depends(get_db),
):
    row = db.get(DoctorAccount, did)
    if row is None:
        raise HTTPException(status_code=404, detail="医生不存在")
    row.is_active = bool(body.active)
    db.add(row)
    db.commit()
    return {"ok": True}


@app.delete("/api/admin/doctors/{did}")
def admin_delete_doctor(
    did: int,
    _admin: AdminAccount = Depends(get_current_admin_account),
    db: Session = Depends(get_db),
):
    """注销医生：从数据库中删除 doctor_accounts 记录（不可恢复）。"""
    row = db.get(DoctorAccount, did)
    if row is None:
        raise HTTPException(status_code=404, detail="医生不存在")
    db.delete(row)
    db.commit()
    return {"ok": True}


@app.put("/api/admin/doctors/{did}/reset-password")
def admin_reset_doctor_password(
    did: int,
    body: AdminResetPasswordBody,
    _admin: AdminAccount = Depends(get_current_admin_account),
    db: Session = Depends(get_db),
):
    row = db.get(DoctorAccount, did)
    if row is None:
        raise HTTPException(status_code=404, detail="医生不存在")
    row.password_hash = hash_password(body.new_password.strip())
    db.add(row)
    db.commit()
    return {"ok": True}


@app.get("/api/user/me/profile")
def get_current_user_profile(user: UserHealthInfo = Depends(get_current_user_health)):
    """当前登录用户的基本资料（姓名、电话、邮箱）。"""
    return {
        "name": user.name,
        "phone": user.phone,
        "email": user.email,
    }


@app.put("/api/user/me/profile")
def put_current_user_profile(
    body: UserProfilePutBody,
    user: UserHealthInfo = Depends(get_current_user_health),
    db: Session = Depends(get_db),
):
    """更新 ``user_info`` 的 name / phone / email；可选校验当前密码后更新 ``user_password``。"""
    phone = body.phone.strip()
    email = body.email.strip()
    name = body.name.strip()
    if not _CN_MOBILE.match(phone):
        raise HTTPException(status_code=400, detail="请输入 11 位大陆手机号")
    if not _EMAIL_OK.match(email):
        raise HTTPException(status_code=400, detail="邮箱格式不正确")

    want_pwd = bool(
        (body.current_password and body.current_password.strip())
        or (body.new_password and body.new_password.strip()),
    )
    if want_pwd:
        cur = (body.current_password or "").strip()
        new = (body.new_password or "").strip()
        if not cur:
            raise HTTPException(status_code=400, detail="修改密码时请填写当前密码")
        if not new:
            raise HTTPException(status_code=400, detail="请填写新密码")
        if len(new) < 8:
            raise HTTPException(status_code=400, detail="新密码至少 8 位")
        if not verify_password(cur, user.user_password):
            raise HTTPException(status_code=400, detail="当前密码不正确")
        user.user_password = hash_password(new)

    user.name = name
    user.phone = phone
    user.email = email
    db.add(user)
    db.commit()
    return {"ok": True}


@app.get("/api/doctor/me/profile")
def get_current_doctor_profile(doctor: DoctorAccount = Depends(get_current_doctor_account)):
    """当前登录医生资料：姓名只读，电话/邮箱可编辑。"""
    return {
        "name": doctor.name,
        "phone": doctor.phone,
        "email": doctor.email,
    }


@app.put("/api/doctor/me/profile")
def put_current_doctor_profile(
    body: DoctorProfilePutBody,
    doctor: DoctorAccount = Depends(get_current_doctor_account),
    db: Session = Depends(get_db),
):
    phone = body.phone.strip()
    email = body.email.strip()
    if not _CN_MOBILE.match(phone):
        raise HTTPException(status_code=400, detail="请输入 11 位大陆手机号")
    if not _EMAIL_OK.match(email):
        raise HTTPException(status_code=400, detail="邮箱格式不正确")

    want_pwd = bool(
        (body.current_password and body.current_password.strip())
        or (body.new_password and body.new_password.strip()),
    )
    if want_pwd:
        cur = (body.current_password or "").strip()
        new = (body.new_password or "").strip()
        if not cur:
            raise HTTPException(status_code=400, detail="修改密码时请填写当前密码")
        if not new:
            raise HTTPException(status_code=400, detail="请填写新密码")
        if len(new) < 6:
            raise HTTPException(status_code=400, detail="新密码至少 6 位")
        if not verify_password(cur, doctor.password_hash):
            raise HTTPException(status_code=400, detail="当前密码不正确")
        doctor.password_hash = hash_password(new)

    doctor.phone = phone
    doctor.email = email
    db.add(doctor)
    db.commit()
    return {"ok": True}


@app.get("/api/user/me/app-access")
def get_current_user_app_access(user: UserHealthInfo = Depends(get_current_user_health)):
    """用户端是否可自由导航：结构化字段达到阈值，或已上传任一类影像路径（见 questionnaire_save）。"""
    return {"fullNavigation": user_has_health_profile_for_full_navigation(user)}


@app.get("/api/user/intervention/guides")
def list_user_health_guides(
    disease: str | None = Query(default=None, description="按疾病关键词过滤，如 脑卒中"),
    type: str | None = Query(default=None, description="按类型过滤，如 干预类"),
    riskLevel: str | None = Query(default=None, description="按风险等级过滤，如 高风险"),
    _user: UserHealthInfo = Depends(get_current_user_health),
    db: Session = Depends(get_db),
):
    q = (
        db.query(HealthArticle)
        .options(selectinload(HealthArticle.images))
        .filter(HealthArticle.show_in_health_guide.is_(True))
        .order_by(HealthArticle.id.desc())
    )
    if disease and disease.strip():
        q = q.filter(HealthArticle.disease.like(f"%{disease.strip()}%"))
    if type and type.strip():
        q = q.filter(HealthArticle.type == type.strip())
    if riskLevel and riskLevel.strip():
        q = q.filter(HealthArticle.risk_level.like(f"%{riskLevel.strip()}%"))

    rows = q.all()
    return _health_article_rows_to_out(rows)


@app.get("/api/user/intervention/guides/recommended")
def list_user_health_guides_recommended(
    user: UserHealthInfo = Depends(get_current_user_health),
    db: Session = Depends(get_db),
):
    """三病均低：推送认知类 + 饮食/运动类。任一中/高：先按病种+文章 risk 标签匹配；无结果时逐级放宽（兼容中/高标签、关键词、认知类回退）。"""
    base = user_health_to_predict_dict(user)
    raw = predict_triple(base)
    rows = (
        db.query(HealthArticle)
        .options(selectinload(HealthArticle.images))
        .filter(HealthArticle.show_in_health_guide.is_(True))
        .all()
    )
    picked = select_health_guides_for_user(user, raw, rows)
    return _health_article_rows_to_out(picked)


def _yn_is_yes(v: Any) -> bool:
    if v is None:
        return False
    return str(v).strip() == "是"


def _maybe_decimal_to_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _extract_first_json_object(s: str) -> dict[str, Any] | None:
    """
    DeepSeek 输出可能带前后解释，这里抽取第一段 {...} 进行 JSON 解析。
    """
    if not s:
        return None
    s2 = s.strip()
    if s2.startswith("{") and s2.endswith("}"):
        try:
            return json.loads(s2)
        except Exception:
            return None
    m = re.search(r"\{.*\}", s2, flags=re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except Exception:
        return None


def _extract_text_from_llm_content(content: Any) -> str:
    """
    兼容 OpenAI/Ark 常见 content 形态：
    - str
    - list[{"type":"text","text":"..."}]
    - 其他结构兜底转字符串
    """
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                t = item.get("text")
                if isinstance(t, str):
                    parts.append(t)
        return "\n".join([p for p in parts if p])
    return str(content or "")


# AI 干预建议短时缓存：同一用户、问卷未更新时直接返回上次结果，显著降低重复打开页面的等待。
_AI_IV_CACHE: dict[tuple[int, str], tuple[float, dict[str, Any]]] = {}
_AI_IV_TTL_SEC = max(0.0, float(os.environ.get("AI_INTERVENTION_CACHE_TTL_SEC", "300")))


def _ai_iv_cache_get(key: tuple[int, str]) -> dict[str, Any] | None:
    if _AI_IV_TTL_SEC <= 0:
        return None
    ent = _AI_IV_CACHE.get(key)
    if not ent:
        return None
    exp, body = ent
    if time.monotonic() > exp:
        _AI_IV_CACHE.pop(key, None)
        return None
    return copy.deepcopy(body)


def _ai_iv_cache_set(key: tuple[int, str], body: dict[str, Any]) -> None:
    if _AI_IV_TTL_SEC <= 0:
        return
    now = time.monotonic()
    for k, (exp, _) in list(_AI_IV_CACHE.items()):
        if exp <= now:
            del _AI_IV_CACHE[k]
    if len(_AI_IV_CACHE) > 600:
        _AI_IV_CACHE.clear()
    _AI_IV_CACHE[key] = (now + _AI_IV_TTL_SEC, copy.deepcopy(body))


@app.get("/api/user/intervention/guides/ai-recommended")
def list_user_health_guides_ai_recommended(
    refresh: bool = Query(False, description="为 true 时跳过服务端短时缓存，强制重新调用模型"),
    _user: UserHealthInfo = Depends(get_current_user_health),
    db: Session = Depends(get_db),
):
    """
    AI 个性化干预建议（仅用于科普展示）。
    输出包含：
    - reasons：基于你的风险分层与生活习惯的推荐理由
    - diet/exercise/lifestyle：对应的简短建议条目（不输出医疗诊断）
    - supportingArticleIds：可参考文章（来自规则召回，不强制前端按此排序）

    默认使用进程内短时缓存（见 AI_INTERVENTION_CACHE_TTL_SEC）；``refresh=1`` 时跳过缓存重新生成。
    """
    uat = getattr(_user, "updated_at", None)
    ck = (int(_user.id), uat.isoformat() if uat is not None else "")
    if not refresh:
        cached = _ai_iv_cache_get(ck)
        if cached is not None:
            return cached

    def finish(result: dict[str, Any]) -> dict[str, Any]:
        _ai_iv_cache_set(ck, result)
        return result

    # 基于当前用户计算风险分层
    base = user_health_to_predict_dict(_user)
    raw = predict_triple(base)
    risks = raw.get("risk") or {}

    # 候选内容：复用规则召回；不加载 images（本接口不用），并限制篇数降低查询耗时
    rows = (
        db.query(HealthArticle)
        .filter(HealthArticle.show_in_health_guide.is_(True))
        .order_by(HealthArticle.id.desc())
        .limit(500)
        .all()
    )
    picked = select_health_guides_for_user(_user, raw, rows)
    # 控制提示词体积，降低云端模型响应延迟和超时概率
    candidates = picked[:8]
    supporting_ids = [a.id for a in candidates[:6]]

    # 缓冲：即使 DeepSeek 不可用也要返回可展示内容
    fpg = _maybe_decimal_to_float(getattr(_user, "fasting_blood_glucose", None))
    hba1c = _maybe_decimal_to_float(getattr(_user, "hba1c", None))
    bmi = _maybe_decimal_to_float(getattr(_user, "bmi", None))
    tg = _maybe_decimal_to_float(getattr(_user, "triglyceride", None))
    hdl = _maybe_decimal_to_float(getattr(_user, "hdl_c", None))
    ldl = _maybe_decimal_to_float(getattr(_user, "ldl_c", None))
    tc = _maybe_decimal_to_float(getattr(_user, "total_cholesterol", None))
    alt_ast = _maybe_decimal_to_float(getattr(_user, "alt_ast_ratio", None))
    tc_hdl = _maybe_decimal_to_float(getattr(_user, "tc_hdl_ratio", None))
    smoking = _yn_is_yes(getattr(_user, "smoking", None))
    exercise_yes = _yn_is_yes(getattr(_user, "moderate_high_intensity_exercise", None))

    hypertension = _yn_is_yes(getattr(_user, "has_hypertension", None))
    use_antihypertensive = _yn_is_yes(getattr(_user, "use_antihypertensive", None))
    use_hypoglycemic = _yn_is_yes(getattr(_user, "use_hypoglycemic", None))

    polyuria = _yn_is_yes(getattr(_user, "frequent_urination", None))
    thirst = _yn_is_yes(getattr(_user, "excessive_thirst", None))
    weight_loss = _yn_is_yes(getattr(_user, "unexplained_weight_loss", None))
    blur_vision = _yn_is_yes(getattr(_user, "blurred_vision", None))
    slow_healing = _yn_is_yes(getattr(_user, "slow_wound_healing", None))

    sedentary_min = _maybe_decimal_to_float(getattr(_user, "sedentary_time_daily", None))
    diet_quality = getattr(_user, "diet_quality", None)
    sleep_quality = getattr(_user, "sleep_quality", None)
    fatigue_level = getattr(_user, "fatigue_level", None)
    health_knowledge = getattr(_user, "health_knowledge", None)
    life_quality = getattr(_user, "life_quality", None)

    def _maybe_int(v: Any) -> int | None:
        if v is None:
            return None
        try:
            return int(float(v))
        except (TypeError, ValueError):
            return None

    drinking_freq = getattr(_user, "drinking_frequency", None)
    drinking_freq_i = _maybe_int(drinking_freq)

    def _fallback(reason: str = "fallback") -> dict[str, Any]:
        reasons: list[str] = []

        # 风险分层（只作为背景，不要“只看风险”）
        for ax, label in [
            ("肝病", risks.get("liver", {}).get("label")),
            ("糖尿病", risks.get("diabetes", {}).get("label")),
            ("脑卒中", risks.get("stroke", {}).get("label")),
        ]:
            if label in ("中风险", "高风险"):
                reasons.append(f"{ax}处于{label}，建议优先调整饮食与日常管理。")

        # 指标驱动的个性化理由
        if bmi is not None and bmi >= 24:
            reasons.append(f"你的 BMI≈{bmi:.1f}，更需要通过“总量控制+规律运动”来改善代谢。")
        if fpg is not None and fpg >= 100:
            reasons.append(f"空腹血糖≈{fpg:.1f}偏高，建议把“低糖饮食+餐后轻活动”固定成习惯。")
        if hba1c is not None and hba1c >= 5.7:
            reasons.append(f"糖化血红蛋白≈{hba1c:.1f}偏上，强调持续 4-12 周的饮食与作息管理。")
        if tg is not None and tg >= 150:
            reasons.append(f"甘油三酯≈{tg:.1f}偏高，饮食上优先减少油炸与高糖高脂搭配。")
        if hypertension:
            reasons.append("你有高血压记录，运动与饮食需更关注“减盐+稳定血压”。")
        if use_antihypertensive:
            reasons.append("你记录在用降压药物：建议按医嘱规律用药，并避免剧烈突然运动。")
        if use_hypoglycemic:
            reasons.append("你记录在用降糖药物：运动前后建议更注意血糖波动与安全。")
        if smoking:
            reasons.append("你有吸烟记录：戒烟/减少暴露会对整体风险改善更直接。")
        if drinking_freq_i is not None and drinking_freq_i and drinking_freq_i > 0:
            reasons.append(f"你饮酒频度为 {drinking_freq_i} 档：建议先把“饮酒量/频次”降下来。")
        if sedentary_min is not None and sedentary_min >= 600:
            reasons.append(f"你久坐约 {sedentary_min:.0f} 分钟/天：建议加入“每小时起身 3-5 分钟”。")
        if sleep_quality is not None and sleep_quality <= 5:
            reasons.append("睡眠质量偏低：建议固定作息，避免熬夜影响血糖与食欲。")
        if fatigue_level is not None and fatigue_level >= 7:
            reasons.append("你主观疲劳偏高：运动从“低强度可持续”开始，先保证规律再逐步加量。")
        if polyuria or thirst:
            reasons.append("你有尿频/口渴相关记录：建议控制含糖饮品，保持规律饮水。")
        if slow_healing:
            reasons.append("你有伤口愈合缓慢记录：更需要规律作息与营养结构稳定。")

        if len(reasons) < 4:
            reasons.append("结合你当前数据，给出可执行的饮食、运动与日常管理组合建议。")

        # 建议：每条都尽量“绑定”某个用户输入
        diet: list[str] = []
        diet.append("减少含糖饮料与甜点，把主食换成“全谷物/杂粮”为主。")
        if fpg is not None and fpg >= 100:
            diet.append("优先按“餐前/餐后血糖友好”来分配碳水，少量多餐更稳。")
        if tg is not None and tg >= 150:
            diet.append("少油炸、少加工肉；选择蒸/煮/炖，提升蔬菜和优质蛋白比例。")
        if hypertension:
            diet.append("清淡少盐、减少腌制与外卖调味，尽量用香辛料替代重口味。")
        if use_hypoglycemic:
            diet.append("药物使用期间，避免跳餐；按时进食并配合运动更安全。")
        if smoking:
            diet.append("戒烟/减少吸烟同时，饮食上避免辛辣酒精刺激（先从减少刺激性饮品开始）。")
        if len(diet) < 4:
            diet.append("控制总热量，保证蛋白质与膳食纤维摄入，形成长期可坚持结构。")

        exercise: list[str] = []
        if exercise_yes:
            exercise.append("你有中高强度运动记录：维持规律的有氧+力量训练组合，避免突然大幅加量。")
        else:
            exercise.append("你中高强度运动记录偏少：从快走/骑行每次 15-20 分钟开始，循序渐进。")
        if fpg is not None and fpg >= 100:
            exercise.append("餐后 20-30 分钟轻活动，帮助血糖更平稳。")
        if hypertension:
            exercise.append("运动避免屏气用力和“冲刺式”突然加量，强度以能说话为宜。")
        if use_hypoglycemic:
            exercise.append("用药期间建议运动前后注意状态，避免空腹剧烈或过度运动。")
        if fatigue_level is not None and fatigue_level >= 7:
            exercise.append("疲劳偏高时选择低强度（散步/轻拉伸/慢骑），以“可持续”为第一目标。")

        lifestyle: list[str] = []
        lifestyle.append("规律作息：尽量固定入睡/起床时间，减少熬夜对食欲与血糖的影响。")
        if sedentary_min is not None and sedentary_min >= 600:
            lifestyle.append("久坐管理：每小时起身活动 3-5 分钟，帮你把代谢压力降下来。")
        if sleep_quality is not None and sleep_quality <= 5:
            lifestyle.append("睡前 1 小时减少刺激（熬夜/刷屏），用放松方式帮助入睡。")
        if drinking_freq_i is not None and drinking_freq_i and drinking_freq_i > 0:
            lifestyle.append("饮酒管理：先降低频次与单次量，避免“空腹饮酒+高糖饮料”。")
        if smoking:
            lifestyle.append("如果暂时难以完全戒烟：先制定减量/替代计划，并减少“饭后/压力时段”的吸烟触发。")
        if health_knowledge is not None and health_knowledge <= 5:
            lifestyle.append("知识与执行结合：从一个“最容易坚持”的目标开始（如每天 1 步规则/一份低糖餐）。")
        if life_quality is not None and life_quality <= 5:
            lifestyle.append("把习惯做简单：固定一套可重复的饮食与运动流程，而不是追求一两天的极端改变。")

        return {
            "provider": "fallback",
            "model": "local-fallback",
            "reason": reason,
            "reasons": reasons[:8],
            "diet": diet[:6],
            "exercise": exercise[:6],
            "lifestyle": lifestyle[:6],
            "supportingArticleIds": supporting_ids,
        }

    # 豆包（火山方舟 Ark）优先；同时兼容旧的 DEEPSEEK_* 配置以便迁移
    # - 豆包：DOUBAO_API_KEY / DOUBAO_BASE_URL / DOUBAO_MODEL
    # - Ark：ARK_API_KEY / ARK_BASE_URL / ARK_MODEL（同义）
    # - 兼容：DEEPSEEK_API_KEY / DEEPSEEK_BASE_URL / DEEPSEEK_MODEL
    api_key = (
        os.environ.get("DOUBAO_API_KEY", "").strip()
        or os.environ.get("ARK_API_KEY", "").strip()
        or os.environ.get("DEEPSEEK_API_KEY", "").strip()
    )
    if not api_key:
        print("[ai] provider=fallback reason=missing_api_key")
        return finish(_fallback("missing_api_key"))

    base_url = (
        (os.environ.get("DOUBAO_BASE_URL") or "").strip()
        or (os.environ.get("ARK_BASE_URL") or "").strip()
        or (os.environ.get("DEEPSEEK_BASE_URL") or "").strip()
        or "https://ark.cn-beijing.volces.com/api/v3"
    ).rstrip("/")

    model = (
        (os.environ.get("DOUBAO_MODEL") or "").strip()
        or (os.environ.get("ARK_MODEL") or "").strip()
        or (os.environ.get("DEEPSEEK_MODEL") or "").strip()
        or "doubao-seed-1.6"
    ).strip()

    # 候选文章摘要（用于 AI 选择推荐理由/点对点提醒）
    cand_payload = []
    for a in candidates:
        cand_payload.append(
            {
                "id": a.id,
                "title": a.title,
                "type": a.type,
                "disease": (a.disease or ""),
                "riskLevel": a.risk_level or "",
                "summary": (a.summary or "")[:120],
            }
        )

    # 用户画像（给 AI 用；避免输出概率/诊断；但尽量提供可个性化的“具体字段”）
    profile_payload = {
        "age": getattr(_user, "age", None),
        "gender": getattr(_user, "gender", None),
        "risk": {
            "liver": risks.get("liver", {}).get("label"),
            "diabetes": risks.get("diabetes", {}).get("label"),
            "stroke": risks.get("stroke", {}).get("label"),
        },
        "body": {
            "bmi": bmi,
        },
        "labs": {
            "fpg": fpg,
            "hba1c": hba1c,
            "tg": tg,
            "hdl": hdl,
            "ldl": ldl,
            "tc": tc,
            "alt_ast_ratio": alt_ast,
            "tc_hdl_ratio": tc_hdl,
        },
        "lifestyleFlags": {
            "smoking": smoking,
            "drinkingFrequency": drinking_freq_i,
            "moderateHighIntensityExercise": exercise_yes,
            "sedentaryMinutesPerDay": sedentary_min,
            "sleepQuality": sleep_quality,
            "dietQuality": diet_quality,
            "fatigueLevel": fatigue_level,
            "healthKnowledge": health_knowledge,
            "lifeQuality": life_quality,
        },
        "medicalFlags": {
            "hypertension": hypertension,
            "useAntihypertensive": use_antihypertensive,
            "useHypoglycemic": use_hypoglycemic,
            "symptomPolyuria": polyuria,
            "symptomThirst": thirst,
            "symptomWeightLoss": weight_loss,
            "symptomBlurVision": blur_vision,
            "symptomSlowHealing": slow_healing,
        },
    }

    system_prompt = (
        "你是健康干预助手。你的任务是基于用户画像，给出饮食、运动、生活习惯的个性化建议与推荐理由。\n"
        "强个性化要求（必须遵守）：\n"
        "1) 禁止只依据风险分层标签写泛化内容；必须结合 userProfile 里的“具体字段”做差异化。\n"
        "2) reasons/diet/exercise/lifestyle 的每一条都要提到至少一个与用户输入直接相关的点（例如：smoking、sedentaryMinutesPerDay、sleepQuality、dietQuality、fatigueLevel、hypertension、useHypoglycemic、fpg/hba1c/tg/bmi 等），并解释“为什么这样建议”。\n"
        "3) 禁止输出医疗诊断结论；只做科普与行为建议。\n"
        "4) 禁止输出任何概率/模型概率/风险分/评分。\n"
        "5) 输出必须是严格 JSON（不要用 Markdown，不要输出多余文本）。\n"
        "6) JSON 结构键名固定：reasons,diet,exercise,lifestyle,supportingArticleIds。\n"
        "7) reasons 6-8 条；diet/exercise/lifestyle 各 3-6 条；每条尽量简短可执行。\n"
        "8) supportingArticleIds 必须是 candidates 里存在的 id 数组（可为空）。"
    )

    user_prompt = {
        "userProfile": profile_payload,
        "candidates": cand_payload,
        "outputHint": {
            "reasons": "每条都要写清“依据哪个输入字段”以及“因此需要做什么”，避免泛化。",
            "diet": "饮食建议要绑定用户的血糖/血脂/BMI/高血压/用药/症状等字段中的至少一个。",
            "exercise": "运动建议要绑定运动强度记录（exerciseHighIntensity）与用药/血糖偏高/血压等字段中的至少一个。",
            "lifestyle": "生活方式建议要绑定久坐/睡眠/饮食质量/疲劳/吸烟/饮酒等字段中的至少一个。",
        },
    }

    payload = {
        "model": model,
        "temperature": 0.35,
        "stream": False,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(user_prompt, ensure_ascii=False)},
        ],
        "max_tokens": 360,
    }

    # 超时后使用轻量请求重试一次，尽量避免直接降级
    lite_profile = {
        "risk": profile_payload.get("risk"),
        "labs": {
            "fpg": fpg,
            "hba1c": hba1c,
            "tg": tg,
            "bmi": bmi,
        },
        "lifestyleFlags": {
            "smoking": smoking,
            "drinkingFrequency": drinking_freq_i,
            "moderateHighIntensityExercise": exercise_yes,
            "sedentaryMinutesPerDay": sedentary_min,
            "sleepQuality": sleep_quality,
        },
        "medicalFlags": {
            "hypertension": hypertension,
            "useHypoglycemic": use_hypoglycemic,
        },
    }
    lite_prompt = {
        "userProfile": lite_profile,
        "candidates": [{"id": c["id"], "title": c["title"], "disease": c["disease"]} for c in cand_payload[:4]],
        "outputHint": user_prompt["outputHint"],
    }
    lite_payload = {
        "model": model,
        "temperature": 0.2,
        "stream": False,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(lite_prompt, ensure_ascii=False)},
        ],
        "max_tokens": 260,
    }

    # 最小兼容请求体（用于 HTTP 400 时重试）
    compact_profile_lines = [
        f"risk(liver/diabetes/stroke)={risks.get('liver', {}).get('label')}/{risks.get('diabetes', {}).get('label')}/{risks.get('stroke', {}).get('label')}",
        f"bmi={bmi}, fpg={fpg}, hba1c={hba1c}, tg={tg}",
        f"smoking={smoking}, drink_freq={drinking_freq_i}, exercise_high={exercise_yes}, sedentary={sedentary_min}",
        f"sleep={sleep_quality}, fatigue={fatigue_level}, htn={hypertension}, hypoglycemic={use_hypoglycemic}",
    ]
    compact_profile = " | ".join([x for x in compact_profile_lines if x and x.strip()])

    minimal_payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": "你是助手，仅返回严格JSON对象。"},
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "profile": compact_profile,
                        "output": "仅返回JSON，键必须是 reasons,diet,exercise,lifestyle,supportingArticleIds；reasons固定4条，diet固定3条，exercise固定3条，lifestyle固定3条；每条建议短且可执行。",
                    },
                    ensure_ascii=False,
                ),
            },
        ],
        "max_tokens": 360,
    }

    minimal_retry_payload = {
        "model": model,
        "temperature": 0.1,
        "messages": [
            {
                "role": "system",
                "content": "你是助手。只允许返回一个完整JSON对象，禁止任何前后文字。",
            },
            {
                "role": "user",
                "content": (
                    "按以下结构返回完整JSON，不要省略括号："
                    '{"reasons":["...","...","...","..."],'
                    '"diet":["...","...","..."],'
                    '"exercise":["...","...","..."],'
                    '"lifestyle":["...","...","..."],'
                    '"supportingArticleIds":[]}'
                    f"。用户画像：{compact_profile}"
                ),
            },
        ],
        "max_tokens": 420,
    }

    # Ark / 豆包为 OpenAI 兼容：/api/v3/chat/completions
    endpoint = "/chat/completions" if base_url.endswith("/api/v3") else "/api/v3/chat/completions"

    def _call_once(req_payload: dict[str, Any], timeout_s: int, tag: str) -> dict[str, Any] | None:
        t0 = time.monotonic()
        print(f"[ai] provider=doubao calling model={model} mode={tag} timeout={timeout_s}s")
        req = urllib.request.Request(
            url=f"{base_url}{endpoint}",
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            data=json.dumps(req_payload, ensure_ascii=False).encode("utf-8"),
        )
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            raw_text = resp.read().decode("utf-8", errors="ignore")
        obj = json.loads(raw_text)
        raw_content = (
            obj.get("choices", [{}])[0]
            .get("message", {})
            .get("content")
            or obj.get("choices", [{}])[0].get("text")
            or ""
        )
        content = _extract_text_from_llm_content(raw_content)
        parsed = _extract_first_json_object(content)
        ms = int((time.monotonic() - t0) * 1000)
        if not parsed:
            preview = content[:220].replace("\n", " ")
            print(f"[ai] provider=doubao mode={tag} parse_failed elapsed_ms={ms} preview={preview!r}")
            return None

        def _safe_article_ids(v: Any, default_ids: list[int]) -> list[int]:
            """容错解析 supportingArticleIds，避免模型返回脏值触发 ValueError 导致整段降级。"""
            if not isinstance(v, list):
                return list(default_ids)
            out_ids: list[int] = []
            for x in v:
                try:
                    n = int(str(x).strip())
                except (TypeError, ValueError):
                    continue
                if n > 0:
                    out_ids.append(n)
            return out_ids if out_ids else list(default_ids)

        out = {
            "provider": "doubao",
            "model": model,
            "reasons": list(map(str, parsed.get("reasons") or []))[:8],
            "diet": list(map(str, parsed.get("diet") or []))[:6],
            "exercise": list(map(str, parsed.get("exercise") or []))[:6],
            "lifestyle": list(map(str, parsed.get("lifestyle") or []))[:6],
            "supportingArticleIds": _safe_article_ids(parsed.get("supportingArticleIds"), supporting_ids),
        }
        print(f"[ai] provider=doubao success model={model} mode={tag} elapsed_ms={ms}")
        return out

    try:
        # 优先轻量请求（提示词短、max_tokens 小），多数场景首包更快；失败再逐级加重试
        out_lite = _call_once(lite_payload, 28, "lite-first")
        if out_lite:
            return finish(out_lite)

        out_full = _call_once(payload, 32, "full")
        if out_full:
            return finish(out_full)

        out0 = _call_once(minimal_payload, 30, "minimal")
        if out0:
            return finish(out0)

        out0b = _call_once(minimal_retry_payload, 30, "minimal-retry")
        if out0b:
            return finish(out0b)

        print("[ai] provider=fallback reason=parse_failed_all")
        return finish(_fallback("parse_failed"))
    except urllib.error.HTTPError as e:
        code = int(getattr(e, "code", 0) or 0)
        body_preview = ""
        try:
            body_preview = e.read().decode("utf-8", "ignore")
        except Exception:
            body_preview = ""
        body_preview = (body_preview or "").replace("\n", " ")[:280]
        print(f"[ai] provider=doubao http_error status={code} preview={body_preview!r}")
        # 400 常见是参数不兼容，做一次最小兼容重试
        if code == 400:
            try:
                out3 = _call_once(minimal_payload, 28, "minimal-http400")
                if out3:
                    return finish(out3)
            except Exception:
                pass
        print(f"[ai] provider=fallback reason=http_error status={code}")
        return finish(_fallback(f"http_{code}" if code else "http_error"))
    except TimeoutError:
        # 首次超时时，再尝试一次轻量请求
        try:
            out2 = _call_once(lite_payload, 24, "lite-retry")
            if out2:
                return finish(out2)
        except Exception:
            pass
        print("[ai] provider=fallback reason=timeout")
        return finish(_fallback("timeout"))
    except urllib.error.URLError as e:
        msg = str(getattr(e, "reason", e)).lower()
        if "timed out" in msg or "timeout" in msg:
            try:
                out2 = _call_once(lite_payload, 24, "lite-retry")
                if out2:
                    return finish(out2)
            except Exception:
                pass
            print("[ai] provider=fallback reason=timeout")
            return finish(_fallback("timeout"))
        print(f"[ai] provider=fallback reason=url_error detail={msg[:80]}")
        return finish(_fallback("url_error"))
    except Exception as e:
        print(f"[ai] provider=fallback reason=request_failed detail={type(e).__name__}")
        return finish(_fallback("request_failed"))


@app.get("/api/user/intervention/hospitals")
def list_intervention_hospitals(
    _user: UserHealthInfo = Depends(get_current_user_health),
    db: Session = Depends(get_db),
):
    """就医推荐：示范医院列表（含经纬度）；前端结合浏览器定位按距离排序。"""
    rows = db.query(Hospital).where(Hospital.is_active == True).order_by(Hospital.id.desc()).all()  # noqa: E712
    out: list[dict[str, Any]] = []
    for r in rows:
        out.append(
            {
                "id": r.id,
                "name": r.name,
                "level": r.level,
                "department": r.department or "",
                "address": r.address,
                "phone": r.phone,
                "latitude": float(r.latitude) if r.latitude is not None else None,
                "longitude": float(r.longitude) if r.longitude is not None else None,
                "rating": float(r.rating) if r.rating is not None else 0,
                "experts": int(r.experts) if r.experts is not None else 0,
                "specialties": [s.strip() for s in (r.specialties or "").split(",") if s.strip()],
                "departments": [s.strip() for s in (r.departments or "").split(",") if s.strip()],
                "workingHours": r.working_hours or "",
            }
        )
    return out


@app.get("/api/user/intervention/images/{image_id}")
def get_user_health_guide_image(
    image_id: int,
    db: Session = Depends(get_db),
):
    row = db.get(HealthArticleImage, image_id)
    if row is None:
        raise HTTPException(status_code=404, detail="图片不存在")
    if not row.image_path:
        raise HTTPException(status_code=404, detail="图片路径不存在")
    p = Path(row.image_path)
    if not p.exists() or not p.is_file():
        raise HTTPException(status_code=404, detail="图片文件不存在")
    return FileResponse(path=p, media_type=row.mime_type, filename=row.filename)


@app.get("/api/user/me/questionnaire")
def get_current_user_questionnaire(user: UserHealthInfo = Depends(get_current_user_health)):
    """当前登录用户从 ``user_info`` 读取已保存问卷，供健康数据页回填表单。"""
    return user_health_to_questionnaire_bundle(user)


def _image_field_by_axis(axis: str) -> str:
    ax = (axis or "").strip().lower()
    if ax == "liver":
        return "liver_image_path"
    if ax == "diabetes":
        return "diabetes_image_path"
    if ax == "stroke":
        return "stroke_image_path"
    raise HTTPException(status_code=400, detail="axis 必须为 liver/diabetes/stroke")


@app.post("/api/user/me/images/{axis}")
def upload_user_axis_image(
    axis: str,
    file: UploadFile = File(...),
    user: UserHealthInfo = Depends(get_current_user_health),
    db: Session = Depends(get_db),
):
    """上传影像文件：落盘并把绝对路径写入 user_info 的对应 *_image_path 字段（每轴覆盖保存一份）。"""
    field = _image_field_by_axis(axis)
    if not file.filename:
        raise HTTPException(status_code=400, detail="请选择文件")

    # 允许常见图片 + PDF + DICOM（.dcm）
    fn = Path(file.filename).name
    suffix = Path(fn).suffix.lower()
    if suffix not in {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".pdf", ".dcm"}:
        raise HTTPException(status_code=400, detail="不支持的文件格式")

    # 生成保存路径（workspace 内，写入绝对路径）
    safe_token = secrets.token_hex(8)
    dst_dir = (UPLOAD_DIR / f"user_{user.id}" / axis).resolve()
    dst_dir.mkdir(parents=True, exist_ok=True)
    dst = dst_dir / f"{safe_token}_{fn}"

    # 流式写入，避免大文件占用内存
    size = 0
    with dst.open("wb") as f:
        while True:
            chunk = file.file.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > 50 * 1024 * 1024:
                try:
                    f.close()
                    if dst.exists():
                        dst.unlink()
                except Exception:
                    pass
                raise HTTPException(status_code=400, detail="文件过大（>50MB）")
            f.write(chunk)
    if size <= 0:
        raise HTTPException(status_code=400, detail="文件为空")

    setattr(user, field, str(dst))
    db.add(user)
    db.commit()

    mime = file.content_type or (mimetypes.guess_type(fn)[0] or "application/octet-stream")
    return {"ok": True, "axis": axis, "filename": fn, "mimeType": mime, "url": f"/api/user/me/images/{axis}"}


@app.get("/api/user/me/images/{axis}/meta")
def get_user_axis_image_meta(
    axis: str,
    user: UserHealthInfo = Depends(get_current_user_health),
):
    """获取当前用户某轴影像的元信息（不返回二进制）。"""
    field = _image_field_by_axis(axis)
    p_raw = getattr(user, field, None)
    if not p_raw:
        return {"exists": False}
    p = Path(str(p_raw))
    if not p.exists() or not p.is_file():
        return {"exists": False}
    fn = p.name
    mime = mimetypes.guess_type(fn)[0] or "application/octet-stream"
    return {"exists": True, "axis": axis, "filename": fn, "mimeType": mime, "url": f"/api/user/me/images/{axis}"}


@app.get("/api/user/me/images/{axis}")
def get_user_axis_image(
    axis: str,
    user: UserHealthInfo = Depends(get_current_user_health),
):
    """预览/下载当前用户某轴影像文件。"""
    field = _image_field_by_axis(axis)
    p_raw = getattr(user, field, None)
    if not p_raw:
        raise HTTPException(status_code=404, detail="暂无影像")
    p = Path(str(p_raw))
    if not p.exists() or not p.is_file():
        raise HTTPException(status_code=404, detail="影像文件不存在")
    fn = p.name
    mime = mimetypes.guess_type(fn)[0] or "application/octet-stream"
    return FileResponse(path=p, media_type=mime, filename=fn)


@app.delete("/api/user/me/images/{axis}")
def delete_user_axis_image(
    axis: str,
    user: UserHealthInfo = Depends(get_current_user_health),
    db: Session = Depends(get_db),
):
    """删除当前用户某轴影像：清空 user_info 字段，并尽量删除磁盘文件。"""
    field = _image_field_by_axis(axis)
    p_raw = getattr(user, field, None)
    setattr(user, field, None)
    db.add(user)
    db.commit()
    if p_raw:
        try:
            p = Path(str(p_raw))
            if p.exists() and p.is_file():
                p.unlink()
            # 尝试清理空目录 user_{id}/axis
            try:
                parent = p.parent
                if parent.exists() and parent.is_dir() and not any(parent.iterdir()):
                    parent.rmdir()
            except Exception:
                pass
        except Exception:
            pass
    return {"ok": True}


@app.api_route("/api/user/me/questionnaire", methods=["PUT", "POST"])
def put_current_user_questionnaire(
    body: UserQuestionnairePutBody,
    user: UserHealthInfo = Depends(get_current_user_health),
    db: Session = Depends(get_db),
):
    """当前登录用户（JWT role=user）将问卷写入 ``user_info`` 行。字段按「键名映射」，与表列顺序无关。"""
    if not any([body.basic, body.lifestyle, body.indicators, body.derived]):
        raise HTTPException(
            status_code=400,
            detail="请至少提供 basic、lifestyle、indicators 或 derived 之一",
        )
    apply_questionnaire_to_user(
        user,
        basic=body.basic,
        lifestyle=body.lifestyle,
        indicators=body.indicators,
        derived=body.derived,
    )
    db.add(user)
    db.commit()

    # 每次提交问卷：新增一条历史快照（供随访历史/趋势可视化）
    now_dt = datetime.now(timezone.utc)
    snapshot_payload = user_health_to_questionnaire_bundle(user)

    # 默认：兜底也会写入快照（只是不一定有模型概率）
    p_liver = 0.0
    p_diabetes = 0.0
    p_stroke = 0.0
    liver_level = "low"
    diabetes_level = "low"
    stroke_level = "low"
    max_level = "low"

    try:
        pred = predict_triple(user_health_to_predict_dict(user))
        probs = pred.get("probabilities") or {}
        p_liver = float(probs.get("liver") or 0.0)
        p_diabetes = float(probs.get("diabetes") or 0.0)
        p_stroke = float(probs.get("stroke") or 0.0)
        pmax = max(p_liver, p_diabetes, p_stroke)
        max_level = risk_level_from_prob(pmax)

        risks = pred.get("risk") or {}
        liver_level = (risks.get("liver") or {}).get("level") or risk_level_from_prob(p_liver)
        diabetes_level = (risks.get("diabetes") or {}).get("level") or risk_level_from_prob(p_diabetes)
        stroke_level = (risks.get("stroke") or {}).get("level") or risk_level_from_prob(p_stroke)
    except Exception as e:
        # 不阻断用户保存：但需要在服务端日志中可追踪
        print(f"[history_snapshot] predict failed user_id={user.id} err={e}", flush=True)

    next_days = next_review_days_for_level(max_level)
    next_review_dt = now_dt + timedelta(days=int(next_days))
    try:
        db.add(
            UserHealthSnapshot(
                user_id=user.id,
                snapshot_time=now_dt,
                payload_json=json.dumps(snapshot_payload, ensure_ascii=False),
                p_liver=p_liver,
                p_diabetes=p_diabetes,
                p_stroke=p_stroke,
                liver_level=str(liver_level),
                diabetes_level=str(diabetes_level),
                stroke_level=str(stroke_level),
                next_review_date=next_review_dt,
            )
        )
        db.commit()
    except Exception as e:
        print(f"[history_snapshot] insert failed user_id={user.id} err={e}", flush=True)

    _invalidate_dashboard_server_cache()
    print(
        f"[questionnaire] saved user_info id={user.id} account={user.user_account!r}",
        flush=True,
    )
    return {"ok": True}


def _health_risk_label(level: str) -> str:
    return {"high": "高风险", "medium": "中风险", "low": "低风险"}.get(level, level)


def _health_parse_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        s = str(v).strip()
        if not s:
            return None
        f = float(s)
        if not math.isfinite(f):
            return None
        return f
    except Exception:
        return None


@app.get("/api/user/me/health-history")
def user_health_history_list(
    user: UserHealthInfo = Depends(get_current_user_health),
    db: Session = Depends(get_db),
):
    """
    历史快照列表：每次提交问卷生成一条 `user_health_history` 快照记录
    """

    snaps = (
        db.scalars(
            select(UserHealthSnapshot)
            .where(UserHealthSnapshot.user_id == user.id)
            .order_by(UserHealthSnapshot.snapshot_time.desc())
        )
        .all()
    )

    # 若历史为空（旧用户），即时回填 1 条快照，保证前端可用
    if not snaps:
        now_dt = datetime.now(timezone.utc)
        snapshot_payload = user_health_to_questionnaire_bundle(user)
        try:
            pred = predict_triple(user_health_to_predict_dict(user))
            probs = pred.get("probabilities") or {}
            p_liver = float(probs.get("liver") or 0.0)
            p_diabetes = float(probs.get("diabetes") or 0.0)
            p_stroke = float(probs.get("stroke") or 0.0)
            pmax = max(p_liver, p_diabetes, p_stroke)
            max_level = risk_level_from_prob(pmax)
            next_days = next_review_days_for_level(max_level)

            risks = pred.get("risk") or {}
            liver_level = (risks.get("liver") or {}).get("level") or risk_level_from_prob(p_liver)
            diabetes_level = (risks.get("diabetes") or {}).get("level") or risk_level_from_prob(p_diabetes)
            stroke_level = (risks.get("stroke") or {}).get("level") or risk_level_from_prob(p_stroke)
        except Exception as e:
            print(f"[history_backfill] failed user_id={user.id} err={e}", flush=True)
            p_liver = p_diabetes = p_stroke = 0.0
            max_level = "low"
            next_days = next_review_days_for_level(max_level)
            liver_level = diabetes_level = stroke_level = "low"

        next_review_dt = now_dt + timedelta(days=int(next_days))
        db.add(
            UserHealthSnapshot(
                user_id=user.id,
                snapshot_time=now_dt,
                payload_json=json.dumps(snapshot_payload, ensure_ascii=False),
                p_liver=p_liver,
                p_diabetes=p_diabetes,
                p_stroke=p_stroke,
                liver_level=str(liver_level),
                diabetes_level=str(diabetes_level),
                stroke_level=str(stroke_level),
                next_review_date=next_review_dt,
            )
        )
        db.commit()
        snaps = (
            db.scalars(
                select(UserHealthSnapshot)
                .where(UserHealthSnapshot.user_id == user.id)
                .order_by(UserHealthSnapshot.snapshot_time.desc())
            )
            .all()
        )

    today_d = date.today()
    out_snaps: list[dict[str, Any]] = []
    for s in snaps:
        due_d = s.next_review_date.date() if s.next_review_date else None
        remaining_days = (due_d - today_d).days if due_d is not None else None
        is_overdue = remaining_days is not None and remaining_days < 0
        pmax = max(float(s.p_liver or 0.0), float(s.p_diabetes or 0.0), float(s.p_stroke or 0.0))
        max_level = risk_level_from_prob(pmax)
        out_snaps.append(
            {
                "id": s.id,
                "snapshotAt": s.snapshot_time.isoformat(),
                "nextReviewDate": s.next_review_date.isoformat(),
                "remainingDays": remaining_days,
                "isOverdue": is_overdue,
                "maxRisk": {
                    "level": max_level,
                    "label": _health_risk_label(max_level),
                    "probability": pmax,
                },
                "probabilities": {
                    "liver": float(s.p_liver or 0.0),
                    "diabetes": float(s.p_diabetes or 0.0),
                    "stroke": float(s.p_stroke or 0.0),
                },
                "riskLevels": {
                    "liver": s.liver_level,
                    "diabetes": s.diabetes_level,
                    "stroke": s.stroke_level,
                },
            }
        )

    return {"snapshots": out_snaps}


@app.get("/api/user/me/health-history/{snapshot_id}")
def user_health_history_detail(
    snapshot_id: int,
    user: UserHealthInfo = Depends(get_current_user_health),
    db: Session = Depends(get_db),
):
    s = db.get(UserHealthSnapshot, snapshot_id)
    if s is None or s.user_id != user.id:
        raise HTTPException(status_code=404, detail="快照不存在")

    # 全部历史按时间升序：用于生成趋势
    snaps = (
        db.scalars(
            select(UserHealthSnapshot)
            .where(UserHealthSnapshot.user_id == user.id)
            .order_by(UserHealthSnapshot.snapshot_time.asc())
        )
        .all()
    )
    idx = next((i for i, x in enumerate(snaps) if x.id == s.id), None)
    if idx is None:
        raise HTTPException(status_code=404, detail="快照不存在")

    payload = json.loads(s.payload_json or "{}")
    indicators = (payload.get("indicators") or {}) if isinstance(payload, dict) else {}

    x_dates: list[str] = []
    series = {"fpg": [], "hba1c": [], "tg": [], "sbp": []}
    risk_series = {"liver": [], "diabetes": [], "stroke": []}

    for it in snaps:
        x_dates.append(it.snapshot_time.date().isoformat())
        spayload = {}
        try:
            spayload = json.loads(it.payload_json or "{}")
        except Exception:
            spayload = {}
        inds = (spayload.get("indicators") or {}) if isinstance(spayload, dict) else {}
        series["fpg"].append(_health_parse_float(inds.get("fpg")))
        series["hba1c"].append(_health_parse_float(inds.get("hba1c")))
        series["tg"].append(_health_parse_float(inds.get("tg")))
        series["sbp"].append(_health_parse_float(inds.get("sbp")))
        risk_series["liver"].append(float(it.p_liver or 0.0))
        risk_series["diabetes"].append(float(it.p_diabetes or 0.0))
        risk_series["stroke"].append(float(it.p_stroke or 0.0))

    pmax = max(float(s.p_liver or 0.0), float(s.p_diabetes or 0.0), float(s.p_stroke or 0.0))
    max_level = risk_level_from_prob(pmax)
    interval_days = next_review_days_for_level(max_level)
    remaining_days = (s.next_review_date.date() - date.today()).days

    # 简化但可解释：根据风险等级 + 关键血糖指标给出复评提醒建议
    suggestions: list[str] = []
    if max_level == "high":
        suggestions.append(f"当前整体风险为{_health_risk_label(max_level)}：建议尽快安排复评（约{interval_days}天）。")
    elif max_level == "medium":
        suggestions.append(f"当前整体风险为{_health_risk_label(max_level)}：建议在约{interval_days}天复评。")
    else:
        suggestions.append(f"当前整体风险为{_health_risk_label(max_level)}：建议常规随访（约{interval_days}天复评）。")

    # 针对血糖/血脂的补充提示（尽量不“瞎编”，只在指标存在时提示）
    fpg = _health_parse_float(indicators.get("fpg"))
    hba1c = _health_parse_float(indicators.get("hba1c"))
    tg = _health_parse_float(indicators.get("tg"))
    if fpg is not None:
        suggestions.append(f"复评前关注空腹血糖（fpg）：当前约{fpg:g}。")
    if hba1c is not None:
        suggestions.append(f"复评前关注糖化血红蛋白（hba1c）：当前约{hba1c:g}。")
    if tg is not None:
        suggestions.append(f"复评前关注甘油三酯（tg）：当前约{tg:g}。")

    return {
        "id": s.id,
        "snapshotAt": s.snapshot_time.isoformat(),
        "payload": payload,
        "probabilities": {
            "liver": float(s.p_liver or 0.0),
            "diabetes": float(s.p_diabetes or 0.0),
            "stroke": float(s.p_stroke or 0.0),
        },
        "riskLevels": {
            "liver": s.liver_level,
            "diabetes": s.diabetes_level,
            "stroke": s.stroke_level,
        },
        "followUpPlan": {
            "nextReviewDate": s.next_review_date.isoformat(),
            "remainingDays": remaining_days,
            "intervalDays": int(interval_days),
            "scheduleLevel": max_level,
            "scheduleLabel": _health_risk_label(max_level),
        },
        "indicatorTrend": {
            "x": x_dates,
            "series": series,
        },
        "riskTrend": risk_series,
        "reminderSuggestions": suggestions,
        "doctorAdvice": s.doctor_advice or "",
    }



@app.post("/api/portal/auth/register")
def portal_register(body: PortalRegisterBody, db: Session = Depends(get_db)):
    """用户写入 user_info（user_password 存 bcrypt 哈希）；医生写入 doctor_accounts（需执照号、姓名）。"""
    try:
        if body.role == "user":
            row = register_user(db, body.account, body.password)
            _invalidate_dashboard_server_cache()
            return {"ok": True, "userId": row.id}
        if body.role == "doctor":
            if not (body.license_code and body.license_code.strip()):
                raise HTTPException(status_code=400, detail="医生注册需填写医师执照号")
            if not (body.doctor_name and body.doctor_name.strip()):
                raise HTTPException(status_code=400, detail="医生注册需填写姓名")
            row = register_doctor(
                db,
                body.account,
                body.password,
                body.license_code.strip(),
                body.doctor_name.strip(),
            )
            return {"ok": True, "userId": row.id}
    except ValueError as e:
        detail = str(e)
        status = 409 if "已" in detail and ("注册" in detail or "使用" in detail) else 400
        raise HTTPException(status_code=status, detail=detail) from None
    raise HTTPException(status_code=400, detail="不支持的注册类型")


@app.post("/api/portal/auth/login")
def portal_login(body: PortalLoginBody, db: Session = Depends(get_db)):
    """按身份校验密码并签发 JWT。"""
    if body.role == "user":
        row = authenticate_user(db, body.account, body.password)
        if row is None:
            raise HTTPException(status_code=401, detail="账号或密码错误")
        _record_login_event(db, role="user", account=row.user_account, subject_id=row.id)
        subject = f"user:{row.id}"
        token = make_access_token(subject=subject, role="user", login_name=row.user_account)
        session = build_session_dict(role="user", account=row.user_account, user_id=row.id)
        return {"token": token, "session": session}

    if body.role == "doctor":
        row = authenticate_doctor(db, body.account, body.password)
        if row is None:
            raise HTTPException(status_code=401, detail="账号或密码错误")
        _record_login_event(db, role="doctor", account=row.login_name, subject_id=row.id)
        subject = f"doctor:{row.id}"
        token = make_access_token(subject=subject, role="doctor", login_name=row.login_name)
        session = build_session_dict(
            role="doctor",
            account=row.login_name,
            user_id=row.id,
            license_code=row.license_code,
        )
        return {"token": token, "session": session}

    if body.role == "admin":
        row = authenticate_admin(db, body.account, body.password)
        if row is None:
            raise HTTPException(status_code=401, detail="账号或密码错误")
        subject = f"admin:{row.id}"
        token = make_access_token(subject=subject, role="admin", login_name=row.account)
        session = build_session_dict(role="admin", account=row.account, user_id=row.id)
        return {"token": token, "session": session}

    raise HTTPException(status_code=400, detail="不支持的身份")


def _user_to_questionnaire_row(row: UserHealthInfo) -> dict[str, Any]:
    """将 user_info 行映射为医生端患者列表行（完整对齐问卷字段）。"""
    base = user_health_to_predict_dict(row)
    bundle = user_health_to_questionnaire_bundle(row)
    basic = bundle.get("basic", {})
    indicators = bundle.get("indicators", {})

    gender = base.get("gender") or "male"
    if gender not in ("male", "female"):
        gender = "male"

    def num(key: str, default: float = 0.0) -> float:
        v = base.get(key)
        try:
            return float(v)
        except (TypeError, ValueError):
            return float(default)

    def num_from(d: dict[str, Any], key: str, default: float = 0.0) -> float:
        v = d.get(key)
        try:
            return float(v)
        except (TypeError, ValueError):
            return float(default)

    def intval(key: str, default: int = 0) -> int:
        v = base.get(key)
        try:
            return int(round(float(v)))
        except (TypeError, ValueError):
            return int(default)

    def yn_flag(d: dict[str, Any], key: str) -> bool:
        return str(d.get(key) or "").strip().lower() == "yes"

    def flag(key: str) -> bool:
        return bool(base.get(key))

    drinking_level = base.get("drinkingLevel")
    try:
        dl = int(drinking_level)
    except (TypeError, ValueError):
        dl = 0
    if dl not in (0, 1, 2, 3):
        dl = 0

    updated = row.updated_at or row.created_at
    updated_str = updated.date().isoformat() if updated is not None else ""

    return {
        "id": str(row.id),
        "name": row.name or f"用户{row.id}",
        "patientNo": f"P{row.id:08d}",
        "updatedAt": updated_str,
        "age": int(base.get("age") or 0),
        "gender": gender,
        "heightCm": num("heightCm"),
        "weightKg": num("weightKg"),
        "waistCm": num("waistCm"),
        "hypertension": flag("hypertension"),
        "myocardialInfarction": yn_flag(basic, "myocardialInfarction"),
        "coronaryHeartDisease": yn_flag(basic, "coronaryHeartDisease"),
        "angina": yn_flag(basic, "angina"),
        "gestationalDiabetes": yn_flag(basic, "gestationalDiabetes"),
        "pcos": yn_flag(basic, "pcos"),
        "familyHistoryDiabetes": flag("familyHistoryDiabetes"),
        "prediabetes": flag("prediabetes"),
        "antihypertensiveDrugs": flag("antihypertensiveDrugs"),
        "hypoglycemicDrugs": flag("hypoglycemicDrugs"),
        "symptomPolyuria": yn_flag(basic, "symptomPolyuria"),
        "symptomWeightLoss": yn_flag(basic, "symptomWeightLoss"),
        "symptomThirst": yn_flag(basic, "symptomThirst"),
        "symptomBlurVision": yn_flag(basic, "symptomBlurVision"),
        "symptomSlowHealing": yn_flag(basic, "symptomSlowHealing"),
        "smoking": flag("smoking"),
        "vigorousExercise": flag("vigorousExercise"),
        "drinkingLevel": dl,
        "sedentaryMinutesPerDay": num("sedentaryMinutesPerDay"),
        "scaleAlcoholAmount": intval("scaleAlcoholAmount"),
        "scaleWeeklyActivity": intval("scaleWeeklyActivity"),
        "scaleDietQuality": intval("scaleDietQuality"),
        "scaleSleepQuality": intval("scaleSleepQuality"),
        "scaleHealthKnowledge": intval("scaleHealthKnowledge"),
        "scaleQualityOfLife": intval("scaleQualityOfLife"),
        "scaleFatigue": intval("scaleFatigue"),
        "sbp": intval("sbp"),
        "dbp": intval("dbp"),
        "fpg": num("fpg"),
        "hba1c": num("hba1c"),
        "tg": num("tg"),
        "tc": num("tc"),
        "hdl": num("hdl"),
        "ldl": num("ldl"),
        "alt": intval("alt"),
        "ast": intval("ast"),
        "ggt": intval("ggt"),
        "totalBilirubin": num_from(indicators, "totalBilirubin"),
        "albumin": num_from(indicators, "albumin"),
        "creatinine": num_from(indicators, "creatinine"),
        "bun": num_from(indicators, "bun"),
        "ldh": intval("ldh"),
        "chloride": num_from(indicators, "chloride"),
        "serumIron": num_from(indicators, "serumIron"),
        "hematocrit": num_from(indicators, "hematocrit"),
        "rbc": num_from(indicators, "rbc"),
        "rdw": num_from(indicators, "rdw"),
        "hemoglobin": num_from(indicators, "hemoglobin"),
        "lymphocytePct": num_from(indicators, "lymphocytePct"),
        "uricAcid": num("uricAcid"),
        "imagingLiver": 0,
        "imagingDiabetes": 0,
        "imagingStroke": 0,
    }


@app.get("/api/doctor/patients/questionnaires")
def list_questionnaire_patients(db: Session = Depends(get_db)):
    rows = db.scalars(select(UserHealthInfo).order_by(UserHealthInfo.id.desc())).all()
    return [_user_to_questionnaire_row(r) for r in rows]


@app.get("/api/doctor/followup/metrics")
def doctor_followup_metrics(
    graceDays: int = 30,
    db: Session = Depends(get_db),
):
    """
    医生端随访指标（失访率/复评率）：
    - 只统计已经“过了下一次复评日期 + graceDays”的 due 事件，避免把未到期样本算成失访。
    - revisited：下一次快照时间 <= dueDate + graceDays
    - onTime：下一次快照时间 <= dueDate
    """

    snaps = (
        db.scalars(select(UserHealthSnapshot).order_by(UserHealthSnapshot.user_id.asc(), UserHealthSnapshot.snapshot_time.asc()))
        .all()
    )

    now_dt = datetime.now(timezone.utc)
    grace = timedelta(days=max(0, int(graceDays)))

    # 按患者 user_id 聚类
    by_user: dict[int, list[UserHealthSnapshot]] = {}
    for s in snaps:
        by_user.setdefault(int(s.user_id), []).append(s)

    total_due = 0
    revisited = 0
    on_time = 0
    late = 0

    for _, user_snaps in by_user.items():
        if len(user_snaps) == 0:
            continue
        for i in range(len(user_snaps) - 1):
            cur = user_snaps[i]
            due_dt = cur.next_review_date
            if due_dt is None:
                continue
            window_end = due_dt + grace
            if now_dt <= window_end:
                # 未进入统计窗口：不计入失访率
                continue

            nxt = user_snaps[i + 1]
            total_due += 1
            if nxt.snapshot_time <= window_end:
                revisited += 1
                if nxt.snapshot_time <= due_dt:
                    on_time += 1
                else:
                    late += 1
            # 否则：lost（下一次快照缺失或太晚）

    lost = max(0, total_due - revisited)
    follow_up_rate = (revisited / total_due) if total_due > 0 else 0.0
    loss_rate = (lost / total_due) if total_due > 0 else 0.0

    return {
        "meta": {
            "now": now_dt.isoformat(),
            "graceDays": int(graceDays),
            "totalDueEvents": total_due,
        },
        "rates": {
            "followUpRate": follow_up_rate,
            "lossRate": loss_rate,
            "revisited": revisited,
            "lost": lost,
            "onTime": on_time,
            "late": late,
        },
        # 便于前端做可视化（饼图/环图）
        "distribution": {
            "onTime": on_time,
            "late": late,
            "lost": lost,
        },
    }


@app.get("/api/doctor/patients/{patient_id}/health-history")
def doctor_patient_health_history_list(
    patient_id: int,
    db: Session = Depends(get_db),
):
    patient = db.get(UserHealthInfo, patient_id)
    if patient is None:
        raise HTTPException(status_code=404, detail="患者不存在")

    snaps = (
        db.scalars(
            select(UserHealthSnapshot)
            .where(UserHealthSnapshot.user_id == patient_id)
            .order_by(UserHealthSnapshot.snapshot_time.desc())
        )
        .all()
    )

    # 旧数据回填
    if not snaps:
        now_dt = datetime.now(timezone.utc)
        snapshot_payload = user_health_to_questionnaire_bundle(patient)
        try:
            pred = predict_triple(user_health_to_predict_dict(patient))
            probs = pred.get("probabilities") or {}
            p_liver = float(probs.get("liver") or 0.0)
            p_diabetes = float(probs.get("diabetes") or 0.0)
            p_stroke = float(probs.get("stroke") or 0.0)
            pmax = max(p_liver, p_diabetes, p_stroke)
            max_level = risk_level_from_prob(pmax)
            next_days = next_review_days_for_level(max_level)

            risks = pred.get("risk") or {}
            liver_level = (risks.get("liver") or {}).get("level") or risk_level_from_prob(p_liver)
            diabetes_level = (risks.get("diabetes") or {}).get("level") or risk_level_from_prob(p_diabetes)
            stroke_level = (risks.get("stroke") or {}).get("level") or risk_level_from_prob(p_stroke)
        except Exception as e:
            print(f"[doctor_history_backfill] failed patient_id={patient_id} err={e}", flush=True)
            p_liver = p_diabetes = p_stroke = 0.0
            max_level = "low"
            next_days = next_review_days_for_level(max_level)
            liver_level = diabetes_level = stroke_level = "low"

        next_review_dt = now_dt + timedelta(days=int(next_days))
        db.add(
            UserHealthSnapshot(
                user_id=patient.id,
                snapshot_time=now_dt,
                payload_json=json.dumps(snapshot_payload, ensure_ascii=False),
                p_liver=p_liver,
                p_diabetes=p_diabetes,
                p_stroke=p_stroke,
                liver_level=str(liver_level),
                diabetes_level=str(diabetes_level),
                stroke_level=str(stroke_level),
                next_review_date=next_review_dt,
            )
        )
        db.commit()
        snaps = (
            db.scalars(
                select(UserHealthSnapshot)
                .where(UserHealthSnapshot.user_id == patient_id)
                .order_by(UserHealthSnapshot.snapshot_time.desc())
            )
            .all()
        )

    today_d = date.today()
    out: list[dict[str, Any]] = []
    for s in snaps:
        due_d = s.next_review_date.date() if s.next_review_date else None
        remaining_days = (due_d - today_d).days if due_d is not None else None
        is_overdue = remaining_days is not None and remaining_days < 0
        pmax = max(float(s.p_liver or 0.0), float(s.p_diabetes or 0.0), float(s.p_stroke or 0.0))
        max_level = risk_level_from_prob(pmax)
        out.append(
            {
                "id": s.id,
                "snapshotAt": s.snapshot_time.isoformat(),
                "nextReviewDate": s.next_review_date.isoformat(),
                "remainingDays": remaining_days,
                "isOverdue": is_overdue,
                "maxRisk": {
                    "level": max_level,
                    "label": _health_risk_label(max_level),
                    "probability": pmax,
                },
                "probabilities": {
                    "liver": float(s.p_liver or 0.0),
                    "diabetes": float(s.p_diabetes or 0.0),
                    "stroke": float(s.p_stroke or 0.0),
                },
                "riskLevels": {
                    "liver": s.liver_level,
                    "diabetes": s.diabetes_level,
                    "stroke": s.stroke_level,
                },
            }
        )

    return {"patientId": patient_id, "snapshots": out}


@app.get("/api/doctor/patients/{patient_id}/health-history/{snapshot_id}")
def doctor_patient_health_history_detail(
    patient_id: int,
    snapshot_id: int,
    db: Session = Depends(get_db),
):
    s = db.get(UserHealthSnapshot, snapshot_id)
    if s is None or int(s.user_id) != int(patient_id):
        raise HTTPException(status_code=404, detail="快照不存在")

    patient_snaps = (
        db.scalars(
            select(UserHealthSnapshot)
            .where(UserHealthSnapshot.user_id == patient_id)
            .order_by(UserHealthSnapshot.snapshot_time.asc())
        )
        .all()
    )
    payload = json.loads(s.payload_json or "{}")
    indicators = (payload.get("indicators") or {}) if isinstance(payload, dict) else {}

    x_dates: list[str] = []
    series = {"fpg": [], "hba1c": [], "tg": [], "sbp": []}
    risk_series = {"liver": [], "diabetes": [], "stroke": []}

    for it in patient_snaps:
        x_dates.append(it.snapshot_time.date().isoformat())
        spayload = {}
        try:
            spayload = json.loads(it.payload_json or "{}")
        except Exception:
            spayload = {}
        inds = (spayload.get("indicators") or {}) if isinstance(spayload, dict) else {}
        series["fpg"].append(_health_parse_float(inds.get("fpg")))
        series["hba1c"].append(_health_parse_float(inds.get("hba1c")))
        series["tg"].append(_health_parse_float(inds.get("tg")))
        series["sbp"].append(_health_parse_float(inds.get("sbp")))
        risk_series["liver"].append(float(it.p_liver or 0.0))
        risk_series["diabetes"].append(float(it.p_diabetes or 0.0))
        risk_series["stroke"].append(float(it.p_stroke or 0.0))

    pmax = max(float(s.p_liver or 0.0), float(s.p_diabetes or 0.0), float(s.p_stroke or 0.0))
    max_level = risk_level_from_prob(pmax)
    interval_days = next_review_days_for_level(max_level)
    remaining_days = (s.next_review_date.date() - date.today()).days

    suggestions: list[str] = []
    if max_level == "high":
        suggestions.append(f"当前整体风险为{_health_risk_label(max_level)}：建议尽快安排复评（约{interval_days}天）。")
    elif max_level == "medium":
        suggestions.append(f"当前整体风险为{_health_risk_label(max_level)}：建议在约{interval_days}天复评。")
    else:
        suggestions.append(f"当前整体风险为{_health_risk_label(max_level)}：建议常规随访（约{interval_days}天复评）。")

    fpg = _health_parse_float(indicators.get("fpg"))
    hba1c = _health_parse_float(indicators.get("hba1c"))
    tg = _health_parse_float(indicators.get("tg"))
    if fpg is not None:
        suggestions.append(f"复评前关注空腹血糖（fpg）：当前约{fpg:g}。")
    if hba1c is not None:
        suggestions.append(f"复评前关注糖化血红蛋白（hba1c）：当前约{hba1c:g}。")
    if tg is not None:
        suggestions.append(f"复评前关注甘油三酯（tg）：当前约{tg:g}。")

    return {
        "id": s.id,
        "snapshotAt": s.snapshot_time.isoformat(),
        "payload": payload,
        "probabilities": {
            "liver": float(s.p_liver or 0.0),
            "diabetes": float(s.p_diabetes or 0.0),
            "stroke": float(s.p_stroke or 0.0),
        },
        "riskLevels": {
            "liver": s.liver_level,
            "diabetes": s.diabetes_level,
            "stroke": s.stroke_level,
        },
        "followUpPlan": {
            "nextReviewDate": s.next_review_date.isoformat(),
            "remainingDays": remaining_days,
            "intervalDays": int(interval_days),
            "scheduleLevel": max_level,
            "scheduleLabel": _health_risk_label(max_level),
        },
        "indicatorTrend": {
            "x": x_dates,
            "series": series,
        },
        "riskTrend": risk_series,
        "reminderSuggestions": suggestions,
        "doctorAdvice": s.doctor_advice or "",
    }


@app.put("/api/doctor/patients/{patient_id}/health-history/{snapshot_id}/advice")
def doctor_patient_health_history_update_advice(
    patient_id: int,
    snapshot_id: int,
    body: DoctorSnapshotAdviceBody,
    doctor: DoctorAccount = Depends(get_current_doctor_account),
    db: Session = Depends(get_db),
):
    _ = doctor
    s = db.get(UserHealthSnapshot, snapshot_id)
    if s is None or int(s.user_id) != int(patient_id):
        raise HTTPException(status_code=404, detail="快照不存在")

    advice = (body.doctorAdvice or "").strip()
    s.doctor_advice = advice or None
    db.add(s)
    db.commit()
    db.refresh(s)
    return {"ok": True, "doctorAdvice": s.doctor_advice or ""}


# 默认全量看板响应短时缓存，减轻 React 严格模式双请求、重复进入页面的压力（最多滞后若干秒）
_DASHBOARD_SRV_CACHE_UNTIL_MONO: float = 0.0
_DASHBOARD_SRV_CACHE_BODY: dict[str, Any] | None = None
DASHBOARD_SRV_CACHE_SEC = 12.0


def _invalidate_dashboard_server_cache() -> None:
    global _DASHBOARD_SRV_CACHE_UNTIL_MONO, _DASHBOARD_SRV_CACHE_BODY
    _DASHBOARD_SRV_CACHE_BODY = None
    _DASHBOARD_SRV_CACHE_UNTIL_MONO = 0.0


@app.get("/api/doctor/disease-analysis/dashboard")
def disease_analysis_dashboard(
    cohortSize: int = 0,
    refresh: int = 0,
    db: Session = Depends(get_db),
):
    global _DASHBOARD_SRV_CACHE_UNTIL_MONO, _DASHBOARD_SRV_CACHE_BODY
    now_m = time.monotonic()
    if (
        cohortSize == 0
        and refresh == 0
        and _DASHBOARD_SRV_CACHE_BODY is not None
        and now_m < _DASHBOARD_SRV_CACHE_UNTIL_MONO
    ):
        return _DASHBOARD_SRV_CACHE_BODY

    total_registered = int(db.scalar(select(func.count()).select_from(UserHealthInfo)) or 0)
    if total_registered == 0:
        cohort_rows: list[dict[str, Any]] = []
    elif cohortSize > 0:
        take = min(cohortSize, total_registered)
        users = db.scalars(select(UserHealthInfo).order_by(UserHealthInfo.id.desc()).limit(take)).all()
        cohort_rows = [user_health_to_predict_dict(u) for u in users]
    else:
        # 默认统计全部 user_info，保证 overallRiskDist 三档之和与总患者数一致
        users = db.scalars(select(UserHealthInfo).order_by(UserHealthInfo.id.desc())).all()
        cohort_rows = [user_health_to_predict_dict(u) for u in users]
    analyzed = len(cohort_rows)
    out = build_cohort_analysis(cohort_rows)
    out["meta"] = {
        "totalRegisteredPatients": total_registered,
        "analyzedPatients": analyzed,
        "cohortSizeRequested": cohortSize,
    }
    if cohortSize == 0 and refresh == 0:
        _DASHBOARD_SRV_CACHE_BODY = out
        _DASHBOARD_SRV_CACHE_UNTIL_MONO = now_m + DASHBOARD_SRV_CACHE_SEC
    return out


def _default_profile() -> dict[str, Any]:
    if _PATIENTS:
        return copy.deepcopy(_PATIENTS[0])
    raise HTTPException(status_code=503, detail="服务端未配置默认问卷数据")


def _stroke_image_status_for_risk_predict(base: dict[str, Any]) -> dict[str, Any]:
    """说明为何脑卒中仍为 heuristic：画像是否含路径、文件是否可读（与 predict_triple 入参一致）。"""
    import importlib
    import sys

    raw = (base.get("stroke_image_path") or base.get("strokeImagePath") or "").strip()
    if not raw:
        return {
            "pathPresent": False,
            "fileReadable": False,
            "hint": "当前请求使用的画像里没有任何卒中影像路径；请用本账号上传脑卒中影像并保存后再打开风险评估。",
        }
    try:
        pr = Path(raw)
        if pr.is_file():
            return {"pathPresent": True, "fileReadable": True, "hint": ""}
    except OSError:
        pass
    stroke_root = Path(__file__).resolve().parents[3] / "stroke"
    sr = str(stroke_root)
    if sr not in sys.path:
        sys.path.insert(0, sr)
    try:
        mfp = importlib.import_module("multimodal_fusion_predict")
        res_fn = getattr(mfp, "resolve_stroke_image_disk_path", None)
        if callable(res_fn):
            p = res_fn(raw)
            if p is not None and p.is_file():
                return {"pathPresent": True, "fileReadable": True, "hint": ""}
    except Exception:
        pass
    return {
        "pathPresent": True,
        "fileReadable": False,
        "hint": "数据库里有路径，但本机进程读不到该文件（常见：换电脑路径失效、文件被删、后端工作目录不一致）。请重新上传卒中影像。",
    }


@app.post("/api/risk/predict")
def risk_predict(
    body: dict[str, Any] | None = Body(default=None),
    user: UserHealthInfo | None = Depends(get_optional_user_health),
):
    # 已登录用户：以数据库 user_info 为底稿；未带令牌时沿用演示用 patients.json[0]
    if user is not None:
        base = user_health_to_predict_dict(user)
    else:
        base = _default_profile()
    if body:
        for k, v in body.items():
            base[k] = v
    raw = predict_triple(base)
    scores = raw["scores"]
    ps = [scores["liver"], scores["diabetes"], scores["stroke"]]
    composite = int(round(sum(ps) / 3)) if ps else 0

    def pack(did: str, short_name: str, full_name: str) -> dict[str, Any]:
        r = raw["risk"][did]
        src = raw["source"]
        return {
            "id": did,
            "shortName": short_name,
            "fullName": full_name,
            "probability": raw["probabilities"][did],
            "score": scores[did],
            "risk": r["level"],
            "riskLabel": r["label"],
            "topFactors": raw["factors"][did],
            # 与顶层 source.{liver|diabetes|stroke} 一致，便于在 diseases 条目上直接看到模型来源
            "sourceTag": src.get(did),
        }

    return {
        "propagationScores": raw.get("propagationScores", [0, 0, 0]),
        "compositeIndex": composite,
        "diseases": [
            pack("liver", "MAFLD", "肝病"),
            pack("diabetes", "T2DM", "糖尿病"),
            pack("stroke", "CVA", "脑卒中"),
        ],
        "source": raw["source"],
        "strokeImageStatus": _stroke_image_status_for_risk_predict(base),
    }


@app.get("/health")
def health():
    db_ok = check_db_connection()
    return {"status": "ok" if db_ok else "degraded", "database": "reachable" if db_ok else "unreachable"}
