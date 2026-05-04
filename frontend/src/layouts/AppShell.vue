<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { NavBar, Tabbar, TabbarItem, Dialog } from 'vant';
import { useAuthStore } from '@/stores/auth';

const router = useRouter();
const auth = useAuthStore();
const role = computed(() => auth.user?.role);

const tabs = computed(() => {
  if (role.value === 'operator') {
    return [
      { name: 'op-home', label: '我的发票', icon: 'orders-o' },
      { name: 'op-upload', label: '上传', icon: 'plus' },
    ];
  }
  if (role.value === 'team_admin') {
    return [
      { name: 'admin-home', label: '发票', icon: 'orders-o' },
      { name: 'admin-operators', label: '操作员', icon: 'friends-o' },
    ];
  }
  return [
    { name: 'super-teams', label: '团队', icon: 'cluster-o' },
  ];
});

async function onLogout() {
  await Dialog.confirm({ title: '确认退出？', cancelButtonText: '取消', confirmButtonText: '退出' }).catch(() => null);
  auth.logout();
  router.push('/login');
}
</script>

<template>
  <div class="app-shell">
    <NavBar :title="'fapiao'" right-text="退出" @click-right="onLogout" />
    <main class="content">
      <router-view />
    </main>
    <Tabbar route>
      <TabbarItem v-for="t in tabs" :key="t.name" :to="{ name: t.name }" :icon="t.icon">
        {{ t.label }}
      </TabbarItem>
    </Tabbar>
  </div>
</template>

<style scoped>
.app-shell { display: flex; flex-direction: column; min-height: 100%; max-width: var(--max-content-width); margin: 0 auto; width: 100%; }
.content { flex: 1; padding-bottom: 60px; }
</style>
