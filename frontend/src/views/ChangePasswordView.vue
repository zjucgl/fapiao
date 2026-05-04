<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Button, CellGroup, Field, Form, showToast } from 'vant';
import { useAuthStore } from '@/stores/auth';

const router = useRouter();
const auth = useAuthStore();

const form = reactive({ currentPassword: '', newPassword: '', confirmPassword: '' });
const submitting = ref(false);

async function onSubmit() {
  if (form.newPassword !== form.confirmPassword) {
    showToast({ type: 'fail', message: '两次输入的新密码不一致' });
    return;
  }
  if (form.newPassword.length < 8 || !/[A-Za-z]/.test(form.newPassword) || !/[0-9]/.test(form.newPassword)) {
    showToast({ type: 'fail', message: '新密码至少 8 位且含字母与数字' });
    return;
  }
  submitting.value = true;
  try {
    await auth.changePassword(form.currentPassword, form.newPassword);
    showToast({ type: 'success', message: '密码已更新' });
    router.replace('/');
  } catch (e: any) {
    showToast({ type: 'fail', message: e.response?.data?.message || '修改失败' });
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="cp-wrap">
    <h1 class="title">首次登录请改密</h1>
    <Form @submit="onSubmit">
      <CellGroup inset>
        <Field v-model="form.currentPassword" type="password" label="当前密码" placeholder="当前密码" :rules="[{ required: true, message: '请输入当前密码' }]" />
        <Field v-model="form.newPassword" type="password" label="新密码" placeholder="≥ 8 位且含字母数字" :rules="[{ required: true, message: '请输入新密码' }]" />
        <Field v-model="form.confirmPassword" type="password" label="确认新密码" placeholder="再输入一次" :rules="[{ required: true, message: '请确认新密码' }]" />
      </CellGroup>
      <div style="margin: 16px;">
        <Button block type="primary" native-type="submit" :loading="submitting">提交</Button>
      </div>
    </Form>
  </div>
</template>

<style scoped>
.cp-wrap { padding: 16px 0; max-width: var(--max-content-width); margin: 0 auto; }
.title { text-align: center; margin: 24px 0; font-size: 20px; }
</style>
