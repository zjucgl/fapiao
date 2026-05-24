# 发票列表序号 / 重复检测 / 操作员自改 — 设计文档

- 日期：2026-05-24
- 范围：三个相互独立的小特性
- 状态：已与需求方确认；待写实施计划

---

## 1. 背景

需求方提出三项功能扩展：

1. **发票列表加序号** — 操作员、管理员两个列表页都缺一个直观的"第几条"。
2. **重复上传检测** — 当前 `docs/requirements.md` 把"发票查重"列在 Out of Scope，本次重新引入，作为 MVP 的补丁。
3. **未处理发票允许拥有者自行修改** — 操作员详情页目前只有"删除"按钮，缺"编辑"入口。后端 API 已经支持，是前端补完。

三块互相独立，可并行实现。

---

## 2. 功能 1：列表序号

### 2.1 行为

- 显示在操作员列表 `OperatorHomeView.vue` 与管理员列表 `AdminHomeView.vue` 的每条左侧。
- **跨页连续累计**：第 1 页 1–N，第 2 页 N+1–2N，依此类推。
- 序号反映"按当前筛选 + 默认排序（`created_at desc`）的全局排名"。

### 2.2 实现

- **后端**：`InvoicesService.listMine` / `listForTeam` 返回的每条 item 增加 `rowNumber` 字段。计算公式：
  ```ts
  rowNumber = (page - 1) * pageSize + indexInPage + 1
  ```
  在 `shapeInvoiceFull` 外层映射时按当前页 index 注入即可，无 SQL 改动。
- **前端**：`InvoiceListItem.vue` 和 `AdminHomeView` 内联的 `Cell` 模板都把 `rowNumber` 显示在最左（如 `#12` 灰色小字）。

### 2.3 注意

- Excel 导出里早已有"序号 自然递增"列，由导出服务自己生成，不复用本字段。
- 翻页是 push 模式（List 组件），列表里的 rowNumber 跟随增长，刷新时重置。

---

## 3. 功能 2：发票重复上传检测

### 3.1 行为

- 仅对**发票图**（`invoice_images`）做查重，不查支付凭证。
- 比对方式：**SHA-256 文件内容指纹**（不看文件名）。
- 比对范围：**同一团队**内所有未软删除发票的发票图。
- 命中策略：**仍然完成上传**，响应体中带 `duplicates` 数组告知客户端；前端弹提示但不阻塞。

### 3.2 数据库变更

`invoice_images` 表新增列：

```sql
ALTER TABLE invoice_images
  ADD COLUMN content_sha256 CHAR(64) NULL,
  ADD INDEX idx_sha256 (content_sha256);
```

- 类型 `CHAR(64)`：十六进制小写定长。
- 索引 `idx_sha256` 单列即可：查重时已经 `JOIN invoices ON invoice_id` 拿到 team_id，二次 filter 内存里完成；团队规模下命中率足够。
- **不冗余 `team_id`** 到 invoice_images：保持原有架构，查询路径仅在上传时触发，可接受 JOIN 成本。
- **允许 NULL**：兼容历史数据。回填脚本完成前，新上传统一写值；历史值由 backfill 补齐。

Prisma schema 同步：

```prisma
model InvoiceImage {
  // ... 既有字段
  contentSha256 String? @map("content_sha256") @db.Char(64)
  @@index([contentSha256])
}
```

### 3.3 上传时的查重逻辑

在 `InvoicesService.createByOperator` 中：

1. 计算每张 invoice image 的 sha256：
   ```ts
   const hash = crypto.createHash('sha256').update(file.buffer).digest('hex');
   ```
2. 收集本次上传所有 hash，**一次性查询**冲突：
   ```ts
   const conflicts = await tx.invoiceImage.findMany({
     where: {
       contentSha256: { in: hashes },
       invoice: { teamId: scope.teamId, deletedAt: null },
     },
     include: {
       invoice: {
         select: { id: true, createdAt: true, operator: { select: { username: true } } }
       },
     },
   });
   ```
3. 写入新 invoice_image 行时一并落 `contentSha256`。
4. **同次上传内部去重**：在收集到本批所有 hash 后，先用 `Map<hash, firstImageIndex>` 在内存里扫一遍 — 若同一上传里有两张图 hash 相同，第二张及之后的也算"重复"，conflictWith 指向本批第一张（`conflictWith.invoiceId` 此时为新发票自己的 id，operatorUsername 为当前用户，createdAt 为新发票 createdAt）。
5. 在 service 返回结构中加 `duplicates` 字段：
   ```ts
   duplicates: Array<{
     imageIndex: number;            // 本次上传中的第几张
     originalFilename: string;
     conflictWith: {
       invoiceId: string;
       createdAt: string;           // ISO
       operatorUsername: string | null;
     };
   }>
   ```
   未命中时为空数组。

### 3.4 历史数据回填

写一次性脚本 `backend/prisma/scripts/backfill-image-sha256.ts`：

- 遍历所有 `content_sha256 IS NULL` 的 `invoice_images` 行；
- 通过 `OssService` 拉 OSS 对象 buffer，算 sha256，update 回库；
- 每条独立事务，失败可重试；
- 跑完一次即可。MVP 量级几秒到几十秒。

不强制 `NOT NULL` 约束 — YAGNI，新写入路径已保证。

### 3.5 前端

`OperatorUploadView.vue` 提交成功后，若 `response.duplicates.length > 0`：

- 弹 `showDialog`：
  > "检测到 N 张图与已有发票重复：
  > • `<filename>` ↔ 发票 #123（2026-05-20 由 zhang3 上传）
  > 已为您保留，请核实是否重复报销。"
- 用户关闭后照常跳转回列表。

---

## 4. 功能 3：未处理发票，拥有者可改 支付方式 / 备注

### 4.1 行为

- 仅在 `inv.status === 'unprocessed'` 且当前用户是 `operatorId` 时入口可见。
- 已处理后入口消失（与"删除"按钮一致）。
- 可改字段：`paymentMethod`（Radio: 现金/线上）、`remark`（Field, ≤200 字）。
- 入口位置：**详情页**。列表不加滑动操作（保持简洁，PC 也友好）。

### 4.2 后端

无需改动。`PATCH /api/op/invoices/:id` 与 `InvoicesService.updateMine`（`invoices.service.ts:145`）已支持这两个字段，且已做：
- 越权校验（team + operator 双匹配）；
- 状态校验（processed 拒绝）。

### 4.3 前端

修改 `OperatorInvoiceDetailView.vue`：

- 把现在的 `<div v-if="inv.status === 'unprocessed'">删除</div>` 区域改成两个按钮：**编辑** + **删除**。
- 点击"编辑"打开 `van-dialog` 或行内 `van-popup`，内嵌表单：
  - `RadioGroup` 选支付方式；
  - `Field` 多行备注，maxlength=200，字符计数；
  - 确定/取消两个按钮。
- 提交调用 `invoicesApi.myUpdate(id, dto)`，成功后 `load()` 重新拉详情并 toast"已保存"。

`invoicesApi.myUpdate` 已经存在（`frontend/src/api/invoices.ts:17`）。

---

## 5. 实施顺序建议

按风险从小到大：

1. **功能 3（操作员自改）** — 纯前端、无数据库变更、API 已就绪。
2. **功能 1（列表序号）** — 后端轻量字段 + 前端展示。
3. **功能 2（查重）** — 涉及数据库迁移和回填，最大改动。

每个特性独立 commit，便于回退。

---

## 6. 测试要点

| 功能 | 关键测试 |
|---|---|
| 序号 | 多页翻页序号连续；筛选后重新计数；下拉刷新重置 |
| 查重 | 同一文件改名上传命中；同一文件同次上传内部多张同 hash 也命中；跨团队不命中；软删除发票的图不参与比对；历史无 sha256 行不参与比对（视为不命中） |
| 自改 | 未处理可改；处理后入口消失且 API 返 403；备注空字符串与 null 行为一致；超长 200 字提示 |

---

## 7. 范围外（不在本次做）

- 感知哈希（pHash），二次裁剪/重拍的发票仍无法识别。后续若有需要再加。
- 支付凭证查重。
- 操作员自改图片（增/删图片）。
- 在列表页直接编辑（SwipeCell 等）。

---

## 8. 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v0.1 | 2026-05-24 | 初稿 |
