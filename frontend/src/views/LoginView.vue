<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Button, CellGroup, Field, Form, showToast } from 'vant';
import { useAuthStore } from '@/stores/auth';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const form = reactive({ username: '', password: '' });
const submitting = ref(false);

async function onSubmit() {
  submitting.value = true;
  try {
    const res = await auth.login(form.username, form.password);
    const redirect = (route.query.redirect as string | undefined) || '/';
    if (res.mustChangePassword) router.replace('/change-password');
    else router.replace(redirect);
  } catch (e: any) {
    showToast({ type: 'fail', message: e.response?.data?.message || '登录失败' });
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="login-wrap">
    <h1 class="title">项目团队发票管理系统</h1>
    <Form @submit="onSubmit">
      <CellGroup inset>
        <Field v-model="form.username" name="username" label="账号" placeholder="账号" :rules="[{ required: true, message: '请输入账号' }]" autocomplete="username" />
        <Field v-model="form.password" type="password" name="password" label="密码" placeholder="密码" :rules="[{ required: true, message: '请输入密码' }]" autocomplete="current-password" />
      </CellGroup>
      <div style="margin: 16px;">
        <Button block type="primary" native-type="submit" :loading="submitting">登录</Button>
      </div>
    </Form>
  </div>
</template>

<style scoped>
.login-wrap { padding: 32px 0; max-width: var(--max-content-width); margin: 0 auto; }
.title { text-align: center; margin: 32px 0; font-size: 24px; }
</style>
