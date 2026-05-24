<script setup lang="ts">
import { onActivated, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ActionSheet, Button, Cell, CellGroup, Checkbox, Empty, List, PullRefresh, Tag, showToast, showConfirmDialog } from 'vant';
import InvoiceFilterBar from '@/components/InvoiceFilterBar.vue';
import { invoicesApi } from '@/api/invoices';
import type { ExportImageMode, InvoiceFull } from '@/types/api';

const router = useRouter();
const items = ref<InvoiceFull[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 30;
const loading = ref(false);
const finished = ref(false);
const refreshing = ref(false);
const filters = ref<any>({});
const selected = ref<Set<string>>(new Set());

const exportSheetShow = ref(false);
const exportActions = [
  { name: '仅 Excel + 发票图片 ZIP', mode: 'invoice_only' as ExportImageMode },
  { name: '仅 Excel + 支付凭证 ZIP', mode: 'proof_only' as ExportImageMode },
  { name: 'Excel + 发票图片 ZIP + 支付凭证 ZIP', mode: 'both' as ExportImageMode },
];

async function load() {
  loading.value = true;
  try {
    const res = await invoicesApi.adminList({ ...filters.value, page: page.value, pageSize });
    if (page.value === 1) items.value = res.items;
    else items.value.push(...res.items);
    total.value = res.total;
    if (items.value.length >= total.value) finished.value = true;
    else page.value += 1;
  } finally {
    loading.value = false;
  }
}

async function onRefresh() {
  page.value = 1; finished.value = false; items.value = [];
  refreshing.value = true; await load(); refreshing.value = false;
}

watch(filters, () => onRefresh(), { deep: true });
onActivated(() => { onRefresh(); });
load();

function toggle(id: string) {
  if (selected.value.has(id)) selected.value.delete(id);
  else selected.value.add(id);
  selected.value = new Set(selected.value);
}

function selectAllOnPage() {
  if (allOnPageSelected()) {
    items.value.forEach((it) => selected.value.delete(it.id));
  } else {
    items.value.forEach((it) => selected.value.add(it.id));
  }
  selected.value = new Set(selected.value);
}

function allOnPageSelected() {
  return items.value.length > 0 && items.value.every((it) => selected.value.has(it.id));
}

async function onBatchProcess() {
  if (selected.value.size === 0) { showToast({ type: 'fail', message: '请先勾选' }); return; }
  try {
    await showConfirmDialog({ title: `确认标记 ${selected.value.size} 张为已处理？`, cancelButtonText: '取消', confirmButtonText: '确定' });
  } catch { return; }
  try {
    const res = await invoicesApi.adminBatchProcess([...selected.value]);
    showToast({ type: 'success', message: `已处理 ${res.count} 张` });
    selected.value.clear();
    onRefresh();
  } catch (e: any) {
    showToast({ type: 'fail', message: e.response?.data?.message || '操作失败' });
  }
}

async function onPickExport(mode: ExportImageMode) {
  exportSheetShow.value = false;
  if (selected.value.size === 0) { showToast({ type: 'fail', message: '请先勾选' }); return; }
  let alsoMark = false;
  try {
    await showConfirmDialog({ title: '导出后自动标记为已处理？', cancelButtonText: '不标记', confirmButtonText: '同时标记' });
    alsoMark = true;
  } catch { alsoMark = false; }
  try {
    const manifest = await invoicesApi.adminExport([...selected.value], mode, alsoMark);
    for (const part of manifest.parts) {
      const a = document.createElement('a');
      a.href = part.href; a.download = part.filename; document.body.appendChild(a); a.click(); a.remove();
      await new Promise((r) => setTimeout(r, 200));
    }
    showToast({ type: 'success', message: '开始下载' });
    if (alsoMark) onRefresh();
  } catch (e: any) {
    showToast({ type: 'fail', message: e.response?.data?.message || '导出失败' });
  }
}

function open(id: string) { router.push({ name: 'admin-detail', params: { id } }); }

const typeLabel: Record<string, string> = { catering: '餐饮', fuel: '油票', consumable: '耗材', printing: '打印', other: '其它' };
</script>

<template>
  <div>
    <InvoiceFilterBar v-model="filters" />

    <CellGroup inset>
      <Cell>
        <template #title>
          已勾选 <strong>{{ selected.size }}</strong> 张 / 当前页 {{ items.length }} 张
        </template>
        <template #right-icon>
          <Checkbox :model-value="allOnPageSelected()" shape="square" @click="selectAllOnPage">全选本页</Checkbox>
        </template>
      </Cell>
    </CellGroup>

    <PullRefresh v-model="refreshing" @refresh="onRefresh">
      <List v-model:loading="loading" :finished="finished" finished-text="没有更多了" @load="load">
        <Cell v-for="inv in items" :key="inv.id" is-link clickable>
          <template #title>
            <Checkbox :model-value="selected.has(inv.id)" shape="square" @click.stop="toggle(inv.id)" />
            <span v-if="inv.rowNumber != null" class="rownum">#{{ inv.rowNumber }}</span>
            <span @click.stop="open(inv.id)" style="margin-left: 8px;">
              {{ new Date(inv.createdAt).toLocaleDateString('zh-CN') }} · {{ inv.operatorUsername || '-' }}
            </span>
          </template>
          <template #label>
            <span @click.stop="open(inv.id)">
              {{ inv.paymentMethod === 'cash' ? '现金' : '线上' }}
              <template v-if="inv.invoiceType"> · {{ typeLabel[inv.invoiceType] }}</template>
              <template v-if="inv.amount != null"> · ¥{{ inv.amount.toFixed(2) }}</template>
              <template v-if="inv.remark"> · {{ inv.remark }}</template>
            </span>
          </template>
          <template #right-icon>
            <Tag :type="inv.status === 'processed' ? 'success' : 'warning'" size="medium">
              {{ inv.status === 'processed' ? '已处理' : '未处理' }}
            </Tag>
          </template>
        </Cell>
        <Empty v-if="!loading && items.length === 0" description="暂无发票" />
      </List>
    </PullRefresh>

    <div class="bottom-bar">
      <Button block type="primary" @click="onBatchProcess">批量标记已处理</Button>
      <Button block type="success" @click="exportSheetShow = true">导出</Button>
    </div>

    <ActionSheet v-model:show="exportSheetShow" :actions="exportActions.map(a => ({ name: a.name, callback: () => onPickExport(a.mode) }))" cancel-text="取消" />
  </div>
</template>

<style scoped>
.bottom-bar { position: fixed; bottom: 50px; left: 0; right: 0; max-width: var(--max-content-width); margin: 0 auto; display: flex; gap: 8px; padding: 8px; background: white; border-top: 1px solid var(--van-border-color); z-index: 1; }
.rownum { color: var(--van-gray-6); font-size: 13px; font-weight: 500; margin-left: 8px; }
</style>
