<script setup lang="ts">
import { computed } from 'vue';
import { Cell, Tag } from 'vant';
import type { InvoiceFull } from '@/types/api';

const props = defineProps<{ invoice: InvoiceFull }>();

const typeLabel: Record<string, string> = { catering: '餐饮', fuel: '油票', consumable: '耗材', printing: '打印', other: '其它' };
const payLabel = computed(() => props.invoice.paymentMethod === 'cash' ? '现金' : '线上');
const statusLabel = computed(() => props.invoice.status === 'processed' ? '已处理' : '未处理');
const dateLabel = computed(() => new Date(props.invoice.createdAt).toLocaleString('zh-CN', { hour12: false }));
</script>

<template>
  <Cell is-link :title="dateLabel" :label="invoice.remark || ''">
    <template #right-icon>
      <div class="meta">
        <Tag :type="invoice.status === 'processed' ? 'success' : 'warning'" size="medium">{{ statusLabel }}</Tag>
        <div v-if="invoice.amount != null" class="amount">¥{{ invoice.amount.toFixed(2) }}</div>
        <div class="sub">{{ payLabel }}<span v-if="invoice.invoiceType"> · {{ typeLabel[invoice.invoiceType] }}</span></div>
      </div>
    </template>
  </Cell>
</template>

<style scoped>
.meta { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
.amount { font-weight: 600; }
.sub { font-size: 12px; color: var(--van-gray-6); }
</style>
