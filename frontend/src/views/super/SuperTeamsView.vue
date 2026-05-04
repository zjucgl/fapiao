<script setup lang="ts">
import { onActivated, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Button, Cell, CellGroup, Empty, Field, Form, Popup, Tag, showToast, showConfirmDialog } from 'vant';
import { teamsApi } from '@/api/teams';
import type { Team } from '@/types/api';

const router = useRouter();
const teams = ref<Team[]>([]);
const showCreate = ref(false);
const form = reactive({ name: '' });
const submitting = ref(false);

async function load() { teams.value = await teamsApi.list(); }

async function onCreate() {
  if (!form.name) { showToast({ type: 'fail', message: '请输入团队名' }); return; }
  submitting.value = true;
  try {
    await teamsApi.create(form.name);
    showToast({ type: 'success', message: '已创建' });
    showCreate.value = false; form.name = '';
    load();
  } catch (e: any) {
    showToast({ type: 'fail', message: e.response?.data?.message || '创建失败' });
  } finally {
    submitting.value = false;
  }
}

async function toggle(t: Team) {
  const next = t.status === 'active' ? 'disabled' : 'active';
  try {
    await showConfirmDialog({ title: `${next === 'active' ? '启用' : '停用'} ${t.name}？`, cancelButtonText: '取消', confirmButtonText: '确定' });
  } catch { return; }
  try { await teamsApi.update(t.id, { status: next }); showToast({ type: 'success', message: '已更新' }); load(); }
  catch (e: any) { showToast({ type: 'fail', message: e.response?.data?.message || '失败' }); }
}

function open(t: Team) { router.push({ name: 'super-team-admins', params: { teamId: t.id } }); }

onActivated(load);
load();
</script>

<template>
  <div>
    <div style="margin: 16px;">
      <Button block type="primary" @click="showCreate = true">+ 新建团队</Button>
    </div>

    <CellGroup inset>
      <Cell v-for="t in teams" :key="t.id" is-link :title="t.name" :label="`创建于 ${new Date(t.createdAt).toLocaleDateString('zh-CN')}`" @click="open(t)">
        <template #right-icon>
          <Tag :type="t.status === 'active' ? 'success' : 'danger'" size="medium" style="margin-right: 8px;">
            {{ t.status === 'active' ? '启用' : '停用' }}
          </Tag>
          <Button size="mini" plain :type="t.status === 'active' ? 'danger' : 'success'" @click.stop="toggle(t)">
            {{ t.status === 'active' ? '停用' : '启用' }}
          </Button>
        </template>
      </Cell>
      <Empty v-if="teams.length === 0" description="还没有团队" />
    </CellGroup>

    <Popup v-model:show="showCreate" round position="bottom" :style="{ height: '40%' }">
      <div style="padding: 16px;">
        <h3>新建团队</h3>
        <Form>
          <CellGroup inset>
            <Field v-model="form.name" label="团队名" placeholder="不可重复" />
          </CellGroup>
          <div style="margin-top: 16px;">
            <Button block type="primary" :loading="submitting" @click="onCreate">创建</Button>
          </div>
        </Form>
      </div>
    </Popup>
  </div>
</template>
