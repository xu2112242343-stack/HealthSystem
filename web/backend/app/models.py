"""业务表结构（以代码为单一来源）。

启动时 ``init_db()`` → ``create_all()``：表不存在则创建，已存在则跳过，不会删表、不会改已有表结构。

后续若要给「已有表」增加字段，请二选一：
- 开发环境：可临时删表后重启（会丢数据）；
- 推荐：使用 Alembic 做版本化迁移（改模型后 ``alembic revision --autogenerate``）。
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, DECIMAL, ForeignKey, Integer, LargeBinary, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.persistence import Base


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)

class AdminAccount(Base):
    """系统管理员账户"""

    __tablename__ = "admin_accounts"

    # 主键自增ID
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # 你要求的核心字段
    account: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True, comment="账号")
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False, comment="密码")
    username: Mapped[str] = mapped_column(String(128), nullable=False, comment="用户名")

class DoctorAccount(Base):
    """医生账户：主键 id；login_key 登录唯一；license_code 医师执照号唯一。"""

    __tablename__ = "doctor_accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    login_name: Mapped[str] = mapped_column(String(128), nullable=False)
    login_key: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    license_code: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
        unique=True,
        index=True,
        comment="医师执照号",
    )

    name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    specialty: Mapped[str | None] = mapped_column(String(128), nullable=True)
    title: Mapped[str | None] = mapped_column(String(64), nullable=True)
    hospital: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    certification_status: Mapped[str | None] = mapped_column(String(64), nullable=True, comment="认证状态等")
    years_of_experience: Mapped[str | None] = mapped_column(String(32), nullable=True)
    education: Mapped[str | None] = mapped_column(String(128), nullable=True)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, nullable=False)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, onupdate=_utc_now)


class UserHealthInfo(Base):
    """用户健康信息表"""
    __tablename__ = "user_info"

    # 主键 ID
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    
    # 登录信息
    user_account: Mapped[str] = mapped_column(String(50), nullable=False, comment="用户账号")
    user_password: Mapped[str] = mapped_column(String(255), nullable=False, comment="用户密码")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, comment="账户是否可登录")
    name: Mapped[str | None] = mapped_column(String(20), nullable=True, comment="姓名")
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True, comment="联系电话")
    email: Mapped[str | None] = mapped_column(String(255), nullable=True, comment="邮箱")

    # 基础信息
    age: Mapped[int | None] = mapped_column(Integer, nullable=True, comment="您的年龄")
    gender: Mapped[str | None] = mapped_column(String(10), nullable=True, comment="您的性别")
    
    # 身体指标
    height: Mapped[float | None] = mapped_column(DECIMAL(5,2), nullable=True, comment="身高")
    weight: Mapped[float | None] = mapped_column(DECIMAL(5,2), nullable=True, comment="体重")
    waistline: Mapped[float | None] = mapped_column(DECIMAL(5,2), nullable=True, comment="腰围")
    
    # 疾病史
    has_hypertension: Mapped[str | None] = mapped_column(String(10), nullable=True, comment="是否患有高血压")
    has_myocardial_infarction: Mapped[str | None] = mapped_column(String(10), nullable=True, comment="是否患有心肌梗死")
    has_coronary_heart_disease: Mapped[str | None] = mapped_column(String(10), nullable=True, comment="是否患有冠心病")
    has_angina: Mapped[str | None] = mapped_column(String(10), nullable=True, comment="是否患有心绞痛")
    has_gestational_diabetes: Mapped[str | None] = mapped_column(String(10), nullable=True, comment="是否有妊娠糖尿病病史")
    has_pcos: Mapped[str | None] = mapped_column(String(10), nullable=True, comment="是否患有多囊卵巢综合症")
    family_diabetes: Mapped[str | None] = mapped_column(String(10), nullable=True, comment="家族中是否有糖尿病患者")
    pre_diabetes: Mapped[str | None] = mapped_column(String(10), nullable=True, comment="是否处于糖尿病前期")
    
    # 用药情况
    use_antihypertensive: Mapped[str | None] = mapped_column(String(10), nullable=True, comment="目前是否在使用降压药物")
    use_hypoglycemic: Mapped[str | None] = mapped_column(String(10), nullable=True, comment="目前是否在使用降糖药物")
    
    # 症状
    frequent_urination: Mapped[str | None] = mapped_column(String(10), nullable=True, comment="是否经常出现尿频的情况")
    unexplained_weight_loss: Mapped[str | None] = mapped_column(String(10), nullable=True, comment="是否有不明原因的体重减轻")
    excessive_thirst: Mapped[str | None] = mapped_column(String(10), nullable=True, comment="是否经常感到过度口渴")
    blurred_vision: Mapped[str | None] = mapped_column(String(10), nullable=True, comment="是否偶尔出现视力模糊")
    slow_wound_healing: Mapped[str | None] = mapped_column(String(10), nullable=True, comment="是否存在伤口愈合缓慢")
    
    # 生活习惯
    smoking: Mapped[str | None] = mapped_column(String(10), nullable=True, comment="是否吸烟")
    moderate_high_intensity_exercise: Mapped[str | None] = mapped_column(String(10), nullable=True, comment="是否进行每次不少于10分钟的中高强度运动")
    drinking_frequency: Mapped[str | None] = mapped_column(String(20), nullable=True, comment="饮酒频率")
    drinking_score: Mapped[int | None] = mapped_column(Integer, nullable=True, comment="饮酒量主观评分")
    weekly_exercise_time: Mapped[str | None] = mapped_column(String(30), nullable=True, comment="每周体育活动时间自评")
    diet_quality: Mapped[int | None] = mapped_column(Integer, nullable=True, comment="膳食质量")
    sleep_quality: Mapped[int | None] = mapped_column(Integer, nullable=True, comment="睡眠质量")
    health_knowledge: Mapped[int | None] = mapped_column(Integer, nullable=True, comment="健康知识掌握")
    life_quality: Mapped[int | None] = mapped_column(Integer, nullable=True, comment="生活质量")
    fatigue_level: Mapped[int | None] = mapped_column(Integer, nullable=True, comment="疲劳程度")
    sedentary_time_daily: Mapped[float | None] = mapped_column(DECIMAL(4,1), nullable=True, comment="典型一天久坐时间")
    
    # 体检指标
    systolic_bp: Mapped[int | None] = mapped_column(Integer, nullable=True, comment="收缩压")
    diastolic_bp: Mapped[int | None] = mapped_column(Integer, nullable=True, comment="舒张压")
    # FPG（mg/dL）可能>99（例如 110、180、380），需至少 DECIMAL(5,2)
    fasting_blood_glucose: Mapped[float | None] = mapped_column(DECIMAL(5,2), nullable=True, comment="空腹血糖")
    hba1c: Mapped[float | None] = mapped_column(DECIMAL(3,1), nullable=True, comment="糖化血红蛋白")
    triglyceride: Mapped[float | None] = mapped_column(DECIMAL(5,2), nullable=True, comment="甘油三酯")
    total_cholesterol: Mapped[float | None] = mapped_column(DECIMAL(5,2), nullable=True, comment="总胆固醇")
    hdl_c: Mapped[float | None] = mapped_column(DECIMAL(4,2), nullable=True, comment="高密度脂蛋白胆固醇")
    ldl_c: Mapped[float | None] = mapped_column(DECIMAL(5,2), nullable=True, comment="低密度脂蛋白胆固醇")
    alt: Mapped[float | None] = mapped_column(Integer, nullable=True, comment="丙氨酸氨基转移酶")
    ast: Mapped[float | None] = mapped_column(Integer, nullable=True, comment="天门冬氨酸氨基转移酶")
    ggt: Mapped[float | None] = mapped_column(Integer, nullable=True, comment="γ-谷氨酰转移酶")
    total_bilirubin: Mapped[float | None] = mapped_column(DECIMAL(4,2), nullable=True, comment="总胆红素")
    albumin: Mapped[float | None] = mapped_column(DECIMAL(4,1), nullable=True, comment="白蛋白")
    serum_creatinine: Mapped[float | None] = mapped_column(DECIMAL(5,1), nullable=True, comment="血清肌酐")
    urea_nitrogen: Mapped[float | None] = mapped_column(DECIMAL(4,1), nullable=True, comment="血尿素氮")
    ldoh: Mapped[float | None] = mapped_column(Integer, nullable=True, comment="乳酸脱氢酶")
    chlorine: Mapped[float | None] = mapped_column(DECIMAL(4,1), nullable=True, comment="氯离子")
    serum_iron: Mapped[float | None] = mapped_column(DECIMAL(4,1), nullable=True, comment="血清铁")
    hematocrit: Mapped[float | None] = mapped_column(DECIMAL(4,2), nullable=True, comment="红细胞压积")
    rbc: Mapped[float | None] = mapped_column(DECIMAL(4,2), nullable=True, comment="红细胞计数")
    rdw: Mapped[float | None] = mapped_column(DECIMAL(4,2), nullable=True, comment="红细胞分布宽度")
    hemoglobin: Mapped[float | None] = mapped_column(DECIMAL(4,1), nullable=True, comment="血红蛋白")
    lymphocyte_percent: Mapped[float | None] = mapped_column(DECIMAL(4,1), nullable=True, comment="淋巴细胞百分比")
    uric_acid: Mapped[float | None] = mapped_column(DECIMAL(5,1), nullable=True, comment="尿酸")
    map: Mapped[float | None] = mapped_column(DECIMAL(5,1), nullable=True, comment="MAP")
    bmi: Mapped[float | None] = mapped_column(DECIMAL(4,2), nullable=True, comment="BMI")
    tyg: Mapped[float | None] = mapped_column(DECIMAL(4,2), nullable=True, comment="TyG")
    alt_ast_ratio: Mapped[float | None] = mapped_column(DECIMAL(5,2), nullable=True, comment="ALT/AST")
    tc_hdl_ratio: Mapped[float | None] = mapped_column(DECIMAL(5,2), nullable=True, comment="TC/HDL")
    bri: Mapped[float | None] = mapped_column(DECIMAL(4,2), nullable=True, comment="BRI")

    # 影像路径（存磁盘绝对路径；若将来需要多图/多模态，建议迁移为独立表）
    liver_image_path: Mapped[str | None] = mapped_column(Text, nullable=True, comment="肝病影像路径（绝对路径）")
    diabetes_image_path: Mapped[str | None] = mapped_column(Text, nullable=True, comment="糖尿病影像路径（绝对路径）")
    stroke_image_path: Mapped[str | None] = mapped_column(Text, nullable=True, comment="卒中影像路径（绝对路径）")

    # 公共字段（和你示例保持一致）
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, nullable=False)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, onupdate=_utc_now)


class UserHealthSnapshot(Base):
    """用户健康快照：用于展示随访历史（每次提交问卷后新增一条）。"""

    __tablename__ = "user_health_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("user_info.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="对应 user_info.id",
    )

    # 快照生成时间（一般等同于提交问卷/保存时刻）
    snapshot_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, nullable=False, index=True)

    # 前端 DataCollection 的 basic / lifestyle / indicators / derived 结构（字符串/可空值在服务端直接序列化保存）
    payload_json: Mapped[str] = mapped_column(Text, nullable=False)

    # 三病概率与风险分层（供医生/用户做趋势与随访计划）
    p_liver: Mapped[float] = mapped_column(DECIMAL(6, 5), nullable=False, comment="肝病概率 p_liver")
    p_diabetes: Mapped[float] = mapped_column(DECIMAL(6, 5), nullable=False, comment="糖尿病概率 p_diabetes")
    p_stroke: Mapped[float] = mapped_column(DECIMAL(6, 5), nullable=False, comment="卒中概率 p_stroke")

    # low / medium / high
    liver_level: Mapped[str] = mapped_column(String(10), nullable=False)
    diabetes_level: Mapped[str] = mapped_column(String(10), nullable=False)
    stroke_level: Mapped[str] = mapped_column(String(10), nullable=False)

    # 根据当前 max 风险给出的下一次复评计划
    next_review_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    doctor_advice: Mapped[str | None] = mapped_column(Text, nullable=True, comment="医生建议")


class HealthArticle(Base):
    """健康生活指南文章。"""

    __tablename__ = "health_articles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False, comment="Excel 文章ID")
    title: Mapped[str] = mapped_column(String(255), nullable=False, comment="文章标题")
    summary: Mapped[str] = mapped_column(Text, nullable=False, comment="摘要")
    content: Mapped[str] = mapped_column(Text, nullable=False, comment="正文")
    disease: Mapped[str] = mapped_column(Text, nullable=False, comment="疾病标签（逗号分隔）")
    type: Mapped[str] = mapped_column(String(64), nullable=False, comment="类型")
    tags: Mapped[str | None] = mapped_column(Text, nullable=True, comment="标签（逗号分隔）")
    risk_level: Mapped[str | None] = mapped_column(Text, nullable=True, comment="风险等级（逗号分隔）")
    source: Mapped[str | None] = mapped_column(Text, nullable=True, comment="文章来源")
    show_in_health_guide: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
        comment="是否在用户端「健康生活指南」中展示（否仅参与统计/后台管理）",
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, nullable=False)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, onupdate=_utc_now)

    images: Mapped[list["HealthArticleImage"]] = relationship(
        back_populates="article",
        cascade="all, delete-orphan",
    )


class HealthArticleImage(Base):
    """文章配图（存磁盘路径，数据库保存元数据）。"""

    __tablename__ = "health_article_images"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    article_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("health_articles.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="关联 health_articles.id",
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False, comment="原文件名")
    mime_type: Mapped[str] = mapped_column(String(64), nullable=False, comment="MIME 类型")
    image_path: Mapped[str | None] = mapped_column(Text, nullable=True, comment="图片绝对路径")
    image_data: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True, comment="兼容旧结构，已弃用")
    image_desc: Mapped[str | None] = mapped_column(Text, nullable=True, comment="图片说明")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=1, comment="同文内排序")

    article: Mapped[HealthArticle] = relationship(back_populates="images")


class Hospital(Base):
    """就医推荐医院信息（管理员维护，用户端只读）。"""

    __tablename__ = "hospitals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    name: Mapped[str] = mapped_column(String(255), nullable=False, comment="医院名称")
    level: Mapped[str | None] = mapped_column(String(64), nullable=True, comment="医院等级，如 三甲")
    address: Mapped[str] = mapped_column(Text, nullable=False, comment="医院地址")
    phone: Mapped[str] = mapped_column(String(64), nullable=False, comment="联系电话")

    latitude: Mapped[float | None] = mapped_column(DECIMAL(10, 6), nullable=True, comment="纬度")
    longitude: Mapped[float | None] = mapped_column(DECIMAL(10, 6), nullable=True, comment="经度")

    department: Mapped[str | None] = mapped_column(String(128), nullable=True, comment="推荐科室（展示用）")
    departments: Mapped[str | None] = mapped_column(Text, nullable=True, comment="科室列表（逗号分隔）")
    specialties: Mapped[str | None] = mapped_column(Text, nullable=True, comment="特色专科（逗号分隔）")
    working_hours: Mapped[str | None] = mapped_column(String(128), nullable=True, comment="营业时间")

    rating: Mapped[float | None] = mapped_column(DECIMAL(3, 1), nullable=True, comment="评分（展示用）")
    experts: Mapped[int | None] = mapped_column(Integer, nullable=True, comment="专家数（展示用）")

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, comment="是否对用户端展示")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utc_now, nullable=False)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, onupdate=_utc_now)


class LoginEvent(Base):
    """登录事件：用于管理员工作台活跃度统计。"""

    __tablename__ = "login_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    role: Mapped[str] = mapped_column(String(16), nullable=False, index=True, comment="user/doctor/admin")
    account: Mapped[str] = mapped_column(String(128), nullable=False, comment="登录账号")
    subject_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True, comment="对应用户/医生ID")
    login_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=_utc_now,
        nullable=False,
        index=True,
        comment="登录时间",
    )