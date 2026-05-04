<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { Button, Cell, CellGroup, Field, Picker, Popup, Tag, showToast } from 'vant';
import ImageThumbGrid from '@/components/ImageThumbGrid.vue';
import { invoicesApi } from '@/api/invoices';
import type { InvoiceFull, InvoiceType } from '@/types/api';

const route = useRoute();
const id = route.params.id as string;
const inv = ref<InvoiceFull | null>(null);
const editing = reactive({ amount: '' as string | number, invoiceType: '' as InvoiceType | '' });
const saving = ref(false);
const showTypePicker = ref(false);

const TYPE_OPTS = [
  { text: '餐饮', value: 'catering' },
  { text: '油票', value: 'fuel' },
  { text: '耗材', value: 'consumable' },
  { text: '打印', value: 'printing' },
  { text: '其它', value: 'other' },
];
const typeLabel: Record<string, string> = Object.fromEntries(TYPE_OPTS.map((o) => [o.value, o.text]));

async function load() {
  inv.value = await invoicesApi.adminDetail(id);
  editing.amount = inv.value.amount ?? '';
  editing.invoiceType = (inv.value.invoiceType ?? '') as InvoiceType | '';
}

async function save() {
  saving.value = true;
  try {
    const dto: any = {};
    if (editing.amount !== '') dto.amount = Number(editing.amount);
    if (editing.invoiceType) dto.invoiceType = editing.invoiceType;
    inv.value = await invoicesApi.adminRegister(id, dto);
    showToast({ type: 'success', message: '已保存' });
  } catch (e: any) {
    showToast({ type: 'fail', message: e.response?.data?.message || '保存失败' });
  } finally {
    saving.value = false;
  }
}

function pickType(v: { selectedValues: string[] }) {
  editing.invoiceType = v.selectedValues[0] as InvoiceType;
  showTypePicker.value = false;
}

onMounted(load);
</script>

<template>
  <div v-if="inv">
    <CellGroup inset title="基本信息">
      <Cell title="录入日期" :value="new Date(inv.createdAt).toLocaleString('zh-CN', { hour12: false })" />
      <Cell title="操作员" :value="inv.operatorUsername || '-'" />
      <Cell title="支付方式" :value="inv.paymentMethod === 'cash' ? '现金' : '线上'" />
      <Cell title="状态">
        <Tag :type="inv.status === 'processed' ? 'success' : 'warning'">
          {{ inv.status === 'processed' ? '已处理' : '未处理' }}
        </Tag>
      </Cell>
      <Cell v-if="inv.remark" title="备注" :value="inv.remark" />
    </CellGroup>

    <CellGroup inset title="登记">
      <Field v-model="editing.amount" type="number" label="金额" placeholder="0.00" />
      <Cell title="发票类型" is-link :value="editing.invoiceType ? typeLabel[editing.invoiceType] : '请选择'" @click="showTypePicker = true" />
    </CellGroup>

    <div style="margin: 16px;">
      <Button block type="primary" :loading="saving" @click="save">保存登记</Button>
    </div>

    <CellGroup inset title="发票图片">
      <ImageThumbGrid :invoice-id="inv.id" :images="inv.invoiceImages" kind="invoice" :sign-fn="invoicesApi.signInvoiceImage" />
    </CellGroup>

    <CellGroup inset title="支付凭证">
      <ImageThumbGrid :invoice-id="inv.id" :images="inv.proofImages" kind="proof" :sign-fn="invoicesApi.signProofImage" />
    </CellGroup>

    <Popup v-model:show="showTypePicker" round position="bottom">
      <Picker title="选择发票类型" :columns="TYPE_OPTS" @confirm="pickType" @cancel="showTypePicker = false" />
    </Popup>
  </div>
</template>
