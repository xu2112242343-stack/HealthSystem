# 部署文档（HealthSystem）

本文档覆盖 **后端 FastAPI + MySQL** 与 **4 个前端应用（portal/user/doctor/admin）** 的部署与启动方式。

## 组件与目录

- **后端 API**：`web/backend`（FastAPI，默认 `8001`）
- **门户端（登录/角色选择）**：`web/portal`（Vite dev 端口 `5170`）
- **用户端**：`web/sanyuan-user`（Vite dev 端口 `5171`）
- **医生端**：`web/doctor`（Vite dev 端口 `5172`）
- **管理员端**：`web/administrator`（Vite dev 端口 `5173`）

## 一、本地开发部署（推荐）

### 1) 准备环境

- **Node.js**：建议 18+（用于 Vite）
- **Python**：3.10+（用于 FastAPI）
- **MySQL**：8.x（或兼容版本）

### 2) 配置后端环境变量

后端会从 `web/backend/.env` 读取配置（该文件已在 `.gitignore` 中忽略）。

复制示例文件并修改：

```bash
copy web\backend\.env.example web\backend\.env
```

关键项（分项配置更推荐）：

- `HEALTH_MYSQL_HOST`
- `HEALTH_MYSQL_PORT`
- `HEALTH_MYSQL_USER`
- `HEALTH_MYSQL_PASSWORD`
- `HEALTH_MYSQL_DATABASE`

可选（首次启动且管理员表为空时自动插入默认管理员，生产务必改密）：

- `HEALTH_ADMIN_LOGIN`
- `HEALTH_ADMIN_PASSWORD`
- `HEALTH_ADMIN_USERNAME`

### 3) 启动后端

在仓库根目录执行：

```bash
cd web
python -m pip install -r backend/requirements.txt
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8001 --app-dir backend
```

说明：
- API 路径统一以 `/api/*` 暴露。
- 后端内置了对表结构的“增量补丁/自动建表”（`create_all()` + 少量 `ALTER TABLE`），但**不会自动做字段迁移**；生产库变更请走迁移工具或手工 SQL。

### 4) 启动前端（四端并行）

在仓库根目录执行：

```bash
cd web
npm run install:all
npm run dev
```

默认访问地址：
- 门户端：`http://localhost:5170`
- 用户端：`http://localhost:5171`
- 医生端：`http://localhost:5172`
- 管理员端：`http://localhost:5173`

### 5) 前端环境变量（对接后端/Mock）

各端使用 Vite 环境变量（建议复制为 `.env.local` 或 `.env`，并保持不提交仓库）。

- 门户端 `web/portal/.env.example`
  - `VITE_API_BASE_URL`：**必填**，门户登录/注册走真实 API（示例：`http://127.0.0.1:8001`）
  - `VITE_USE_API_MOCK=false`
- 用户端 `web/sanyuan-user/.env.example`
  - `VITE_API_BASE_URL`：留空则走 Vite 代理（把 `/api` 转发到 `127.0.0.1:8001`）
  - `VITE_USE_API_MOCK`：演示可为 `true`，对接后端改 `false`
- 医生端/管理员端（`web/doctor/.env.example`、`web/administrator/.env.example`）
  - `VITE_USE_API_MOCK`：对接后端时设为 `false` 并配置 `VITE_API_BASE_URL`（或增加代理）

## 二、生产部署（无 Docker 方案）

项目当前未提供 `Dockerfile/docker-compose`，生产部署建议按“后端服务化 + 前端静态化 + 反向代理”。

### 1) 数据库

准备 MySQL 数据库（示例库名 `health_platform`），并创建具备读写权限的账号。

### 2) 后端（FastAPI）

推荐方式：
- 使用虚拟环境安装依赖
- 用 `uvicorn`/`gunicorn` 常驻运行
- 由 Nginx 反向代理至后端端口（如 `8001`）

最小启动命令（Linux 示例）：

```bash
cd web/backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8001
```

注意：
- 若前端与后端不同域/端口访问，需要后端 **CORS 放行** 对应来源；当前代码中已预置了部分 `localhost:5170` 等开发端口的放行列表。

### 3) 前端（静态资源）

构建四端：

```bash
cd web
npm run install:all
npm run build:all
```

构建产物位置（均为各自应用目录下的 `dist/`）：
- `web/portal/dist`
- `web/sanyuan-user/dist`
- `web/doctor/dist`
- `web/administrator/dist`

### 4) Nginx 部署建议（示例）

可选两种方式：

- **方式 A：按子域名部署（推荐）**
  - `portal.example.com` → `web/portal/dist`
  - `user.example.com` → `web/sanyuan-user/dist`
  - `doctor.example.com` → `web/doctor/dist`
  - `admin.example.com` → `web/administrator/dist`
  - `api.example.com` → 反代到 `http://127.0.0.1:8001`

- **方式 B：按路径部署**
  - `/portal/`、`/user/`、`/doctor/`、`/admin/` 对应不同静态目录
  - `/api/` 反代后端

（若采用路径部署，需要确认前端资源路径与路由模式是否支持子路径；当前项目以 Vite 默认配置为主，通常更建议子域名方式。）

## 三、常见问题

- **前端请求 `/api` 404**：`VITE_API_BASE_URL` 留空时仅在“开发代理”生效；生产环境需用 Nginx 配置 `/api` 反向代理到后端，或在前端配置 `VITE_API_BASE_URL` 指向后端域名。
- **跨域报错（CORS）**：前端直连后端（不同域/端口）时，需在后端 CORS `allow_origins` 中加入实际前端地址。
- **数据库表未创建**：确认后端已连上正确库；后端启动时会自动建表（仅创建不存在的表）并做少量补列补丁。

