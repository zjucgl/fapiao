# 发票列表序号 / 重复检测 / 操作员自改 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给发票列表加跨页连续序号；上传时基于 SHA-256 检测重复发票图并提示用户；让操作员能在详情页编辑自己未处理发票的支付方式与备注。

**Architecture:** 三个相互独立的小特性，按 风险递增 顺序实施 — 先纯前端（操作员自改），再后端轻字段（列表序号），最后涉及迁移与回填的查重。每个特性独立 commit。

**Tech Stack:** NestJS + Prisma + MySQL（后端），Vue 3 + Vant 4（前端），jest（后端测试），vue-tsc（前端类型检查）。

---

## 文件结构总览

| 文件 | 改动 | 说明 |
|---|---|---|
| `frontend/src/views/operator/OperatorInvoiceDetailView.vue` | 修改 | 加"编辑"按钮 + 弹窗表单 |
| `backend/src/invoices/invoices.service.ts` | 修改 | listMine/listForTeam 注入 rowNumber；createByOperator 加 SHA-256 查重 |
| `backend/src/invoices/invoices.service.spec.ts` | 修改 | 加 rowNumber 与 duplicates 测试 |
| `frontend/src/types/api.ts` | 修改 | InvoiceFull 加 `rowNumber`；新增 `CreateInvoiceResponse` 含 `duplicates` |
| `frontend/src/api/invoices.ts` | 修改 | `myCreate` 返回类型改为 `CreateInvoiceResponse` |
| `frontend/src/components/InvoiceListItem.vue` | 修改 | 展示 `#N` |
| `frontend/src/views/admin/AdminHomeView.vue` | 修改 | 展示 `#N` |
| `backend/prisma/schema.prisma` | 修改 | `InvoiceImage` 加 `contentSha256` |
| `backend/prisma/migrations/<ts>_add_invoice_image_sha256/migration.sql` | 创建 | ALTER TABLE 加列 + 索引 |
| `backend/prisma/scripts/backfill-image-sha256.ts` | 创建 | 历史数据回填脚本 |
| `frontend/src/views/operator/OperatorUploadView.vue` | 修改 | 收到 `duplicates` 弹 dialog |

---

# Feature 3 — 操作员自改 支付方式 / 备注

后端 API 已经支持（`PATCH /api/op/invoices/:id`，`updateMine` 已校验 unprocessed），本特性纯前端。

## Task 3.1：详情页加"编辑"入口

**Files:**
- Modify: `frontend/src/views/operator/OperatorInvoiceDetailView.vue`

- [ ] **Step 1: 修改 OperatorInvoiceDetailView.vue**

把整个文件替换为：

```vue
<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Button, Cell, CellGroup, Field, Popup, Radio, RadioGroup, Tag, showToast, showConfirmDialog } from 'vant';
import ImageThumbGrid from '@/components/ImageThumbGrid.vue';
import { invoicesApi } from '@/api/invoices';
import type { InvoiceFull, PaymentMethod } from '@/types/api';

const route = useRoute();
const router = useRouter();
const id = route.params.id as string;
const inv = ref<InvoiceFull | null>(null);
const loading = ref(false);

const editing = ref(false);
const editForm = reactive<{ paymentMethod: PaymentMethod; remark: string }>({ paymentMethod: 'cash', remark: '' });
const saving = ref(false);

async function load() {
  loading.value = true;
  try { inv.value = await invoicesApi.myDetail(id); }
  catch { showToast({ type: 'fail', message: '加载失败' }); }
  finally { loading.value = false; }
}

function openEdit() {
  if (!inv.value) return;
  editForm.paymentMethod = inv.value.paymentMethod;
  editForm.remark = inv.value.remark ?? '';
  editing.value = true;
}

async function onSave() {
  saving.value = true;
  try {
    await invoicesApi.myUpdate(id, {
      paymentMethod: editForm.paymentMethod,
      remark: editForm.remark || null,
    });
    showToast({ type: 'success', message: '已保存' });
    editing.value = false;
    await load();
  } catch (e: any) {
    showToast({ type: 'fail', message: e.response?.data?.message || '保存失败' });
  } finally {
    saving.value = false;
  }
}

async function onDelete() {
  try {
    await showConfirmDialog({ title: '删除这张发票？', message: '只能删除未处理的发票', cancelButtonText: '取消', confirmButtonText: '删除' });
  } catch { return; }
  try {
    await invoicesApi.myDelete(id);
    showToast({ type: 'success', message: '已删除' });
    router.replace({ name: 'op-home' });
  } catch (e: any) {
    showToast({ type: 'fail', message: e.response?.data?.message || '删除失败' });
  }
}

onMounted(load);

const typeLabel: Record<string, string> = { catering: '餐饮', fuel: '油票', consumable: '耗材', printing: '打印', other: '其它' };
</script>

<template>
  <div v-if="inv">
    <CellGroup inset title="基本信息">
      <Cell title="录入日期" :value="new Date(inv.createdAt).toLocaleString('zh-CN', { hour12: false })" />
      <Cell title="支付方式" :value="inv.paymentMethod === 'cash' ? '现金' : '线上'" />
      <Cell title="状态">
        <Tag :type="inv.status === 'processed' ? 'success' : 'warning'">{{ inv.status === 'processed' ? '已处理' : '未处理' }}</Tag>
      </Cell>
      <Cell v-if="inv.amount != null" title="金额" :value="`¥${inv.amount.toFixed(2)}`" />
      <Cell v-if="inv.invoiceType" title="发票类型" :value="typeLabel[inv.invoiceType]" />
      <Cell v-if="inv.remark" title="备注" :value="inv.remark" />
    </CellGroup>

    <CellGroup inset title="发票图片">
      <ImageThumbGrid :invoice-id="inv.id" :images="inv.invoiceImages" kind="invoice" :sign-fn="invoicesApi.signInvoiceImage" />
    </CellGroup>

    <CellGroup inset title="支付凭证">
      <ImageThumbGrid :invoice-id="inv.id" :images="inv.proofImages" kind="proof" :sign-fn="invoicesApi.signProofImage" />
    </CellGroup>

    <div v-if="inv.status === 'unprocessed'" class="actions">
      <Button block type="primary" plain @click="openEdit">编辑</Button>
      <Button block type="danger" plain @click="onDelete">删除</Button>
    </div>

    <Popup v-model:show="editing" position="bottom" round closeable :style="{ paddingBottom: '16px' }">
      <div class="edit-title">编辑发票</div>
      <CellGroup>
        <Cell title="支付方式">
          <RadioGroup v-model="editForm.paymentMethod" direction="horizontal">
            <Radio name="cash">现金</Radio>
            <Radio name="online">线上</Radio>
          </RadioGroup>
        </Cell>
        <Field
          v-model="editForm.remark"
          label="备注"
          rows="2"
          autosize
          type="textarea"
          placeholder="可选，最多 200 字"
          maxlength="200"
          show-word-limit
        />
      </CellGroup>
      <div class="edit-actions">
        <Button block plain @click="editing = false">取消</Button>
        <Button block type="primary" :loading="saving" @click="onSave">保存</Button>
      </div>
    </Popup>
  </div>
  <div v-else-if="loading" style="padding: 32px; text-align: center;">加载中…</div>
</template>

<style scoped>
.actions { display: flex; gap: 8px; margin: 16px; }
.actions :deep(.van-button) { flex: 1; }
.edit-title { padding: 16px; font-size: 16px; font-weight: 600; text-align: center; }
.edit-actions { display: flex; gap: 8px; padding: 16px; }
.edit-actions :deep(.van-button) { flex: 1; }
</style>
```

- [ ] **Step 2: 类型检查**

Run: `cd frontend && npm run build`
Expected: 编译通过，无 type error。

- [ ] **Step 3: 启动 dev server 手工验证**

Run: `cd frontend && npm run dev`（后端要同步起，否则 API 报 401）

浏览器测试清单：
- 未处理发票详情页同时显示"编辑"和"删除"两个按钮，并排
- 已处理发票详情页两个按钮都不显示
- 点"编辑"打开弹窗，预填当前 paymentMethod + remark
- 修改后点"保存"，toast"已保存"，详情刷新
- 改备注成空 → 保存后基础信息里"备注"行消失（说明 null 已生效）
- 后端日志：能看到 `PATCH /api/op/invoices/:id`

- [ ] **Step 4: 提交**

```bash
git add frontend/src/views/operator/OperatorInvoiceDetailView.vue
git commit -m "feat(frontend): 操作员可在详情页编辑未处理发票的支付方式和备注"
```

---

# Feature 1 — 发票列表跨页连续序号

## Task 1.1：后端 service 注入 rowNumber（先写测试）

**Files:**
- Modify: `backend/src/invoices/invoices.service.spec.ts`
- Modify: `backend/src/invoices/invoices.service.ts`

- [ ] **Step 1: 写失败测试**

在 `backend/src/invoices/invoices.service.spec.ts` 里，找到 `describe('InvoicesService operator read paths', ...)` 块（约第 121 行），在该 describe 内末尾新增：

```ts
  it('listMine attaches rowNumber based on page and pageSize', async () => {
    prisma.invoice.findMany.mockResolvedValue([
      { id: 10n, teamId: 1n, operatorId: 7n, paymentMethod: PaymentMethod.cash, status: InvoiceStatus.unprocessed, amount: null, createdAt: new Date(), updatedAt: new Date(), processedAt: null, processedBy: null, remark: null, invoiceImages: [], proofImages: [], operator: { username: 'op_a' } },
      { id: 11n, teamId: 1n, operatorId: 7n, paymentMethod: PaymentMethod.cash, status: InvoiceStatus.unprocessed, amount: null, createdAt: new Date(), updatedAt: new Date(), processedAt: null, processedBy: null, remark: null, invoiceImages: [], proofImages: [], operator: { username: 'op_a' } },
    ]);
    prisma.invoice.count.mockResolvedValue(50);
    const res = await svc.listMine({ teamId: 1n, operatorId: 7n }, { page: 2, pageSize: 20 } as any);
    expect(res.items[0].rowNumber).toBe(21);
    expect(res.items[1].rowNumber).toBe(22);
  });
```

同样在 `describe('InvoicesService admin scope', ...)` 块（约第 287 行）内末尾新增：

```ts
  it('listForTeam attaches rowNumber based on page and pageSize', async () => {
    prisma.invoice.findMany.mockResolvedValue([
      { id: 20n, teamId: 1n, operatorId: 7n, paymentMethod: PaymentMethod.cash, status: InvoiceStatus.unprocessed, amount: null, createdAt: new Date(), updatedAt: new Date(), processedAt: null, processedBy: null, remark: null, invoiceImages: [], proofImages: [], operator: { username: 'op_a' } },
    ]);
    prisma.invoice.count.mockResolvedValue(100);
    const res = await svc.listForTeam({ teamId: 1n }, { page: 3, pageSize: 30 } as any);
    expect(res.items[0].rowNumber).toBe(61);
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && npx jest invoices.service.spec.ts -t "rowNumber" --no-coverage`
Expected: 2 个新测试 fail（`rowNumber` undefined）。

- [ ] **Step 3: 实现 rowNumber 注入**

在 `backend/src/invoices/invoices.service.ts` 文件中：

**改 `listMine` 方法** — 把返回语句：
```ts
    return { items: items.map((it: any) => this.shapeInvoiceFull(it)), total, page: q.page ?? 1, pageSize: q.pageSize ?? 50 };
```
替换为：
```ts
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 50;
    return {
      items: items.map((it: any, idx: number) => ({ ...this.shapeInvoiceFull(it), rowNumber: (page - 1) * pageSize + idx + 1 })),
      total, page, pageSize,
    };
```
注意此前 `listMine` 是 `take: q.pageSize ?? 50, skip: ((q.page ?? 1) - 1) * (q.pageSize ?? 50)`，保持不变。

**改 `listForTeam` 方法** — 同样处理：把返回语句：
```ts
    return { items: items.map((it: any) => this.shapeInvoiceFull(it)), total, page: q.page ?? 1, pageSize: q.pageSize ?? 50 };
```
替换为：
```ts
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 50;
    return {
      items: items.map((it: any, idx: number) => ({ ...this.shapeInvoiceFull(it), rowNumber: (page - 1) * pageSize + idx + 1 })),
      total, page, pageSize,
    };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && npx jest invoices.service.spec.ts --no-coverage`
Expected: 全部测试 PASS（含原有用例 + 新增 2 个 rowNumber）。

- [ ] **Step 5: 提交**

```bash
git add backend/src/invoices/invoices.service.ts backend/src/invoices/invoices.service.spec.ts
git commit -m "feat(invoice): 列表返回项新增 rowNumber（跨页连续序号）"
```

## Task 1.2：前端类型与展示

**Files:**
- Modify: `frontend/src/types/api.ts`
- Modify: `frontend/src/components/InvoiceListItem.vue`
- Modify: `frontend/src/views/admin/AdminHomeView.vue`

- [ ] **Step 1: 给 InvoiceFull 加 rowNumber**

打开 `frontend/src/types/api.ts`，在 `InvoiceFull` 接口最后一个字段 `proofImages: InvoiceImage[];` 后面插入新字段：

```ts
  rowNumber?: number;
```

（设为可选以兼容详情接口，详情接口不返回 rowNumber。）

- [ ] **Step 2: InvoiceListItem 显示序号**

打开 `frontend/src/components/InvoiceListItem.vue`，把 `<template>` 段替换为：

```vue
<template>
  <Cell is-link :label="invoice.remark || ''">
    <template #title>
      <span class="title-row">
        <span v-if="invoice.rowNumber != null" class="rownum">#{{ invoice.rowNumber }}</span>
        <span>{{ dateLabel }}</span>
      </span>
    </template>
    <template #right-icon>
      <div class="meta">
        <Tag :type="invoice.status === 'processed' ? 'success' : 'warning'" size="medium">{{ statusLabel }}</Tag>
        <div v-if="invoice.amount != null" class="amount">¥{{ invoice.amount.toFixed(2) }}</div>
        <div class="sub">{{ payLabel }}<span v-if="invoice.invoiceType"> · {{ typeLabel[invoice.invoiceType] }}</span></div>
      </div>
    </template>
  </Cell>
</template>
```

并把 `<style scoped>` 段替换为：

```vue
<style scoped>
.title-row { display: inline-flex; align-items: center; gap: 6px; }
.rownum { color: var(--van-gray-6); font-size: 13px; font-weight: 500; }
.meta { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
.amount { font-weight: 600; }
.sub { font-size: 12px; color: var(--van-gray-6); }
</style>
```

- [ ] **Step 3: AdminHomeView 列表也显示序号**

打开 `frontend/src/views/admin/AdminHomeView.vue`，找到 `<template #title>` 内的：

```vue
            <Checkbox :model-value="selected.has(inv.id)" shape="square" @click.stop="toggle(inv.id)" />
            <span @click.stop="open(inv.id)" style="margin-left: 8px;">
              {{ new Date(inv.createdAt).toLocaleDateString('zh-CN') }} · {{ inv.operatorUsername || '-' }}
            </span>
```

替换为：

```vue
            <Checkbox :model-value="selected.has(inv.id)" shape="square" @click.stop="toggle(inv.id)" />
            <span v-if="inv.rowNumber != null" class="rownum">#{{ inv.rowNumber }}</span>
            <span @click.stop="open(inv.id)" style="margin-left: 8px;">
              {{ new Date(inv.createdAt).toLocaleDateString('zh-CN') }} · {{ inv.operatorUsername || '-' }}
            </span>
```

并在 `<style scoped>` 块内添加规则（紧接现有 `.bottom-bar` 之后）：

```css
.rownum { color: var(--van-gray-6); font-size: 13px; font-weight: 500; margin-left: 8px; }
```

- [ ] **Step 4: 类型检查 + 手工验证**

Run: `cd frontend && npm run build`
Expected: 编译通过。

启动 `npm run dev`，在浏览器验证：
- 操作员列表每条左侧出现 `#1`、`#2` ……
- 翻页加载更多后，序号继续 `#21`、`#22` 不重置
- 下拉刷新后从 `#1` 开始
- 加筛选条件后序号从 1 起算
- 管理员列表左侧也出现 `#N`，与勾选框同行

- [ ] **Step 5: 提交**

```bash
git add frontend/src/types/api.ts frontend/src/components/InvoiceListItem.vue frontend/src/views/admin/AdminHomeView.vue
git commit -m "feat(frontend): 发票列表显示跨页连续序号"
```

---

# Feature 2 — 发票重复上传检测（SHA-256）

## Task 2.1：DB schema 与迁移

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260524100000_add_invoice_image_sha256/migration.sql`

- [ ] **Step 1: 改 Prisma schema**

打开 `backend/prisma/schema.prisma`，找到 `model InvoiceImage` 块：

```prisma
model InvoiceImage {
  id                BigInt   @id @default(autoincrement())
  invoiceId         BigInt   @map("invoice_id")
  ossKey            String   @map("oss_key") @db.VarChar(512)
  originalFilename  String   @map("original_filename") @db.VarChar(255)
  sizeBytes         Int      @map("size_bytes")
  uploadedAt        DateTime @default(now()) @map("uploaded_at")
  invoice           Invoice  @relation(fields: [invoiceId], references: [id])
  @@index([invoiceId])
  @@map("invoice_images")
}
```

替换为：

```prisma
model InvoiceImage {
  id                BigInt   @id @default(autoincrement())
  invoiceId         BigInt   @map("invoice_id")
  ossKey            String   @map("oss_key") @db.VarChar(512)
  originalFilename  String   @map("original_filename") @db.VarChar(255)
  sizeBytes         Int      @map("size_bytes")
  contentSha256     String?  @map("content_sha256") @db.Char(64)
  uploadedAt        DateTime @default(now()) @map("uploaded_at")
  invoice           Invoice  @relation(fields: [invoiceId], references: [id])
  @@index([invoiceId])
  @@index([contentSha256])
  @@map("invoice_images")
}
```

- [ ] **Step 2: 手写迁移 SQL 文件**

创建目录并新建 `backend/prisma/migrations/20260524100000_add_invoice_image_sha256/migration.sql`：

```sql
-- AddColumn
ALTER TABLE `invoice_images` ADD COLUMN `content_sha256` CHAR(64) NULL;

-- CreateIndex
CREATE INDEX `invoice_images_content_sha256_idx` ON `invoice_images`(`content_sha256`);
```

- [ ] **Step 3: 生成 Prisma client**

Run: `cd backend && npx prisma generate`
Expected: `✔ Generated Prisma Client` — `InvoiceImage` 类型上出现 `contentSha256: string | null`。

- [ ] **Step 4: 编译检查**

Run: `cd backend && npx tsc --noEmit`
Expected: 通过，无 type error。

- [ ] **Step 5: 提交**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260524100000_add_invoice_image_sha256/migration.sql
git commit -m "feat(db): 给 invoice_images 加 content_sha256 列与索引（用于查重）"
```

## Task 2.2：上传时查重（先写测试）

**Files:**
- Modify: `backend/src/invoices/invoices.service.spec.ts`
- Modify: `backend/src/invoices/invoices.service.ts`

- [ ] **Step 1: 调整测试 mockPrisma 以支持新行为**

打开 `backend/src/invoices/invoices.service.spec.ts`，找到顶部 `mockPrisma()` 函数（约第 8 行）。把 `invoiceImage: { create: jest.fn(), findUnique: jest.fn() },` 那行改为：

```ts
    invoiceImage: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
```

并把 `$transaction` 工厂中的 `invoiceImage` mock 改为支持 `findMany`：

把
```ts
      invoiceImage: { create: jest.fn().mockImplementation(({data}) => Promise.resolve({ id: BigInt(Math.floor(Math.random() * 1e9)), ...data })) },
```

替换为
```ts
      invoiceImage: {
        create: jest.fn().mockImplementation(({data}) => Promise.resolve({ id: BigInt(Math.floor(Math.random() * 1e9)), ...data })),
        findMany: jest.fn().mockResolvedValue([]),
      },
```

（在 `describe('InvoicesService.createByOperator', ...)` 块中，原有用例不会感知差异，因为默认 findMany 返 `[]`，duplicates 为空。）

- [ ] **Step 2: 写失败测试 — 命中 DB 中已有同 hash**

在 `describe('InvoicesService.createByOperator', ...)` 的现有用例（"creates an invoice..."）后面新增：

```ts
  it('flags duplicate when same content sha256 already exists in team', async () => {
    (ossStub.putObject as jest.Mock).mockResolvedValue(undefined);
    // 重新构造 $transaction，让内层 invoiceImage.findMany 返一个冲突
    prisma.$transaction = jest.fn(async (fn: any) => fn({
      invoice: { create: jest.fn().mockResolvedValue({ id: 100n, teamId: 1n, operatorId: 7n, paymentMethod: PaymentMethod.cash, status: InvoiceStatus.unprocessed, createdAt: new Date('2026-05-20T10:00:00Z'), updatedAt: new Date(), remark: null }) },
      invoiceImage: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: BigInt(Math.floor(Math.random() * 1e9)), ...data })),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 50n,
            invoiceId: 80n,
            contentSha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824', // sha256("hello")
            invoice: {
              id: 80n,
              createdAt: new Date('2026-05-10T08:00:00Z'),
              operator: { username: 'previousOp' },
            },
          },
        ]),
      },
      paymentProofImage: { create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: BigInt(Math.floor(Math.random() * 1e9)), ...data })) },
    }));

    const out = await svc.createByOperator(
      { teamId: 1n, operatorId: 7n },
      {
        paymentMethod: PaymentMethod.cash,
        invoiceImages: [
          { originalname: 'dup.jpg', mimetype: 'image/jpeg', buffer: Buffer.from('hello'), size: 5 },
        ],
        proofImages: [],
      },
    );

    expect(out.duplicates).toHaveLength(1);
    expect(out.duplicates[0].originalFilename).toBe('dup.jpg');
    expect(out.duplicates[0].conflictWith.invoiceId).toBe('80');
    expect(out.duplicates[0].conflictWith.operatorUsername).toBe('previousOp');
  });

  it('detects intra-batch duplicates (two files same content in one upload)', async () => {
    (ossStub.putObject as jest.Mock).mockResolvedValue(undefined);
    const out = await svc.createByOperator(
      { teamId: 1n, operatorId: 7n },
      {
        paymentMethod: PaymentMethod.cash,
        invoiceImages: [
          { originalname: 'a.jpg', mimetype: 'image/jpeg', buffer: Buffer.from('same-bytes'), size: 10 },
          { originalname: 'b.jpg', mimetype: 'image/jpeg', buffer: Buffer.from('same-bytes'), size: 10 },
        ],
        proofImages: [],
      },
    );
    expect(out.duplicates).toHaveLength(1);
    expect(out.duplicates[0].originalFilename).toBe('b.jpg');
    expect(out.duplicates[0].conflictWith.invoiceId).toBe('100'); // self
  });

  it('returns empty duplicates when no conflicts', async () => {
    (ossStub.putObject as jest.Mock).mockResolvedValue(undefined);
    const out = await svc.createByOperator(
      { teamId: 1n, operatorId: 7n },
      {
        paymentMethod: PaymentMethod.cash,
        invoiceImages: [{ originalname: 'a.jpg', mimetype: 'image/jpeg', buffer: Buffer.from('uniq'), size: 4 }],
        proofImages: [],
      },
    );
    expect(out.duplicates).toEqual([]);
  });
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd backend && npx jest invoices.service.spec.ts -t "duplicate" --no-coverage`
Expected: 3 个用例失败（`out.duplicates` 是 undefined）。

- [ ] **Step 4: 实现查重逻辑**

打开 `backend/src/invoices/invoices.service.ts`。

**在文件顶部 `import` 区**添加 Node `crypto`：

```ts
import * as crypto from 'crypto';
```

**新增辅助接口**（紧跟其他 export interface 后，约 `CreateInvoiceInput` 之后）：

```ts
export interface DuplicateInfo {
  imageIndex: number;
  originalFilename: string;
  conflictWith: {
    invoiceId: string;
    createdAt: Date;
    operatorUsername: string | null;
  };
}
```

**改 `createByOperator` 方法**：在事务块里，紧跟 `const invoice = await tx.invoice.create(...)` 之后、`for (const f of input.invoiceImages)` 循环之前，插入：

```ts
      // 计算本批 invoice image 的 sha256；先做批内去重，再查 DB
      const invoiceImageHashes = input.invoiceImages.map((f) => crypto.createHash('sha256').update(f.buffer).digest('hex'));
      const intraBatchSeen = new Map<string, number>(); // hash -> first index
      const intraBatchDup: DuplicateInfo[] = [];
      invoiceImageHashes.forEach((h, idx) => {
        if (intraBatchSeen.has(h)) {
          intraBatchDup.push({
            imageIndex: idx,
            originalFilename: input.invoiceImages[idx].originalname,
            conflictWith: {
              invoiceId: invoice.id.toString(),
              createdAt: invoice.createdAt,
              operatorUsername: null, // 由 controller 层不易拿到 username，这里返 null；前端可通过 "本次上传" 文案兜底
            },
          });
        } else {
          intraBatchSeen.set(h, idx);
        }
      });

      // DB 跨发票查重（按本团队、未软删）
      const uniqueHashes = Array.from(intraBatchSeen.keys());
      const dbHits = uniqueHashes.length > 0
        ? await tx.invoiceImage.findMany({
            where: {
              contentSha256: { in: uniqueHashes },
              invoice: { teamId: scope.teamId, deletedAt: null },
            },
            include: { invoice: { select: { id: true, createdAt: true, operator: { select: { username: true } } } } },
          })
        : [];
      const hashToHit = new Map<string, any>();
      for (const row of dbHits) {
        if (!hashToHit.has(row.contentSha256!)) hashToHit.set(row.contentSha256!, row);
      }
      const dbDup: DuplicateInfo[] = [];
      intraBatchSeen.forEach((firstIdx, h) => {
        const hit = hashToHit.get(h);
        if (hit) {
          dbDup.push({
            imageIndex: firstIdx,
            originalFilename: input.invoiceImages[firstIdx].originalname,
            conflictWith: {
              invoiceId: hit.invoice.id.toString(),
              createdAt: hit.invoice.createdAt,
              operatorUsername: hit.invoice.operator?.username ?? null,
            },
          });
        }
      });
      const duplicates: DuplicateInfo[] = [...dbDup, ...intraBatchDup].sort((a, b) => a.imageIndex - b.imageIndex);
```

**修改 invoice image 写入循环** — 找到原本的：

```ts
      const invoiceImageRows: { id: bigint; ossKey: string }[] = [];
      for (const f of input.invoiceImages) {
        const key = buildOssKey({ prefix: this.oss.getPrefix(), teamId: scope.teamId, invoiceId: invoice.id, kind: 'invoice', originalFilename: f.originalname });
        const row = await tx.invoiceImage.create({
          data: { invoiceId: invoice.id, ossKey: key, originalFilename: f.originalname, sizeBytes: f.size },
        });
        invoiceImageRows.push({ id: row.id as bigint, ossKey: key });
      }
```

替换为：

```ts
      const invoiceImageRows: { id: bigint; ossKey: string }[] = [];
      for (let i = 0; i < input.invoiceImages.length; i++) {
        const f = input.invoiceImages[i];
        const key = buildOssKey({ prefix: this.oss.getPrefix(), teamId: scope.teamId, invoiceId: invoice.id, kind: 'invoice', originalFilename: f.originalname });
        const row = await tx.invoiceImage.create({
          data: {
            invoiceId: invoice.id, ossKey: key,
            originalFilename: f.originalname, sizeBytes: f.size,
            contentSha256: invoiceImageHashes[i],
          },
        });
        invoiceImageRows.push({ id: row.id as bigint, ossKey: key });
      }
```

**修改事务返回结构** — 把 `return { invoice, invoiceImageRows, proofImageRows };` 改为：

```ts
      return { invoice, invoiceImageRows, proofImageRows, duplicates };
```

**修改最终返回** — 在方法末尾的 `return this.shapeInvoiceMinimal(...)` 之前改成：

把
```ts
    return this.shapeInvoiceMinimal(result.invoice, result.invoiceImageRows.length, result.proofImageRows.length);
```
替换为
```ts
    return {
      ...this.shapeInvoiceMinimal(result.invoice, result.invoiceImageRows.length, result.proofImageRows.length),
      duplicates: result.duplicates as DuplicateInfo[],
    };
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd backend && npx jest invoices.service.spec.ts --no-coverage`
Expected: 所有用例（含 3 个新 duplicate 用例）PASS。

- [ ] **Step 6: 提交**

```bash
git add backend/src/invoices/invoices.service.ts backend/src/invoices/invoices.service.spec.ts
git commit -m "feat(invoice): 上传发票图时基于 SHA-256 进行重复检测，命中则在响应中带 duplicates"
```

## Task 2.3：历史数据回填脚本

**Files:**
- Create: `backend/prisma/scripts/backfill-image-sha256.ts`

- [ ] **Step 1: 写脚本**

新建 `backend/prisma/scripts/backfill-image-sha256.ts`：

```ts
import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';
import * as OSS from 'ali-oss';

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

async function main() {
  const prisma = new PrismaClient();
  const client = new OSS({
    region: process.env.OSS_REGION!,
    accessKeyId: process.env.OSS_ACCESS_KEY_ID!,
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET!,
    bucket: process.env.OSS_BUCKET!,
    secure: true,
  });

  const batchSize = 50;
  let processed = 0;
  let lastId: bigint | undefined;

  while (true) {
    const rows: { id: bigint; ossKey: string }[] = await prisma.invoiceImage.findMany({
      where: { contentSha256: null, ...(lastId ? { id: { gt: lastId } } : {}) },
      orderBy: { id: 'asc' },
      take: batchSize,
      select: { id: true, ossKey: true },
    });
    if (rows.length === 0) break;

    for (const row of rows) {
      try {
        const result = await client.getStream(row.ossKey);
        const buf = await streamToBuffer(result.stream as NodeJS.ReadableStream);
        const hash = crypto.createHash('sha256').update(buf).digest('hex');
        await prisma.invoiceImage.update({ where: { id: row.id }, data: { contentSha256: hash } });
        processed++;
        if (processed % 50 === 0) console.log(`backfilled ${processed} images`);
      } catch (e) {
        console.error(`failed image id=${row.id} key=${row.ossKey}`, e);
      }
      lastId = row.id;
    }
  }
  console.log(`done. backfilled ${processed} images.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: 编译检查**

Run: `cd backend && npx tsc --noEmit -p tsconfig.json`
Expected: 通过。

- [ ] **Step 3: （可选，本地预演）**

需要本地连可访问 OSS + 已 migrate 的 DB 时：

```bash
cd backend && npx ts-node prisma/scripts/backfill-image-sha256.ts
```
Expected: 打印进度，无 error。

> 生产环境的回填步骤：先 `prisma migrate deploy` 落库结构变更；再 `node -r ts-node/register prisma/scripts/backfill-image-sha256.ts`（或先 build），脚本一次跑完即可。

- [ ] **Step 4: 提交**

```bash
git add backend/prisma/scripts/backfill-image-sha256.ts
git commit -m "chore(db): 一次性脚本回填历史 invoice_images.content_sha256"
```

## Task 2.4：前端类型与上传后提示

**Files:**
- Modify: `frontend/src/types/api.ts`
- Modify: `frontend/src/api/invoices.ts`
- Modify: `frontend/src/views/operator/OperatorUploadView.vue`

- [ ] **Step 1: 类型**

打开 `frontend/src/types/api.ts`，在 `InvoiceListResponse` 接口的定义后添加：

```ts
export interface DuplicateInfo {
  imageIndex: number;
  originalFilename: string;
  conflictWith: {
    invoiceId: string;
    createdAt: string;
    operatorUsername: string | null;
  };
}

export interface CreateInvoiceResponse extends InvoiceFull {
  duplicates: DuplicateInfo[];
}
```

（`InvoiceFull` 的部分字段对 minimal 返回不一定有，但前端目前只关心 `id` 与 `duplicates`，所以兼容。）

- [ ] **Step 2: API 客户端返回类型**

打开 `frontend/src/api/invoices.ts`，把 `myCreate` 一行：

```ts
  myCreate: (form: FormData) => api.post<InvoiceFull>('/api/op/invoices', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
```

替换为：

```ts
  myCreate: (form: FormData) => api.post<CreateInvoiceResponse>('/api/op/invoices', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
```

并把顶部 import 语句里的 type 列表更新为包含 `CreateInvoiceResponse`：找到

```ts
import type {
  ExportImageMode, ExportManifest, InvoiceFull, InvoiceListResponse, InvoiceType, PaymentMethod,
} from '@/types/api';
```

替换为

```ts
import type {
  CreateInvoiceResponse, ExportImageMode, ExportManifest, InvoiceFull, InvoiceListResponse, InvoiceType, PaymentMethod,
} from '@/types/api';
```

- [ ] **Step 3: 上传成功后弹查重提示**

打开 `frontend/src/views/operator/OperatorUploadView.vue`，把 `<script setup lang="ts">` 段中的 `import` 那一行：

```ts
import { Button, Cell, CellGroup, Field, RadioGroup, Radio, Uploader, showToast, type UploaderFileListItem } from 'vant';
```

替换为：

```ts
import { Button, Cell, CellGroup, Field, RadioGroup, Radio, Uploader, showDialog, showToast, type UploaderFileListItem } from 'vant';
```

把 `onSubmit` 函数末尾的 try 块：

```ts
  try {
    const inv = await invoicesApi.myCreate(fd);
    showToast({ type: 'success', message: '上传成功' });
    router.replace({ name: 'op-detail', params: { id: inv.id } });
  } catch (e: any) {
```

替换为：

```ts
  try {
    const inv = await invoicesApi.myCreate(fd);
    if (inv.duplicates && inv.duplicates.length > 0) {
      const lines = inv.duplicates.map((d) => {
        const isSelf = d.conflictWith.invoiceId === inv.id;
        const who = d.conflictWith.operatorUsername || (isSelf ? '本次上传' : '其他人');
        const when = new Date(d.conflictWith.createdAt).toLocaleDateString('zh-CN');
        return `• ${d.originalFilename}：与发票 #${d.conflictWith.invoiceId}（${when} 由 ${who} 上传）重复`;
      }).join('\n');
      await showDialog({
        title: '检测到重复发票图',
        message: `${lines}\n\n已为您保留，请核实是否重复报销。`,
      });
    } else {
      showToast({ type: 'success', message: '上传成功' });
    }
    router.replace({ name: 'op-detail', params: { id: inv.id } });
  } catch (e: any) {
```

- [ ] **Step 4: 类型检查**

Run: `cd frontend && npm run build`
Expected: 编译通过。

- [ ] **Step 5: 手工验证**

启动 `npm run dev` + 后端 dev。在浏览器测试：
- 上传一张全新发票图：toast"上传成功"，跳转详情
- 把同一张图（不改名）再上传一次：弹 dialog 提示与发票 #X 重复，关闭后跳转详情，列表里能看到新发票
- 同一上传里选两张同样的图：dialog 提示批内重复，conflictWith 指向新发票自己

- [ ] **Step 6: 提交**

```bash
git add frontend/src/types/api.ts frontend/src/api/invoices.ts frontend/src/views/operator/OperatorUploadView.vue
git commit -m "feat(frontend): 上传发票后若命中重复图片，弹窗提示用户"
```

---

## 完工后的整体校验

- [ ] 后端测试全过：

Run: `cd backend && npm test`
Expected: 全部 PASS。

- [ ] 前端类型检查通过：

Run: `cd frontend && npm run build`
Expected: dist 生成成功，无 type error。

- [ ] git log 检查每个特性独立 commit：

Run: `git log --oneline -8`
Expected: 看到 5–6 个本计划新增的 commit（操作员自改、rowNumber 后端、rowNumber 前端、加 sha256 列、查重逻辑、回填脚本、前端提示）。
