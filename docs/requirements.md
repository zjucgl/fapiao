# 发票登记管理系统 — 需求与设计文档

- 版本：v0.1（需求初稿）
- 日期：2026-05-04
- 范围：MVP（最小可用版本）

---

## 1. 项目概述

### 1.1 背景与目标

为个人或小团队提供一个轻量的发票登记管理工具，覆盖从发票图片上传、支付凭证留存、到批量导出归档的全流程。系统面向多团队，团队之间数据完全隔离。

### 1.2 设计原则

- **架构简单**：单台 ECS 起步，前后端同域部署，技术栈统一为 JavaScript/TypeScript。
- **YAGNI**：MVP 只做明确需要的功能，不引入审计日志、OCR、统计报表、审核流等。
- **图片私密**：所有发票与凭证图片不公开访问，必须通过签名 URL。
- **租户隔离**：所有业务数据带 `team_id`，由权限守卫强制过滤，跨团队不可见。

### 1.3 范围之外（Out of Scope）

- OCR 自动识别发票字段
- 统计报表与数据可视化
- 多级审核流程
- 发票查重 / 防重复报销
- 与微信、钉钉等第三方 IM 集成
- 多币种、多语言

---

## 2. 角色与权限

系统三层角色，从大到小：

| 角色 | 创建方 | 权限范围 |
|---|---|---|
| 超级管理员（super_admin） | 系统初始化时通过 seed 脚本写入，全局唯一 | 创建 / 停用团队；为每个团队指定一名团队管理员（开账号设初始密码） |
| 团队管理员（team_admin） | 超级管理员创建 | 团队内增删操作员；查看本团队所有发票；登记发票金额与类型；批量标记已处理；批量导出 |
| 操作员（operator） | 团队管理员创建 | 上传发票图片；选支付方式；上传支付凭证；只能查看与编辑自己上传的发票 |

### 2.1 登录与账号

- 统一采用**账号 + 密码**登录。
- 团队管理员、操作员均由上级直接开账号、设初始密码。
- **首次登录强制改密**（`must_change_password = true` 时所有接口拒绝业务请求，仅放行修改密码接口）。
- 一个账号绑定一个角色与一个团队（超级管理员除外，其 `team_id` 为 NULL）。
- 鉴权方式：JWT（短期 access token + refresh token）。
- 密码存储：bcrypt（cost ≥ 10）。

### 2.2 越权防护

- 后端在守卫层（NestJS Guard）统一注入 `req.user.teamId`，所有数据查询自动追加 `WHERE team_id = ?`。
- 操作员额外受限：所有发票相关查询追加 `AND operator_id = ?`。
- 超级管理员请求不带 `team_id` 过滤，但其访问的接口与普通团队接口分离（`/api/super/*`）。

---

## 3. 功能需求

### 3.1 操作员功能

#### 3.1.1 上传发票

- 入口：移动端 / PC 端"新建发票"按钮。
- 表单字段：
  - **发票图片**：必填，可上传多张（如发票多页）。
  - **支付方式**：单选，必填，枚举 = `cash`（现金） / `online`（线上）。
  - **支付凭证图片**：必填，可上传多张。
    - 现金：拍菜单、消费小票等。
    - 线上：支付宝 / 微信 / 银行 App 截图。
  - **备注**（可选，纯文本，≤ 200 字）。
- 提交后系统自动写入：
  - `operator_id` = 当前用户
  - `team_id` = 当前用户所在团队
  - `created_at` = 服务器当前时间（北京时间）
  - `status` = `unprocessed`
  - `amount`、`invoice_type` 留空，由管理员后填。

#### 3.1.2 查看自己的发票

- 列表分页，默认按 `created_at` 倒序。
- 可筛选：状态（已处理 / 未处理）、支付方式、日期范围。
- 列表字段：缩略图、录入日期、支付方式、状态、备注摘要。
- 点击进入详情，可查看大图。

#### 3.1.3 修改与删除（限本人 + 未处理状态）

- 仅在状态为 `unprocessed` 时允许编辑或删除。
- 一旦管理员将其标记为 `processed`，操作员只读。
- 删除采用**软删除**（`deleted_at` 字段），后端查询自动过滤。

### 3.2 团队管理员功能

#### 3.2.1 操作员管理

- 列表显示本团队所有操作员：账号、姓名（可选）、状态、创建时间、最近登录时间。
- 创建操作员：填账号 + 初始密码，账号在团队内唯一（系统层全局唯一也可，便于实现）。
- 重置密码：可强制重置，重置后下次登录强制改密。
- 停用 / 启用：停用后无法登录，但其上传的历史发票仍可见。
- **不允许删除**操作员（避免历史数据 owner 悬空）；只能停用。

#### 3.2.2 发票列表

- 显示本团队所有操作员上传的发票。
- 筛选条件：操作员、状态、支付方式、发票类型、日期范围、是否已登记金额。
- 列表字段：缩略图、操作员、录入日期、金额、发票类型、支付方式、状态。
- 支持批量勾选 + 全选当前筛选结果。

#### 3.2.3 登记发票

- 点开发票详情，管理员可登记：
  - **金额**：数字，保留两位小数，单位元。
  - **发票类型**：枚举 = `catering`（餐饮） / `fuel`（油票） / `consumable`（耗材） / `printing`（打印） / `other`（其它）。
- 登记字段独立于状态，可只填一项。
- 修改后写入 `updated_at`，记录最后操作管理员。

#### 3.2.4 批量标记已处理

- 列表勾选后，点"批量标记为已处理"。
- 后端将所选发票 `status` 改为 `processed`，写入 `processed_at`、`processed_by`。
- 已处理后，操作员对该发票变为只读。

#### 3.2.5 批量导出

- 列表勾选后（或筛选后全选），点"导出"。
- 弹窗选打包模式，三选一：

  | 模式 | 输出 |
  |---|---|
  | 模式 1 | 1 个 Excel 文件 + 1 个 ZIP（仅发票图片） |
  | 模式 2 | 1 个 Excel 文件 + 1 个 ZIP（仅支付凭证图片） |
  | 模式 3 | 1 个 Excel 文件 + 2 个独立 ZIP（发票图片 ZIP、支付凭证图片 ZIP，分开下载） |

- **Excel 表结构**（每行一张发票）：

  | 列 | 说明 |
  |---|---|
  | 序号 | 自然递增 |
  | 录入日期 | YYYY-MM-DD HH:mm |
  | 操作员 | 账号 |
  | 金额 | 数字（无则空） |
  | 发票类型 | 中文枚举 |
  | 支付方式 | 现金 / 线上 |
  | 状态 | 已处理 / 未处理 |
  | 备注 | 纯文本 |
  | 发票图片文件名 | 多张以分号 `;` 分隔，文件名对应 ZIP 内文件 |
  | 支付凭证文件名 | 同上 |

- **图片命名规则**：`{invoice_id}_{序号}.{ext}`；同一发票多张图片 `序号` 递增。
- 导出弹窗附加选项：**导出后自动批量标记为已处理**（默认不勾）。

### 3.3 超级管理员功能

- 团队管理：创建团队（填团队名）、停用 / 启用团队。
- 团队管理员管理：为团队创建管理员账号、重置密码、停用 / 启用。
- 不直接操作发票数据。

---

## 4. 数据模型

数据库：阿里云 RDS MySQL 8.0。字符集 `utf8mb4`。

### 4.1 表结构（共 5 张核心表）

```sql
-- 团队
CREATE TABLE teams (
  id           BIGINT PRIMARY KEY AUTO_INCREMENT,
  name         VARCHAR(64) NOT NULL,
  status       ENUM('active','disabled') NOT NULL DEFAULT 'active',
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_name (name)
);

-- 用户（含三种角色）
CREATE TABLE users (
  id                    BIGINT PRIMARY KEY AUTO_INCREMENT,
  team_id               BIGINT NULL,                 -- 超级管理员为 NULL
  username              VARCHAR(64) NOT NULL,
  password_hash         VARCHAR(255) NOT NULL,
  role                  ENUM('super_admin','team_admin','operator') NOT NULL,
  must_change_password  TINYINT(1) NOT NULL DEFAULT 1,
  status                ENUM('active','disabled') NOT NULL DEFAULT 'active',
  last_login_at         DATETIME NULL,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_username (username),
  KEY idx_team_role (team_id, role)
);

-- 发票主表
CREATE TABLE invoices (
  id              BIGINT PRIMARY KEY AUTO_INCREMENT,
  team_id         BIGINT NOT NULL,
  operator_id     BIGINT NOT NULL,
  amount          DECIMAL(12,2) NULL,                                    -- 管理员后填
  invoice_type    ENUM('catering','fuel','consumable','printing','other') NULL,
  payment_method  ENUM('cash','online') NOT NULL,
  status          ENUM('unprocessed','processed') NOT NULL DEFAULT 'unprocessed',
  remark          VARCHAR(200) NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  processed_at    DATETIME NULL,
  processed_by    BIGINT NULL,
  deleted_at      DATETIME NULL,                                         -- 软删除
  KEY idx_team_status (team_id, status),
  KEY idx_team_operator (team_id, operator_id),
  KEY idx_created_at (created_at)
);

-- 发票本身的图片（一对多）
CREATE TABLE invoice_images (
  id                 BIGINT PRIMARY KEY AUTO_INCREMENT,
  invoice_id         BIGINT NOT NULL,
  oss_key            VARCHAR(512) NOT NULL,
  original_filename  VARCHAR(255) NOT NULL,
  size_bytes         INT NOT NULL,
  uploaded_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_invoice (invoice_id)
);

-- 支付凭证图片（一对多）
CREATE TABLE payment_proof_images (
  id                 BIGINT PRIMARY KEY AUTO_INCREMENT,
  invoice_id         BIGINT NOT NULL,
  oss_key            VARCHAR(512) NOT NULL,
  original_filename  VARCHAR(255) NOT NULL,
  size_bytes         INT NOT NULL,
  uploaded_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_invoice (invoice_id)
);
```

### 4.2 设计要点

- 不使用外键约束（应用层保证），便于后期分库分表，也避免迁移坑。
- `invoice_images` 与 `payment_proof_images` 拆两表，使导出按类型分包非常自然，并允许后续两类图片差异化处理（如不同的访问策略、不同的保留期）。
- `amount` 与 `invoice_type` 都允许 NULL，反映"管理员后填"语义。
- `deleted_at` 软删除，所有查询默认 `WHERE deleted_at IS NULL`。

---

## 5. 技术架构

### 5.1 总览

```
┌──────────────────────────────────────────────────────┐
│            浏览器（PC + 移动端，响应式）              │
│         Vue 3 + Vant 4 + Pinia + Vue Router           │
└─────────────────────────┬────────────────────────────┘
                          │ HTTPS (JWT)
                          ▼
┌──────────────────────────────────────────────────────┐
│                后端：Node.js + NestJS                 │
│   AuthGuard → RoleGuard → TeamScopeGuard → Service    │
└──────┬──────────────────────────────────┬────────────┘
       │                                  │
       ▼                                  ▼
┌────────────────┐              ┌────────────────────┐
│ 阿里云 RDS MySQL│              │ 阿里云 OSS（私有桶）│
│   5 张核心表    │              │ 发票图 + 支付凭证图 │
└────────────────┘              └────────────────────┘
```

### 5.2 选型

| 维度 | 选型 | 备注 |
|---|---|---|
| 后端框架 | NestJS（TypeScript） | 模块化、依赖注入、Guard/Interceptor 适合做权限收口 |
| ORM | Prisma | schema 直观，迁移友好 |
| 鉴权 | `@nestjs/jwt` + 自写 RefreshToken | access 30min / refresh 7d |
| 密码哈希 | bcrypt | cost = 10 |
| 文件上传 | multer + ali-oss SDK | 后端中转，权限收口 |
| Excel 生成 | exceljs | 流式写入，支持大批量 |
| ZIP 打包 | archiver | 流式输出，不占内存 |
| 校验 | class-validator | 与 NestJS DTO 集成好 |
| 前端框架 | Vue 3（Composition API） | 主流且轻 |
| 前端 UI | Vant 4 | 移动优先组件库，PC 也可用 |
| 前端状态 | Pinia | 简单 |
| 前端构建 | Vite | 快 |
| 部署 | 阿里云 ECS 单机 + Nginx + PM2 | 单机起步，前后端同域，避免跨域 |

### 5.3 文件上传与访问

- 上传：前端 → 后端（校验权限 + 类型 + 大小）→ ali-oss SDK 上传 → DB 存 `oss_key`。
- 访问：前端请求图片 → 后端检查权限 → 用 `signatureUrl(key, { expires: 300 })` 生成 5 分钟签名 URL → 返回前端。
- OSS 桶 ACL = `private`，绝不开公开读。
- 命名规则：`{teamId}/{yyyymm}/{invoiceId}/{uuid}.{ext}`，便于按团队按月归档与排查。

### 5.4 安全要点

- 全站 HTTPS。
- 上传白名单：`image/jpeg`、`image/png`、`image/webp`、`application/pdf`；单文件 ≤ 10 MB。
- 服务端再次校验 MIME（不只信前端 Content-Type）。
- 所有列表 / 详情接口在 Guard 层强制 `team_id` 过滤。
- 密码策略：≥ 8 位，至少包含数字与字母。
- 操作日志：MVP 不做系统级审计日志，仅记录关键字段（`processed_by`、`updated_at`）。

---

## 6. 接口约定（高层）

仅列资源与动作，详细参数 / 返回结构在实现阶段定 OpenAPI 文档。

### 6.1 鉴权

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/auth/login | 账号密码登录，返回 access + refresh token |
| POST | /api/auth/refresh | 刷新 token |
| POST | /api/auth/change-password | 改密码（首次登录强制走此接口） |

### 6.2 超级管理员

| 方法 | 路径 | 说明 |
|---|---|---|
| GET / POST / PATCH | /api/super/teams | 团队 CRUD |
| GET / POST / PATCH | /api/super/teams/:id/admins | 团队管理员 CRUD |

### 6.3 团队管理员

| 方法 | 路径 | 说明 |
|---|---|---|
| GET / POST / PATCH | /api/admin/operators | 操作员 CRUD（不删除，仅停用） |
| GET | /api/admin/invoices | 发票列表（支持筛选） |
| GET | /api/admin/invoices/:id | 发票详情 |
| PATCH | /api/admin/invoices/:id | 登记金额 / 类型 |
| POST | /api/admin/invoices/batch-process | 批量标记已处理 |
| POST | /api/admin/invoices/export | 批量导出（Body 带 ids + mode + 是否同时标记已处理） |

### 6.4 操作员

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/op/invoices | 仅自己上传的发票 |
| POST | /api/op/invoices | 创建发票（multipart） |
| PATCH | /api/op/invoices/:id | 修改（仅未处理） |
| DELETE | /api/op/invoices/:id | 软删除（仅未处理） |
| GET | /api/op/invoices/:id/images/:imgId/url | 获取签名 URL |

---

## 7. 部署

### 7.1 环境

- 阿里云 ECS 1 台（推荐 2c4g 起步），Ubuntu 22.04。
- 阿里云 RDS MySQL 8.0，与 ECS 同 VPC，内网连接。
- 阿里云 OSS 私有桶，与 ECS 同 region 减少流量费。
- 域名 + 阿里云免费 SSL 证书。

### 7.2 部署架构

- Nginx：80/443 → 反代到 Node 进程；同时托管前端静态文件。
- PM2：守护后端 Node 进程，集群模式（CPU 核数）。
- 前后端同域，前端走 `/`，API 走 `/api/*`，避免跨域。
- 日志：PM2 日志 + Nginx access log，按天滚动。

### 7.3 配置项（环境变量）

```
DATABASE_URL=mysql://user:pass@rds-host:3306/fapiao
JWT_ACCESS_SECRET=...
JWT_REFRESH_SECRET=...
OSS_REGION=oss-cn-hangzhou
OSS_BUCKET=...
OSS_ACCESS_KEY_ID=...
OSS_ACCESS_KEY_SECRET=...
SUPER_ADMIN_USERNAME=...
SUPER_ADMIN_INITIAL_PASSWORD=...   # 仅 seed 时使用
```

---

## 8. 后续待定项（非 MVP）

记录下来不忘，但 MVP 不做：

- 操作日志 / 审计模块
- 发票 OCR 自动识别（金额、开票日期、发票号、销售方）
- 月度统计报表（按类型、按操作员）
- 多管理员（一个团队多个管理员）
- 团队管理员可调整操作员所属团队
- 发票"驳回 / 退回操作员补充"流程
- 第三方登录（微信扫码、企业微信）
- 移动端原生 App（先看 Web 体验是否够用）
- 前端直传 OSS（STS 临时凭证），后端不中转

---

## 9. 开发里程碑（建议）

| 阶段 | 内容 | 预估 |
|---|---|---|
| M1 | 后端脚手架 + DB schema + 鉴权 + 三类用户 CRUD | 1 周 |
| M2 | 操作员上传发票 + OSS 集成 + 列表 + 详情 | 1 周 |
| M3 | 管理员发票列表 + 登记字段 + 批量标记已处理 | 0.5 周 |
| M4 | 批量导出（Excel + ZIP，三种模式） | 0.5 周 |
| M5 | 前端响应式 UI（PC + 移动） | 1.5 周 |
| M6 | 部署 + 灰度自测 + 修 bug | 0.5 周 |

合计约 5 周（一人 / 兼职可放宽）。

---

## 10. 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v0.1 | 2026-05-04 | 初稿 |
