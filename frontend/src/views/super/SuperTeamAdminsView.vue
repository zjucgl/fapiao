<script setup lang="ts">
import { onActivated, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { Button, Cell, CellGroup, Empty, Field, Form, Popup, Tag, showToast, showConfirmDialog } from 'vant';
import { usersApi } from '@/api/users';
import type { UserRow } from '@/types/api';

const route = useRoute();
const teamId = route.params.teamId as string;
const admins = ref<UserRow[]>([]);
const showCreate = ref(false);
const form = reactive({ username: '', initialPassword: '' });
const submitting = ref(false);

async function load() { admins.value = await usersApi.listTeamAdmins(teamId); }

async function onCreate() {
  if (form.username.length < 3 || form.initialPassword.length < 8) { showToast({ type: 'fail', message: '账号 ≥ 3 位，密码 ≥ 8 位' }); return; }
  submitting.value = true;
  try {
    await usersApi.createTeamAdmin(teamId, { ...form });
    showToast({ type: 'success', message: '已创建' });
    showCreate.value = false; form.username = ''; form.initialPassword = '';
    load();
  } catch (e: any) { showToast({ type: 'fail', message: e.response?.data?.message || '创建失败' }); }
  finally { submitting.value = false; }
}

async function toggleStatus(u: UserRow) {
  const next = u.status === 'active' ? 'disabled' : 'active';
  try {
    await showConfirmDialog({ title: `${next === 'active' ? '启用' : '停用'} ${u.username}？`, cancelButtonText: '取消', confirmButtonText: '确定' });
  } catch { return; }
  try { await usersApi.setTeamAdminStatus(teamId, u.id, next); showToast({ type: 'success', message: '已更新' }); load(); }
  catch (e: any) { showToast({ type: 'fail', message: e.response?.data?.message || '失败' }); }
}

async function resetPwd(u: UserRow) {
  const pwd = prompt(`为 ${u.username} 设置新密码（≥ 8 位）`);
  if (!pwd || pwd.length < 8) return;
  try { await usersApi.resetTeamAdminPassword(teamId, u.id, pwd); showToast({ type: 'success', message: '已重置密码' }); }
  catch (e: any) { showToast({ type: 'fail', message: e.response?.data?.message || '操作失败' }); }
}

onActivated(load);
load();
</script>

<template>
  <div>
    <div style="margin: 16px;">
      <Button block type="primary" @click="showCreate = true">+ 新建团队管理员</Button>
    </div>

    <CellGroup inset>
      <Cell v-for="u in admins" :key="u.id" :title="u.username" :label="`创建于 ${new Date(u.createdAt).toLocaleDateString('zh-CN')}`">
        <template #right-icon>
          <Tag :type="u.status === 'active' ? 'success' : 'danger'" size="medium" style="margin-right: 8px;">{{ u.status === 'active' ? '启用' : '停用' }}</Tag>
          <Button size="mini" plain @click="resetPwd(u)">重置密码</Button>
          <Button size="mini" plain :type="u.status === 'active' ? 'danger' : 'success'" @click="toggleStatus(u)" style="margin-left: 4px;">{{ u.status === 'active' ? '停用' : '启用' }}</Button>
        </template>
      </Cell>
      <Empty v-if="admins.length === 0" description="该团队还没有管理员" />
    </CellGroup>

    <Popup v-model:show="showCreate" round position="bottom" :style="{ height: '60%' }">
      <div style="padding: 16px;">
        <h3>新建团队管理员</h3>
        <Form>
          <CellGroup inset>
            <Field v-model="form.username" label="账号" placeholder="3–64 位 字母数字 . _ -" />
            <Field v-model="form.initialPassword" type="password" label="初始密码" placeholder="≥ 8 位" />
          </CellGroup>
          <div style="margin-top: 16px;">
            <Button block type="primary" :loading="submitting" @click="onCreate">创建</Button>
          </div>
        </Form>
      </div>
    </Popup>
  </div>
</template>
