# 技术综述（HealthSystem）

> 本文根据当前仓库代码与已实现功能整理，用于快速理解整体架构、关键模块与数据流。

---

## 架构概览

本项目是一个“健康管理平台”原型，包含：

- **用户端**：健康数据采集、风险评估、干预方案（健康生活指南）、就医推荐（定位 + 距离排序）
- **管理端**：医生/用户管理与部分数据看板（当前以页面与占位数据为主）
- **后端服务**：FastAPI + SQLAlchemy + MySQL，提供认证、问卷落库、风险评估、指南推荐与图片/医院数据接口
- **内容导入**：Excel → 健康指南文章与配图元数据导入脚本

---

## 技术栈与目录

### 后端

- **框架**：FastAPI（入口 `web/backend/app/main.py`）
- **ORM**：SQLAlchemy（`web/backend/app/models.py`）
- **数据库**：MySQL（连接与初始化 `web/backend/app/persistence.py`）
- **风险引擎**：`web/backend/app/risk_engine.py`
- **问卷落库/字段映射**：`web/backend/app/questionnaire_save.py`
- **内容推荐规则**：`web/backend/app/guide_recommend.py`
- **静态数据文件**：`web/backend/app/data/`（例如 `patients.json`、`hospitals.json`）

### 前端

- **用户端**：React + TypeScript + Tailwind（`web/sanyuan-user/src/`）
- **管理端**：React + TypeScript（`web/administrator/src/`）
- **API 封装**：用户端通过 `web/sanyuan-user/src/lib/api/index.ts` re-export `@shared/api` 的请求方法

---

## 认证与缓存安全

- 平台包含 **user / doctor / admin** 多角色登录。
- 针对 `/api/*`，后端增加了禁止缓存的中间件，避免浏览器/代理错误缓存导致串用户响应（`Cache-Control: no-store` 等）。

---

## 数据模型（核心表）

### `user_info`（用户健康档案）

集中存储用户的：

- 基础信息（年龄、性别、身高体重腰围等）
- 病史与用药、症状
- 生活方式（吸烟、运动、饮酒、久坐、睡眠等）
- 体检/检验指标（血压、血糖、血脂、肝酶等）
- 衍生指标（BMI、TyG、ALT/AST、TC/HDL 等）

对应模型：`web/backend/app/models.py` → `UserHealthInfo`

### 健康生活指南内容库

- `health_articles`：文章主体（`title/summary/content/disease/type/tags/risk_level/source`）
- `health_article_images`：文章配图元数据（`filename/mime_type/image_path/desc/sort_order`）

对应模型：`web/backend/app/models.py` → `HealthArticle` / `HealthArticleImage`

#### 图片存储策略

当前采用 **“磁盘存图，数据库存路径”**：

- `health_article_images.image_path` 保存图片绝对路径
- `GET /api/user/intervention/images/{image_id}` 使用 `FileResponse` 读取 `image_path` 并返回

这样可以避免 BLOB 体积过大与数据库迁移风险。

---

## 问卷 → 落库 → 风险评估

### 1) 问卷落库

接口：

- `PUT/POST /api/user/me/questionnaire`

实现：

- `web/backend/app/questionnaire_save.py`：将前端 `basic/lifestyle/indicators/derived` 写入 `user_info`
- 内置数据清洗与类型转换（int/float/decimal/是-否）
- 保存后同步计算部分衍生值（例如 ALT/AST、TC/HDL）

### 2) 三病风险评估

接口：

- `POST /api/risk/predict`

实现：

- `web/backend/app/risk_engine.py`：`predict_triple`
- 输出包含：
  - `probabilities`: 三病概率（0–1）
  - `scores`: 三病风险分（0–100，越高越危险）
  - `risk`: low/medium/high + 中文标签（低/中/高风险）
  - `factors`: 解释性因素列表（用于前端展示）
  - `propagationScores`: 传播分（演示用）

后端 `compositeIndex`：

- 由三病 `score` 的均值计算（**越高越危险**）

前端首页显示的 **健康综合分**：

- 反向换算：`健康综合分 = round(100 - compositeIndex)`（越高越“安全/健康”）
- 对应：`web/sanyuan-user/src/lib/riskScoreDisplay.ts`

---

## 首页/风险评估页的等级展示（近期已细化）

### 首页（健康综合分等级）

位置：`web/sanyuan-user/src/app/pages/HomePage.tsx`

阈值（越高越好）：

- ≥ 90：优秀
- ≥ 75：良好
- ≥ 60：一般
- ≥ 45：偏低
- < 45：较差

### 风险评估页（综合指数标签）

位置：`web/sanyuan-user/src/app/pages/RiskAssessment.tsx`

阈值（越高越安全）：

- ≥ 85：低风险
- ≥ 70：较低风险
- ≥ 55：中等风险
- ≥ 40：较高风险
- < 40：高风险

> 注：目前首页与风险评估页阈值在两处维护；可进一步抽到共享工具函数，防止口径漂移。

---

## 干预方案（健康生活指南）：内容展示与推荐

### 1) 推荐接口

- `GET /api/user/intervention/guides/recommended`

当前规则（简化版）：

- **三病均低风险**：推送所有 **认知类 + 饮食/运动类**（忽略文章 `risk_level`）
- **任一病中/高风险**：按轴筛选：
  - `disease` 命中对应病种中文名（肝：代谢相关脂肪性肝病；糖：2型糖尿病；卒中：脑卒中）
  - 且文章 `risk_level` 与用户该轴层级匹配（中→中风险，高→高风险）
  - 多轴取并集、去重
- 排序优化：对中/高风险轴，标题含对应病种关键词的文章优先（肝/糖/卒中均适用）

实现文件：

- `web/backend/app/guide_recommend.py`

### 2) 文章点击弹窗与正文排版

用户端干预方案页：`web/sanyuan-user/src/app/pages/Intervention.tsx`

弹窗组件：

- `web/sanyuan-user/src/app/components/HealthGuideArticleModal.tsx`

正文展示优化（已实现）：

- 去掉正文中的图片占位符，如 `<118_1.png>`
- 若占位符能匹配 `images[].filename`，则在正文对应位置插入配图
- 分段策略：
  - 优先按空行/换行拆段
  - 无换行则按 `。！？；` 断句成段

---

## 干预方案顶部“疾病风险程度”

用户端干预方案页顶部展示三病风险 pill（低/中/高风险），数据来自：

- `POST /api/risk/predict`（前端 `fetchRiskPredict`）

实现位置：

- `web/sanyuan-user/src/app/pages/Intervention.tsx`

---

## 及时就医推荐：定位 + 距离排序

### 后端：医院列表接口

- `GET /api/user/intervention/hospitals`

数据源：

- `web/backend/app/data/hospitals.json`（当前为“湛江三甲医院”列表，含经纬度字段）

### 前端：定位与距离计算

- 定位 Hook：`web/sanyuan-user/src/lib/useGeolocation.ts`
  - 基于 `navigator.geolocation.getCurrentPosition`
  - 建议由用户点击触发（浏览器权限策略更友好）
- 距离计算：`web/sanyuan-user/src/lib/geo.ts`
  - Haversine 大圆距离（直线距离，仅供参考）
- 就医推荐 UI：`web/sanyuan-user/src/app/pages/Intervention.tsx`
  - 用户点击“获取我的位置”后按距离升序排序并展示

> 生产环境通常需要 **HTTPS** 才能使用浏览器定位（除 `localhost` 外）。

---

## 内容导入（Excel）

脚本：

- `web/backend/scripts/import_health_guides.py`

功能：

- 从 Excel 导入 `health_articles`
- 读取图片目录，将配图元数据写入 `health_article_images`
- `content` 字段原样导入（正文中的 `<xxx.png>` 占位符由前端弹窗解析替换为真实图片）

依赖：

- `openpyxl`

---

## 典型端到端数据流

1. 用户填写问卷 → `/api/user/me/questionnaire` 落库到 `user_info`
2. 前端触发 `QUESTIONNAIRE_UPDATED_EVENT`
3. 页面刷新数据：
   - `/api/risk/predict`：更新三病风险与综合分
   - `/api/user/intervention/guides/recommended`：更新指南推荐
4. 用户点击指南卡片 → 弹窗展示全文、内联配图与分段正文
5. 用户进入“及时就医推荐”→ 点击获取定位 → 医院按距离排序

---

## 可演进方向（建议）

- **等级/阈值统一**：把首页与风险评估页的阈值函数抽成共享工具，避免口径漂移
- **推荐可解释性**：推荐接口返回 `matchedAxes / matchedKeywords`，前端展示“为什么推荐我这篇”
- **医院数据治理**：从静态 JSON 过渡到管理端维护（或接地图 POI），完善经纬度与科室结构
- **正文结构化**：若未来正文是 HTML/富文本，需增加安全渲染（XSS 防护）与更精细排版（标题/列表/引用等）

