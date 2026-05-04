<script setup lang="ts">
import { reactive, watch } from 'vue';
import { Cell, CellGroup } from 'vant';

interface Filters {
  status?: string; invoiceType?: string; paymentMethod?: string;
  fromDate?: string; toDate?: string; amountRegistered?: string;
}
const props = defineProps<{ modelValue: Filters }>();
const emit = defineEmits<{ (e: 'update:modelValue', v: Filters): void }>();
const local = reactive<Filters>({ ...props.modelValue });

const STATUS = [{ text: '全部', value: '' }, { text: '未处理', value: 'unprocessed' }, { text: '已处理', value: 'processed' }];
const TYPE = [{ text: '全部', value: '' }, { text: '餐饮', value: 'catering' }, { text: '油票', value: 'fuel' }, { text: '耗材', value: 'consumable' }, { text: '打印', value: 'printing' }, { text: '其它', value: 'other' }];
const PAY = [{ text: '全部', value: '' }, { text: '现金', value: 'cash' }, { text: '线上', value: 'online' }];
const REG = [{ text: '全部', value: '' }, { text: '已登记金额', value: 'true' }, { text: '未登记金额', value: 'false' }];

function emitChange() {
  const out: Filters = {};
  for (const k of Object.keys(local) as (keyof Filters)[]) {
    if (local[k]) out[k] = local[k] as any;
  }
  emit('update:modelValue', out);
}
watch(local, emitChange, { deep: true });
</script>

<template>
  <CellGroup inset title="筛选">
    <Cell title="状态">
      <select v-model="local.status">
        <option v-for="o in STATUS" :key="o.value" :value="o.value">{{ o.text }}</option>
      </select>
    </Cell>
    <Cell title="发票类型">
      <select v-model="local.invoiceType">
        <option v-for="o in TYPE" :key="o.value" :value="o.value">{{ o.text }}</option>
      </select>
    </Cell>
    <Cell title="支付方式">
      <select v-model="local.paymentMethod">
        <option v-for="o in PAY" :key="o.value" :value="o.value">{{ o.text }}</option>
      </select>
    </Cell>
    <Cell title="金额是否登记">
      <select v-model="local.amountRegistered">
        <option v-for="o in REG" :key="o.value" :value="o.value">{{ o.text }}</option>
      </select>
    </Cell>
    <Cell title="开始日期">
      <input type="date" v-model="local.fromDate" />
    </Cell>
    <Cell title="结束日期">
      <input type="date" v-model="local.toDate" />
    </Cell>
  </CellGroup>
</template>

<style scoped>
select, input[type=date] { font-size: 14px; padding: 4px 8px; }
</style>
