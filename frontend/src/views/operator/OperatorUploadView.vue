<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Button, Cell, CellGroup, Field, RadioGroup, Radio, Uploader, showToast, type UploaderFileListItem } from 'vant';
import { invoicesApi } from '@/api/invoices';

const router = useRouter();
const form = reactive({ paymentMethod: 'cash' as 'cash' | 'online', remark: '' });
const invoiceFiles = ref<UploaderFileListItem[]>([]);
const proofFiles = ref<UploaderFileListItem[]>([]);
const submitting = ref(false);

const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif',
  'image/heic', 'image/heif', 'image/tiff', 'image/bmp',
  'application/pdf',
  'application/octet-stream', // 部分浏览器对 HEIC 报这个，靠扩展名兜底
]);
const ALLOWED_EXT = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif', '.tif', '.tiff', '.bmp', '.pdf',
]);
const MAX = 20 * 1024 * 1024;

function validate(file: File | File[]) {
  const files = Array.isArray(file) ? file : [file];
  for (const f of files) {
    const ext = '.' + (f.name.split('.').pop() ?? '').toLowerCase();
    if (!ALLOWED_MIME.has(f.type) && !ALLOWED_EXT.has(ext)) {
      showToast({ type: 'fail', message: `不支持的文件: ${f.name}（${f.type || '未知类型'}）` });
      return false;
    }
    if (f.size > MAX) { showToast({ type: 'fail', message: `文件超过 20MB: ${f.name}` }); return false; }
  }
  return true;
}

async function onSubmit() {
  if (invoiceFiles.value.length === 0) { showToast({ type: 'fail', message: '请上传至少 1 张发票图片' }); return; }
  if (proofFiles.value.length === 0) { showToast({ type: 'fail', message: '请上传至少 1 张支付凭证' }); return; }
  submitting.value = true;
  const fd = new FormData();
  fd.append('paymentMethod', form.paymentMethod);
  if (form.remark) fd.append('remark', form.remark);
  for (const f of invoiceFiles.value) if (f.file) fd.append('invoiceImages', f.file, f.file.name);
  for (const f of proofFiles.value) if (f.file) fd.append('proofImages', f.file, f.file.name);
  try {
    const inv = await invoicesApi.myCreate(fd);
    showToast({ type: 'success', message: '上传成功' });
    router.replace({ name: 'op-detail', params: { id: inv.id } });
  } catch (e: any) {
    showToast({ type: 'fail', message: e.response?.data?.message || '上传失败' });
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="upload-wrap">
    <CellGroup inset title="支付方式">
      <Cell>
        <RadioGroup v-model="form.paymentMethod" direction="horizontal">
          <Radio name="cash">现金</Radio>
          <Radio name="online">线上</Radio>
        </RadioGroup>
      </Cell>
    </CellGroup>

    <CellGroup inset title="发票（图片或 PDF）">
      <Cell>
        <Uploader v-model="invoiceFiles" multiple :max-count="10" :before-read="validate" accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,image/tiff,image/bmp,application/pdf,.jpg,.jpeg,.png,.webp,.gif,.heic,.heif,.tiff,.tif,.bmp,.pdf" />
      </Cell>
    </CellGroup>

    <CellGroup inset title="支付凭证（图片或 PDF）">
      <Cell>
        <Uploader v-model="proofFiles" multiple :max-count="10" :before-read="validate" accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,image/tiff,image/bmp,application/pdf,.jpg,.jpeg,.png,.webp,.gif,.heic,.heif,.tiff,.tif,.bmp,.pdf" />
      </Cell>
    </CellGroup>

    <CellGroup inset title="备注（可选）">
      <Field v-model="form.remark" rows="2" autosize type="textarea" placeholder="例如：午餐、加油、办公耗材..." maxlength="200" show-word-limit />
    </CellGroup>

    <div style="margin: 16px;">
      <Button block type="primary" :loading="submitting" @click="onSubmit">提交</Button>
    </div>
  </div>
</template>

<style scoped>
.upload-wrap { padding-bottom: 24px; }
</style>
