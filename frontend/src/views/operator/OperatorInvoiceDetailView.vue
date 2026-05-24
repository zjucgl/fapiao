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
