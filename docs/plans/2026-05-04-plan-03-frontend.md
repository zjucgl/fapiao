# Plan 03 — Frontend (M5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Build a responsive web UI on top of the M1–M4 backend so super_admin / team_admin / operator can do everything via browser on both PC and mobile.

**Architecture:** Single-page app with Vue 3 (Composition API + `<script setup>`), Vant 4 (mobile-first component library that also looks fine on PC), Pinia for state, Vue Router 4 with role-aware nav guards, Axios with auto-refresh interceptor. Bundled with Vite, served as static files by Nginx alongside the existing API reverse-proxy on `fp.app.huayihui.art`.

**Tech Stack:**
- Vue 3 + TypeScript (strict)
- Vant 4 (UI), Pinia (state), Vue Router 4 (routing)
- Axios (HTTP) with JWT auto-refresh
- Vite 5 (build)

---

## Repo layout produced by this plan

```
frontend/
  package.json
  tsconfig.json
  tsconfig.node.json
  vite.config.ts
  index.html
  .env.development
  .gitignore
  src/
    main.ts
    App.vue
    env.d.ts
    router/index.ts
    stores/auth.ts
    api/{client.ts, auth.ts, teams.ts, users.ts, invoices.ts}
    types/api.ts
    layouts/AppShell.vue
    components/{ImageThumbGrid.vue, InvoiceListItem.vue, InvoiceFilterBar.vue}
    views/
      LoginView.vue
      ChangePasswordView.vue
      NotFoundView.vue
      operator/{OperatorHomeView.vue, OperatorUploadView.vue, OperatorInvoiceDetailView.vue}
      admin/{AdminHomeView.vue, AdminInvoiceDetailView.vue, AdminOperatorsView.vue}
      super/{SuperTeamsView.vue, SuperTeamAdminsView.vue}
```

---

## File-by-file responsibilities

| File | Responsibility |
|---|---|
| `vite.config.ts` | Vite config: `@` alias, port 5173, proxy `/api` → `http://localhost:3001` for local dev |
| `src/api/client.ts` | Axios instance with `baseURL` + request interceptor (attaches access token) + response interceptor (refreshes on 401, retries once, logs out on second 401) |
| `src/stores/auth.ts` | Pinia store: `accessToken`, `refreshToken`, `user`, persisted in `localStorage`. Actions: `login`, `refresh`, `changePassword`, `logout`. |
| `src/router/index.ts` | Routes + global beforeEach guard: redirect unauth → `/login`; if `mustChangePassword` → `/change-password`; route by role |
| `src/layouts/AppShell.vue` | Vant top bar + role-aware bottom tabbar (operator: 上传/我的; admin: 发票/操作员; super: 团队) |
| Each view | One page, scoped by role. Uses Vant components. Calls backend API helpers. |

---

## Conventions

- **TDD doesn't really fit pure UI work**. Each view task ends with a smoke test (`npm run build` clean + browser smoke against `vite dev` proxied to local backend, OR against prod URL).
- **Path**: every command from `/data/github/fapiao/frontend/` unless otherwise noted.
- **Branch**: `feat/m5-frontend`. Don't push to main directly.
- **All Vant 4 imports**: explicit per-component (no auto-import for clarity).
- **Mobile-first** styling but the layout adjusts at `min-width: 768px` for PC.

---

## Task 1: Vite + Vue 3 + Vant scaffold

**Files:**
- Create: `frontend/package.json`, `frontend/tsconfig.json`, `frontend/tsconfig.node.json`, `frontend/vite.config.ts`, `frontend/index.html`, `frontend/.env.development`, `frontend/.gitignore`, `frontend/src/main.ts`, `frontend/src/App.vue`, `frontend/src/env.d.ts`

- [ ] **Step 1: Scaffold via Vite**

```bash
cd /data/github/fapiao
npm create vite@5 frontend -- --template vue-ts
cd frontend
npm install
npm install vant@4 @vant/touch-emulator pinia vue-router@4 axios
```

The `vue-ts` template gives us Vue 3 + TypeScript + `<script setup>` + Vite with strict TS by default.

- [ ] **Step 2: Replace `vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
});
```

- [ ] **Step 3: Replace `frontend/.env.development`**

```
VITE_API_BASE=
```

(Empty so dev server uses the Vite proxy on `/api`.)

- [ ] **Step 4: Replace `frontend/index.html`**

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title>fapiao 发票登记</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 5: Replace `frontend/src/main.ts`**

```ts
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
import 'vant/lib/index.css';
import '@vant/touch-emulator';

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount('#app');
```

- [ ] **Step 6: Replace `frontend/src/App.vue`**

```vue
<script setup lang="ts">
</script>

<template>
  <router-view />
</template>

<style>
:root {
  --max-content-width: 768px;
}
html, body, #app { height: 100%; margin: 0; }
#app { display: flex; flex-direction: column; }
</style>
```

- [ ] **Step 7: Build sanity check**

```bash
npm run build
```

Expect clean. (Router doesn't exist yet so the dev server would 404 — that's fine, we'll add it next task.)

- [ ] **Step 8: Replace `frontend/.gitignore`**

```
node_modules/
dist/
dist-ssr/
*.local
.env
.env.*
!.env.development
!.env.example
*.log
.vscode/
.idea/
.DS_Store
```

- [ ] **Step 9: Commit**

```bash
cd /data/github/fapiao
git add frontend
git commit -m "feat(frontend): vite + vue 3 + vant scaffold"
```

---

## Task 2: Auth store + axios client + types

**Files:**
- Create: `frontend/src/types/api.ts`, `frontend/src/api/client.ts`, `frontend/src/stores/auth.ts`

- [ ] **Step 1: Types**

Create `frontend/src/types/api.ts`:

```ts
export type Role = 'super_admin' | 'team_admin' | 'operator';
export type PaymentMethod = 'cash' | 'online';
export type InvoiceStatus = 'unprocessed' | 'processed';
export type InvoiceType = 'catering' | 'fuel' | 'consumable' | 'printing' | 'other';
export type ExportImageMode = 'invoice_only' | 'proof_only' | 'both';

export interface AuthUser {
  id: string;
  username: string;
  role: Role;
  teamId: string | null;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  mustChangePassword: boolean;
  user: AuthUser;
}

export interface Team { id: string; name: string; status: 'active' | 'disabled'; createdAt: string; }

export interface UserRow {
  id: string;
  username: string;
  role: Role;
  status: 'active' | 'disabled';
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface InvoiceImage { id: string; originalFilename: string; sizeBytes: number; uploadedAt: string; }

export interface InvoiceFull {
  id: string;
  teamId: string;
  operatorId: string;
  operatorUsername: string | null;
  amount: number | null;
  invoiceType: InvoiceType | null;
  paymentMethod: PaymentMethod;
  status: InvoiceStatus;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
  processedAt: string | null;
  processedBy: string | null;
  invoiceImages: InvoiceImage[];
  proofImages: InvoiceImage[];
}

export interface InvoiceListResponse {
  items: InvoiceFull[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ExportPart {
  kind: 'xlsx' | 'invoice-zip' | 'proof-zip';
  href: string;
  filename: string;
}

export interface ExportManifest {
  parts: ExportPart[];
  expiresInSec: number;
}
```

- [ ] **Step 2: Axios client**

Create `frontend/src/api/client.ts`:

```ts
import axios, { AxiosError, type AxiosRequestConfig } from 'axios';

const baseURL = import.meta.env.VITE_API_BASE || '';

export const api = axios.create({ baseURL });

let isRefreshing = false;
let waiters: Array<(t: string | null) => void> = [];

api.interceptors.request.use((config) => {
  const tok = localStorage.getItem('access_token');
  if (tok) {
    config.headers = config.headers ?? {};
    (config.headers as any).Authorization = `Bearer ${tok}`;
  }
  return config;
});

api.interceptors.response.use(
  (r) => r,
  async (err: AxiosError) => {
    const original = err.config as AxiosRequestConfig & { _retry?: boolean };
    if (err.response?.status === 401 && original && !original._retry && !original.url?.includes('/api/auth/')) {
      original._retry = true;
      const newToken = await refreshAccessToken();
      if (newToken) {
        original.headers = original.headers ?? {};
        (original.headers as any).Authorization = `Bearer ${newToken}`;
        return api(original);
      }
    }
    return Promise.reject(err);
  },
);

async function refreshAccessToken(): Promise<string | null> {
  if (isRefreshing) {
    return new Promise((resolve) => waiters.push(resolve));
  }
  isRefreshing = true;
  const refreshToken = localStorage.getItem('refresh_token');
  if (!refreshToken) { isRefreshing = false; return null; }
  try {
    const res = await axios.post(`${baseURL}/api/auth/refresh`, { refreshToken });
    const { accessToken, refreshToken: newRefresh } = res.data;
    localStorage.setItem('access_token', accessToken);
    localStorage.setItem('refresh_token', newRefresh);
    waiters.forEach((w) => w(accessToken));
    waiters = [];
    return accessToken;
  } catch {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user');
    waiters.forEach((w) => w(null));
    waiters = [];
    if (location.pathname !== '/login') location.replace('/login');
    return null;
  } finally {
    isRefreshing = false;
  }
}
```

- [ ] **Step 3: Auth store**

Create `frontend/src/stores/auth.ts`:

```ts
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api } from '@/api/client';
import type { AuthUser, LoginResponse } from '@/types/api';

export const useAuthStore = defineStore('auth', () => {
  const accessToken = ref<string | null>(localStorage.getItem('access_token'));
  const refreshToken = ref<string | null>(localStorage.getItem('refresh_token'));
  const user = ref<AuthUser | null>(JSON.parse(localStorage.getItem('user') || 'null'));
  const mustChangePassword = ref<boolean>(localStorage.getItem('must_change_password') === '1');

  const isAuthed = computed(() => !!accessToken.value && !!user.value);

  async function login(username: string, password: string) {
    const res = await api.post<LoginResponse>('/api/auth/login', { username, password });
    accessToken.value = res.data.accessToken;
    refreshToken.value = res.data.refreshToken;
    user.value = res.data.user;
    mustChangePassword.value = res.data.mustChangePassword;
    localStorage.setItem('access_token', accessToken.value);
    localStorage.setItem('refresh_token', refreshToken.value);
    localStorage.setItem('user', JSON.stringify(user.value));
    localStorage.setItem('must_change_password', mustChangePassword.value ? '1' : '0');
    return res.data;
  }

  async function changePassword(currentPassword: string, newPassword: string) {
    await api.post('/api/auth/change-password', { currentPassword, newPassword });
    mustChangePassword.value = false;
    localStorage.setItem('must_change_password', '0');
  }

  function logout() {
    accessToken.value = null;
    refreshToken.value = null;
    user.value = null;
    mustChangePassword.value = false;
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user');
    localStorage.removeItem('must_change_password');
  }

  return { accessToken, refreshToken, user, mustChangePassword, isAuthed, login, changePassword, logout };
});
```

- [ ] **Step 4: Build**

```bash
npm run build
```

Expect clean.

- [ ] **Step 5: Commit**

```bash
cd /data/github/fapiao
git add frontend
git commit -m "feat(frontend): auth store + axios client with refresh"
```

---

## Task 3: API helpers + Router + Layout

**Files:**
- Create: `frontend/src/api/{auth.ts, teams.ts, users.ts, invoices.ts}`
- Create: `frontend/src/router/index.ts`
- Create: `frontend/src/layouts/AppShell.vue`

- [ ] **Step 1: API helpers**

Create `frontend/src/api/auth.ts`:

```ts
import { api } from './client';

export const authApi = {
  refresh: (refreshToken: string) => api.post('/api/auth/refresh', { refreshToken }).then((r) => r.data),
};
```

Create `frontend/src/api/teams.ts`:

```ts
import { api } from './client';
import type { Team } from '@/types/api';

export const teamsApi = {
  list: () => api.get<Team[]>('/api/super/teams').then((r) => r.data),
  create: (name: string) => api.post<Team>('/api/super/teams', { name }).then((r) => r.data),
  update: (id: string, dto: { name?: string; status?: 'active' | 'disabled' }) =>
    api.patch<Team>(`/api/super/teams/${id}`, dto).then((r) => r.data),
};
```

Create `frontend/src/api/users.ts`:

```ts
import { api } from './client';
import type { UserRow } from '@/types/api';

export const usersApi = {
  // super
  listTeamAdmins: (teamId: string) => api.get<UserRow[]>(`/api/super/teams/${teamId}/admins`).then((r) => r.data),
  createTeamAdmin: (teamId: string, dto: { username: string; initialPassword: string }) =>
    api.post<UserRow>(`/api/super/teams/${teamId}/admins`, dto).then((r) => r.data),
  resetTeamAdminPassword: (teamId: string, userId: string, newPassword: string) =>
    api.patch(`/api/super/teams/${teamId}/admins/${userId}/password`, { newPassword }).then((r) => r.data),
  setTeamAdminStatus: (teamId: string, userId: string, status: 'active' | 'disabled') =>
    api.patch(`/api/super/teams/${teamId}/admins/${userId}/status`, { status }).then((r) => r.data),
  // team_admin
  listOperators: () => api.get<UserRow[]>('/api/admin/operators').then((r) => r.data),
  createOperator: (dto: { username: string; initialPassword: string }) =>
    api.post<UserRow>('/api/admin/operators', dto).then((r) => r.data),
  resetOperatorPassword: (userId: string, newPassword: string) =>
    api.patch(`/api/admin/operators/${userId}/password`, { newPassword }).then((r) => r.data),
  setOperatorStatus: (userId: string, status: 'active' | 'disabled') =>
    api.patch(`/api/admin/operators/${userId}/status`, { status }).then((r) => r.data),
};
```

Create `frontend/src/api/invoices.ts`:

```ts
import { api } from './client';
import type {
  ExportImageMode, ExportManifest, InvoiceFull, InvoiceListResponse, InvoiceType, PaymentMethod,
} from '@/types/api';

export interface ListQuery {
  status?: string; invoiceType?: string; paymentMethod?: string;
  operatorId?: string; fromDate?: string; toDate?: string;
  amountRegistered?: 'true' | 'false';
  page?: number; pageSize?: number;
}

export const invoicesApi = {
  // operator
  myList: (q: ListQuery = {}) => api.get<InvoiceListResponse>('/api/op/invoices', { params: q }).then((r) => r.data),
  myDetail: (id: string) => api.get<InvoiceFull>(`/api/op/invoices/${id}`).then((r) => r.data),
  myCreate: (form: FormData) => api.post<InvoiceFull>('/api/op/invoices', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
  myUpdate: (id: string, dto: { paymentMethod?: PaymentMethod; remark?: string | null }) =>
    api.patch<InvoiceFull>(`/api/op/invoices/${id}`, dto).then((r) => r.data),
  myDelete: (id: string) => api.delete(`/api/op/invoices/${id}`).then((r) => r.data),

  // admin
  adminList: (q: ListQuery = {}) => api.get<InvoiceListResponse>('/api/admin/invoices', { params: q }).then((r) => r.data),
  adminDetail: (id: string) => api.get<InvoiceFull>(`/api/admin/invoices/${id}`).then((r) => r.data),
  adminRegister: (id: string, dto: { amount?: number; invoiceType?: InvoiceType }) =>
    api.patch<InvoiceFull>(`/api/admin/invoices/${id}`, dto).then((r) => r.data),
  adminBatchProcess: (ids: string[]) => api.post<{ count: number }>('/api/admin/invoices/batch-process', { ids }).then((r) => r.data),
  adminExport: (ids: string[], mode: ExportImageMode, alsoMarkProcessed = false) =>
    api.post<ExportManifest>('/api/admin/invoices/export', { ids, mode, alsoMarkProcessed }).then((r) => r.data),

  // image signed URL
  signInvoiceImage: (invoiceId: string, imageId: string) =>
    api.get<{ url: string; expiresInSec: number }>(`/api/invoices/${invoiceId}/images/${imageId}/url`).then((r) => r.data),
  signProofImage: (invoiceId: string, imageId: string) =>
    api.get<{ url: string; expiresInSec: number }>(`/api/invoices/${invoiceId}/proofs/${imageId}/url`).then((r) => r.data),
};
```

- [ ] **Step 2: Router**

Create `frontend/src/router/index.ts`:

```ts
import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const routes = [
  { path: '/login', name: 'login', component: () => import('@/views/LoginView.vue'), meta: { public: true } },
  { path: '/change-password', name: 'change-password', component: () => import('@/views/ChangePasswordView.vue'), meta: { mustAuth: true } },

  {
    path: '/',
    component: () => import('@/layouts/AppShell.vue'),
    meta: { mustAuth: true },
    children: [
      { path: '', redirect: () => roleHome() },

      // operator
      { path: 'op', name: 'op-home', component: () => import('@/views/operator/OperatorHomeView.vue'), meta: { roles: ['operator'] } },
      { path: 'op/upload', name: 'op-upload', component: () => import('@/views/operator/OperatorUploadView.vue'), meta: { roles: ['operator'] } },
      { path: 'op/invoices/:id', name: 'op-detail', component: () => import('@/views/operator/OperatorInvoiceDetailView.vue'), meta: { roles: ['operator'] }, props: true },

      // team_admin
      { path: 'admin', name: 'admin-home', component: () => import('@/views/admin/AdminHomeView.vue'), meta: { roles: ['team_admin'] } },
      { path: 'admin/invoices/:id', name: 'admin-detail', component: () => import('@/views/admin/AdminInvoiceDetailView.vue'), meta: { roles: ['team_admin'] }, props: true },
      { path: 'admin/operators', name: 'admin-operators', component: () => import('@/views/admin/AdminOperatorsView.vue'), meta: { roles: ['team_admin'] } },

      // super_admin
      { path: 'super/teams', name: 'super-teams', component: () => import('@/views/super/SuperTeamsView.vue'), meta: { roles: ['super_admin'] } },
      { path: 'super/teams/:teamId/admins', name: 'super-team-admins', component: () => import('@/views/super/SuperTeamAdminsView.vue'), meta: { roles: ['super_admin'] }, props: true },
    ],
  },

  { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('@/views/NotFoundView.vue') },
];

function roleHome(): string {
  const auth = useAuthStore();
  if (!auth.user) return '/login';
  if (auth.user.role === 'operator') return '/op';
  if (auth.user.role === 'team_admin') return '/admin';
  if (auth.user.role === 'super_admin') return '/super/teams';
  return '/login';
}

const router = createRouter({ history: createWebHistory(), routes });

router.beforeEach((to) => {
  const auth = useAuthStore();
  if (to.meta.public) return true;
  if (!auth.isAuthed) return { name: 'login', query: { redirect: to.fullPath } };
  if (auth.mustChangePassword && to.name !== 'change-password') {
    return { name: 'change-password' };
  }
  const allowed = (to.meta.roles as string[] | undefined);
  if (allowed && auth.user && !allowed.includes(auth.user.role)) {
    return roleHome();
  }
  return true;
});

export default router;
```

- [ ] **Step 3: Layout**

Create `frontend/src/layouts/AppShell.vue`:

```vue
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
```

- [ ] **Step 4: NotFoundView placeholder**

Create `frontend/src/views/NotFoundView.vue`:

```vue
<script setup lang="ts">
import { Empty, Button } from 'vant';
import { useRouter } from 'vue-router';
const router = useRouter();
</script>

<template>
  <Empty description="页面不存在">
    <Button type="primary" @click="router.push('/')">返回首页</Button>
  </Empty>
</template>
```

- [ ] **Step 5: Build**

`npm run build` should fail because views referenced in router don't exist. That's the next tasks. Comment out the role-specific routes temporarily to verify the foundation, then re-enable. **Better:** create empty placeholder `.vue` files for every view referenced, with just a `<template><div>TODO</div></template>` stub. They'll get filled in by later tasks.

Create stub files:
- `frontend/src/views/LoginView.vue` (will be filled in Task 4)
- `frontend/src/views/ChangePasswordView.vue` (Task 4)
- `frontend/src/views/operator/OperatorHomeView.vue` (Task 5)
- `frontend/src/views/operator/OperatorUploadView.vue` (Task 6)
- `frontend/src/views/operator/OperatorInvoiceDetailView.vue` (Task 6)
- `frontend/src/views/admin/AdminHomeView.vue` (Task 7)
- `frontend/src/views/admin/AdminInvoiceDetailView.vue` (Task 8)
- `frontend/src/views/admin/AdminOperatorsView.vue` (Task 9)
- `frontend/src/views/super/SuperTeamsView.vue` (Task 10)
- `frontend/src/views/super/SuperTeamAdminsView.vue` (Task 10)

Each stub file:

```vue
<script setup lang="ts">
</script>
<template>
  <div style="padding: 16px;">TODO</div>
</template>
```

Now `npm run build` should be clean.

- [ ] **Step 6: Commit**

```bash
cd /data/github/fapiao
git add frontend
git commit -m "feat(frontend): API helpers + router + AppShell layout + view stubs"
```

---

## Task 4: Login + Change-password views

**Files:**
- Modify (replace stub content): `frontend/src/views/LoginView.vue`, `frontend/src/views/ChangePasswordView.vue`

- [ ] **Step 1: LoginView**

Replace `frontend/src/views/LoginView.vue`:

```vue
<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Button, Cell, CellGroup, Field, Form, Toast } from 'vant';
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
    Toast.fail(e.response?.data?.message || '登录失败');
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="login-wrap">
    <h1 class="title">fapiao 登录</h1>
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
```

- [ ] **Step 2: ChangePasswordView**

Replace `frontend/src/views/ChangePasswordView.vue`:

```vue
<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Button, CellGroup, Field, Form, Toast } from 'vant';
import { useAuthStore } from '@/stores/auth';

const router = useRouter();
const auth = useAuthStore();

const form = reactive({ currentPassword: '', newPassword: '', confirmPassword: '' });
const submitting = ref(false);

async function onSubmit() {
  if (form.newPassword !== form.confirmPassword) {
    Toast.fail('两次输入的新密码不一致');
    return;
  }
  if (form.newPassword.length < 8 || !/[A-Za-z]/.test(form.newPassword) || !/[0-9]/.test(form.newPassword)) {
    Toast.fail('新密码至少 8 位且含字母与数字');
    return;
  }
  submitting.value = true;
  try {
    await auth.changePassword(form.currentPassword, form.newPassword);
    Toast.success('密码已更新');
    router.replace('/');
  } catch (e: any) {
    Toast.fail(e.response?.data?.message || '修改失败');
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
```

- [ ] **Step 3: Build**

```bash
npm run build
```

Expect clean.

- [ ] **Step 4: Smoke**

```bash
# In another shell, ensure backend is running on :3001 (or use prod proxy)
npm run dev
# Open http://localhost:5173 → /login
# Try logging in with admin/admin123 → should land on /change-password
```

If smoke passes, proceed.

- [ ] **Step 5: Commit**

```bash
git add frontend
git commit -m "feat(frontend): login + change-password views"
```

---

## Task 5: Operator home (my invoices)

**Files:**
- Replace: `frontend/src/views/operator/OperatorHomeView.vue`
- Create: `frontend/src/components/InvoiceListItem.vue`

- [ ] **Step 1: InvoiceListItem component**

Create `frontend/src/components/InvoiceListItem.vue`:

```vue
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
```

- [ ] **Step 2: OperatorHomeView**

Replace `frontend/src/views/operator/OperatorHomeView.vue`:

```vue
<script setup lang="ts">
import { onActivated, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Empty, List, PullRefresh, Toast } from 'vant';
import InvoiceListItem from '@/components/InvoiceListItem.vue';
import { invoicesApi } from '@/api/invoices';
import type { InvoiceFull } from '@/types/api';

const router = useRouter();
const items = ref<InvoiceFull[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const loading = ref(false);
const finished = ref(false);
const refreshing = ref(false);

async function load() {
  loading.value = true;
  try {
    const res = await invoicesApi.myList({ page: page.value, pageSize });
    if (page.value === 1) items.value = res.items;
    else items.value.push(...res.items);
    total.value = res.total;
    if (items.value.length >= total.value) finished.value = true;
    else page.value += 1;
  } catch (e: any) {
    Toast.fail('加载失败');
    finished.value = true;
  } finally {
    loading.value = false;
  }
}

async function onRefresh() {
  page.value = 1;
  finished.value = false;
  items.value = [];
  refreshing.value = true;
  await load();
  refreshing.value = false;
}

onActivated(() => { onRefresh(); });
load();

function open(id: string) { router.push({ name: 'op-detail', params: { id } }); }
</script>

<template>
  <PullRefresh v-model="refreshing" @refresh="onRefresh">
    <List v-model:loading="loading" :finished="finished" finished-text="没有更多了" @load="load">
      <InvoiceListItem
        v-for="inv in items"
        :key="inv.id"
        :invoice="inv"
        @click="open(inv.id)"
      />
      <Empty v-if="!loading && items.length === 0" description="还没有发票，去上传一张" />
    </List>
  </PullRefresh>
</template>
```

- [ ] **Step 3: Build + smoke**

```bash
npm run build
npm run dev
# Login as operator → navigate to /op → see "没有发票" or list
```

- [ ] **Step 4: Commit**

```bash
git add frontend
git commit -m "feat(frontend): operator home view (my invoice list)"
```

---

## Task 6: Operator upload + detail

**Files:**
- Replace: `frontend/src/views/operator/OperatorUploadView.vue`, `frontend/src/views/operator/OperatorInvoiceDetailView.vue`
- Create: `frontend/src/components/ImageThumbGrid.vue`

- [ ] **Step 1: ImageThumbGrid (signed-URL aware)**

Create `frontend/src/components/ImageThumbGrid.vue`:

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Image as VanImage, ImagePreview } from 'vant';
import type { InvoiceImage } from '@/types/api';

const props = defineProps<{
  invoiceId: string;
  images: InvoiceImage[];
  kind: 'invoice' | 'proof';
  signFn: (invoiceId: string, imageId: string) => Promise<{ url: string; expiresInSec: number }>;
}>();

const urls = ref<string[]>([]);

onMounted(async () => {
  urls.value = await Promise.all(
    props.images.map(async (img) => {
      try { return (await props.signFn(props.invoiceId, img.id)).url; }
      catch { return ''; }
    }),
  );
});

function preview(idx: number) {
  const valid = urls.value.filter(Boolean);
  if (valid.length === 0) return;
  ImagePreview({ images: valid, startPosition: idx });
}
</script>

<template>
  <div class="grid">
    <div v-for="(img, i) in images" :key="img.id" class="thumb" @click="preview(i)">
      <VanImage v-if="urls[i]" :src="urls[i]" fit="cover" lazy-load />
      <div v-else class="placeholder">…</div>
      <div class="cap">{{ img.originalFilename }}</div>
    </div>
  </div>
</template>

<style scoped>
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; padding: 8px; }
.thumb { position: relative; aspect-ratio: 1; cursor: pointer; }
.thumb :deep(.van-image) { width: 100%; height: 100%; }
.placeholder { width: 100%; height: 100%; background: #f5f5f5; display: flex; align-items: center; justify-content: center; }
.cap { position: absolute; bottom: 0; left: 0; right: 0; font-size: 10px; color: white; background: rgba(0,0,0,0.6); padding: 2px 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
```

- [ ] **Step 2: OperatorUploadView**

Replace `frontend/src/views/operator/OperatorUploadView.vue`:

```vue
<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Button, Cell, CellGroup, Field, RadioGroup, Radio, Toast, Uploader, type UploaderFileListItem } from 'vant';
import { invoicesApi } from '@/api/invoices';

const router = useRouter();
const form = reactive({ paymentMethod: 'cash' as 'cash' | 'online', remark: '' });
const invoiceFiles = ref<UploaderFileListItem[]>([]);
const proofFiles = ref<UploaderFileListItem[]>([]);
const submitting = ref(false);

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX = 10 * 1024 * 1024;

function validate(file: File) {
  if (!ALLOWED.includes(file.type)) { Toast.fail(`不支持的文件: ${file.type}`); return false; }
  if (file.size > MAX) { Toast.fail(`文件超过 10MB: ${file.name}`); return false; }
  return true;
}

async function onSubmit() {
  if (invoiceFiles.value.length === 0) { Toast.fail('请上传至少 1 张发票图片'); return; }
  if (proofFiles.value.length === 0) { Toast.fail('请上传至少 1 张支付凭证'); return; }
  submitting.value = true;
  const fd = new FormData();
  fd.append('paymentMethod', form.paymentMethod);
  if (form.remark) fd.append('remark', form.remark);
  for (const f of invoiceFiles.value) if (f.file) fd.append('invoiceImages', f.file, f.file.name);
  for (const f of proofFiles.value) if (f.file) fd.append('proofImages', f.file, f.file.name);
  try {
    const inv = await invoicesApi.myCreate(fd);
    Toast.success('上传成功');
    router.replace({ name: 'op-detail', params: { id: inv.id } });
  } catch (e: any) {
    Toast.fail(e.response?.data?.message || '上传失败');
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

    <CellGroup inset title="发票图片">
      <Cell>
        <Uploader v-model="invoiceFiles" multiple :max-count="10" :before-read="validate" accept="image/*,application/pdf" />
      </Cell>
    </CellGroup>

    <CellGroup inset title="支付凭证">
      <Cell>
        <Uploader v-model="proofFiles" multiple :max-count="10" :before-read="validate" accept="image/*,application/pdf" />
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
```

- [ ] **Step 3: OperatorInvoiceDetailView**

Replace `frontend/src/views/operator/OperatorInvoiceDetailView.vue`:

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Button, Cell, CellGroup, Dialog, Tag, Toast } from 'vant';
import ImageThumbGrid from '@/components/ImageThumbGrid.vue';
import { invoicesApi } from '@/api/invoices';
import type { InvoiceFull } from '@/types/api';

const route = useRoute();
const router = useRouter();
const id = route.params.id as string;
const inv = ref<InvoiceFull | null>(null);
const loading = ref(false);

async function load() {
  loading.value = true;
  try { inv.value = await invoicesApi.myDetail(id); }
  catch { Toast.fail('加载失败'); }
  finally { loading.value = false; }
}

async function onDelete() {
  await Dialog.confirm({ title: '删除这张发票？', message: '只能删除未处理的发票', cancelButtonText: '取消', confirmButtonText: '删除' }).catch(() => null);
  try {
    await invoicesApi.myDelete(id);
    Toast.success('已删除');
    router.replace({ name: 'op-home' });
  } catch (e: any) {
    Toast.fail(e.response?.data?.message || '删除失败');
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

    <div v-if="inv.status === 'unprocessed'" style="margin: 16px;">
      <Button block type="danger" plain @click="onDelete">删除</Button>
    </div>
  </div>
  <div v-else-if="loading" style="padding: 32px; text-align: center;">加载中…</div>
</template>
```

- [ ] **Step 4: Build + smoke**

```bash
npm run build
npm run dev
# Login as operator → upload an invoice → land on detail view → see images
```

- [ ] **Step 5: Commit**

```bash
git add frontend
git commit -m "feat(frontend): operator upload + detail with image thumbnails"
```

---

## Task 7: Admin home (invoice list + filters + batch ops + export)

**Files:**
- Replace: `frontend/src/views/admin/AdminHomeView.vue`
- Create: `frontend/src/components/InvoiceFilterBar.vue`

- [ ] **Step 1: InvoiceFilterBar**

Create `frontend/src/components/InvoiceFilterBar.vue`:

```vue
<script setup lang="ts">
import { reactive, watch } from 'vue';
import { Cell, CellGroup, DatePicker, Picker, Popup } from 'vant';

const props = defineProps<{ modelValue: { status?: string; invoiceType?: string; paymentMethod?: string; fromDate?: string; toDate?: string; amountRegistered?: string } }>();
const emit = defineEmits<{ (e: 'update:modelValue', v: any): void }>();
const local = reactive({ ...props.modelValue });

const STATUS = [{ text: '全部', value: '' }, { text: '未处理', value: 'unprocessed' }, { text: '已处理', value: 'processed' }];
const TYPE = [{ text: '全部', value: '' }, { text: '餐饮', value: 'catering' }, { text: '油票', value: 'fuel' }, { text: '耗材', value: 'consumable' }, { text: '打印', value: 'printing' }, { text: '其它', value: 'other' }];
const PAY = [{ text: '全部', value: '' }, { text: '现金', value: 'cash' }, { text: '线上', value: 'online' }];
const REG = [{ text: '全部', value: '' }, { text: '已登记金额', value: 'true' }, { text: '未登记金额', value: 'false' }];

function emitChange() {
  const out: any = {};
  for (const k of Object.keys(local) as (keyof typeof local)[]) {
    if (local[k]) out[k] = local[k];
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
```

- [ ] **Step 2: AdminHomeView**

Replace `frontend/src/views/admin/AdminHomeView.vue`:

```vue
<script setup lang="ts">
import { onActivated, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ActionSheet, Button, Cell, CellGroup, Checkbox, Dialog, Empty, List, PullRefresh, Tag, Toast } from 'vant';
import InvoiceFilterBar from '@/components/InvoiceFilterBar.vue';
import { invoicesApi } from '@/api/invoices';
import type { ExportImageMode, InvoiceFull } from '@/types/api';

const router = useRouter();
const items = ref<InvoiceFull[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 30;
const loading = ref(false);
const finished = ref(false);
const refreshing = ref(false);
const filters = ref<any>({});
const selected = ref<Set<string>>(new Set());

const exportSheetShow = ref(false);
const exportActions = [
  { name: '仅 Excel + 发票图片 ZIP', mode: 'invoice_only' as ExportImageMode },
  { name: '仅 Excel + 支付凭证 ZIP', mode: 'proof_only' as ExportImageMode },
  { name: 'Excel + 发票图片 ZIP + 支付凭证 ZIP', mode: 'both' as ExportImageMode },
];

async function load() {
  loading.value = true;
  try {
    const res = await invoicesApi.adminList({ ...filters.value, page: page.value, pageSize });
    if (page.value === 1) items.value = res.items;
    else items.value.push(...res.items);
    total.value = res.total;
    if (items.value.length >= total.value) finished.value = true;
    else page.value += 1;
  } finally {
    loading.value = false;
  }
}

async function onRefresh() {
  page.value = 1; finished.value = false; items.value = [];
  refreshing.value = true; await load(); refreshing.value = false;
}

watch(filters, () => onRefresh(), { deep: true });
onActivated(() => { onRefresh(); });
load();

function toggle(id: string) {
  if (selected.value.has(id)) selected.value.delete(id);
  else selected.value.add(id);
  selected.value = new Set(selected.value);
}

function selectAllOnPage() {
  if (allOnPageSelected()) {
    items.value.forEach((it) => selected.value.delete(it.id));
  } else {
    items.value.forEach((it) => selected.value.add(it.id));
  }
  selected.value = new Set(selected.value);
}

function allOnPageSelected() {
  return items.value.length > 0 && items.value.every((it) => selected.value.has(it.id));
}

async function onBatchProcess() {
  if (selected.value.size === 0) { Toast.fail('请先勾选'); return; }
  await Dialog.confirm({ title: `确认标记 ${selected.value.size} 张为已处理？`, cancelButtonText: '取消', confirmButtonText: '确定' }).catch(() => null);
  try {
    const res = await invoicesApi.adminBatchProcess([...selected.value]);
    Toast.success(`已处理 ${res.count} 张`);
    selected.value.clear();
    onRefresh();
  } catch (e: any) {
    Toast.fail(e.response?.data?.message || '操作失败');
  }
}

async function onPickExport(mode: ExportImageMode) {
  exportSheetShow.value = false;
  if (selected.value.size === 0) { Toast.fail('请先勾选'); return; }
  const alsoMark = await Dialog.confirm({ title: '导出后自动标记为已处理？', cancelButtonText: '不标记', confirmButtonText: '同时标记' }).then(() => true).catch(() => false);
  try {
    const manifest = await invoicesApi.adminExport([...selected.value], mode, alsoMark);
    for (const part of manifest.parts) {
      const a = document.createElement('a');
      a.href = part.href; a.download = part.filename; document.body.appendChild(a); a.click(); a.remove();
      await new Promise((r) => setTimeout(r, 200));
    }
    Toast.success('开始下载');
    if (alsoMark) onRefresh();
  } catch (e: any) {
    Toast.fail(e.response?.data?.message || '导出失败');
  }
}

function open(id: string) { router.push({ name: 'admin-detail', params: { id } }); }

const typeLabel: Record<string, string> = { catering: '餐饮', fuel: '油票', consumable: '耗材', printing: '打印', other: '其它' };
</script>

<template>
  <div>
    <InvoiceFilterBar v-model="filters" />

    <CellGroup inset>
      <Cell>
        <template #title>
          已勾选 <strong>{{ selected.size }}</strong> 张 / 当前页 {{ items.length }} 张
        </template>
        <template #right-icon>
          <Checkbox :model-value="allOnPageSelected()" shape="square" @click="selectAllOnPage">全选本页</Checkbox>
        </template>
      </Cell>
    </CellGroup>

    <PullRefresh v-model="refreshing" @refresh="onRefresh">
      <List v-model:loading="loading" :finished="finished" finished-text="没有更多了" @load="load">
        <Cell v-for="inv in items" :key="inv.id" is-link clickable>
          <template #title>
            <Checkbox :model-value="selected.has(inv.id)" shape="square" @click.stop="toggle(inv.id)" />
            <span @click.stop="open(inv.id)" style="margin-left: 8px;">
              {{ new Date(inv.createdAt).toLocaleDateString('zh-CN') }} · {{ inv.operatorUsername || '-' }}
            </span>
          </template>
          <template #label>
            <span @click.stop="open(inv.id)">
              {{ inv.paymentMethod === 'cash' ? '现金' : '线上' }}
              <template v-if="inv.invoiceType"> · {{ typeLabel[inv.invoiceType] }}</template>
              <template v-if="inv.amount != null"> · ¥{{ inv.amount.toFixed(2) }}</template>
              <template v-if="inv.remark"> · {{ inv.remark }}</template>
            </span>
          </template>
          <template #right-icon>
            <Tag :type="inv.status === 'processed' ? 'success' : 'warning'" size="medium">
              {{ inv.status === 'processed' ? '已处理' : '未处理' }}
            </Tag>
          </template>
        </Cell>
        <Empty v-if="!loading && items.length === 0" description="暂无发票" />
      </List>
    </PullRefresh>

    <div class="bottom-bar">
      <Button block type="primary" @click="onBatchProcess">批量标记已处理</Button>
      <Button block type="success" @click="exportSheetShow = true">导出</Button>
    </div>

    <ActionSheet v-model:show="exportSheetShow" :actions="exportActions.map(a => ({ name: a.name, callback: () => onPickExport(a.mode) }))" cancel-text="取消" />
  </div>
</template>

<style scoped>
.bottom-bar { position: fixed; bottom: 50px; left: 0; right: 0; max-width: var(--max-content-width); margin: 0 auto; display: flex; gap: 8px; padding: 8px; background: white; border-top: 1px solid var(--van-border-color); z-index: 1; }
</style>
```

- [ ] **Step 3: Build + smoke**

```bash
npm run build
npm run dev
# Login as team_admin → /admin → list, filters, select, batch process, export
```

- [ ] **Step 4: Commit**

```bash
git add frontend
git commit -m "feat(frontend): admin home (list + filters + batch process + export)"
```

---

## Task 8: Admin invoice detail (register form)

**Files:**
- Replace: `frontend/src/views/admin/AdminInvoiceDetailView.vue`

- [ ] **Step 1: View**

Replace `frontend/src/views/admin/AdminInvoiceDetailView.vue`:

```vue
<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { Button, Cell, CellGroup, Field, Picker, Popup, Tag, Toast } from 'vant';
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
    Toast.success('已保存');
  } catch (e: any) {
    Toast.fail(e.response?.data?.message || '保存失败');
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
```

- [ ] **Step 2: Build + commit**

```bash
npm run build
git add frontend
git commit -m "feat(frontend): admin invoice detail + register form"
```

---

## Task 9: Admin operators page

**Files:**
- Replace: `frontend/src/views/admin/AdminOperatorsView.vue`

- [ ] **Step 1: View**

Replace `frontend/src/views/admin/AdminOperatorsView.vue`:

```vue
<script setup lang="ts">
import { onActivated, reactive, ref } from 'vue';
import { Button, Cell, CellGroup, Dialog, Empty, Field, Form, Popup, Tag, Toast } from 'vant';
import { usersApi } from '@/api/users';
import type { UserRow } from '@/types/api';

const ops = ref<UserRow[]>([]);
const loading = ref(false);
const showCreate = ref(false);
const form = reactive({ username: '', initialPassword: '' });
const submitting = ref(false);

async function load() {
  loading.value = true;
  try { ops.value = await usersApi.listOperators(); }
  finally { loading.value = false; }
}

onActivated(load);
load();

async function onCreate() {
  if (form.username.length < 3 || form.initialPassword.length < 8) {
    Toast.fail('账号 ≥ 3 位，密码 ≥ 8 位');
    return;
  }
  submitting.value = true;
  try {
    await usersApi.createOperator({ username: form.username, initialPassword: form.initialPassword });
    Toast.success('已创建');
    showCreate.value = false;
    form.username = ''; form.initialPassword = '';
    load();
  } catch (e: any) {
    Toast.fail(e.response?.data?.message || '创建失败');
  } finally {
    submitting.value = false;
  }
}

async function toggleStatus(u: UserRow) {
  const next = u.status === 'active' ? 'disabled' : 'active';
  await Dialog.confirm({ title: `${next === 'active' ? '启用' : '停用'} ${u.username}？`, cancelButtonText: '取消', confirmButtonText: '确定' }).catch(() => null);
  try {
    await usersApi.setOperatorStatus(u.id, next);
    Toast.success('已更新');
    load();
  } catch (e: any) {
    Toast.fail(e.response?.data?.message || '操作失败');
  }
}

async function resetPwd(u: UserRow) {
  const pwd = prompt(`为 ${u.username} 设置新密码（≥ 8 位）`);
  if (!pwd || pwd.length < 8) return;
  try {
    await usersApi.resetOperatorPassword(u.id, pwd);
    Toast.success('已重置密码，操作员下次登录会被强制改密');
  } catch (e: any) {
    Toast.fail(e.response?.data?.message || '操作失败');
  }
}
</script>

<template>
  <div>
    <div style="margin: 16px;">
      <Button block type="primary" @click="showCreate = true">+ 新建操作员</Button>
    </div>

    <CellGroup inset>
      <Cell v-for="u in ops" :key="u.id" :title="u.username" :label="`创建于 ${new Date(u.createdAt).toLocaleDateString('zh-CN')}` + (u.lastLoginAt ? ` · 最近登录 ${new Date(u.lastLoginAt).toLocaleDateString('zh-CN')}` : '')">
        <template #right-icon>
          <Tag :type="u.status === 'active' ? 'success' : 'danger'" size="medium" style="margin-right: 8px;">
            {{ u.status === 'active' ? '启用' : '停用' }}
          </Tag>
          <Button size="mini" plain @click="resetPwd(u)">重置密码</Button>
          <Button size="mini" plain :type="u.status === 'active' ? 'danger' : 'success'" @click="toggleStatus(u)" style="margin-left: 4px;">
            {{ u.status === 'active' ? '停用' : '启用' }}
          </Button>
        </template>
      </Cell>
      <Empty v-if="!loading && ops.length === 0" description="还没有操作员" />
    </CellGroup>

    <Popup v-model:show="showCreate" round position="bottom" :style="{ height: '60%' }">
      <div style="padding: 16px;">
        <h3>新建操作员</h3>
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
```

- [ ] **Step 2: Build + commit**

```bash
npm run build
git add frontend
git commit -m "feat(frontend): admin operators management page"
```

---

## Task 10: Super admin views (teams + team admins)

**Files:**
- Replace: `frontend/src/views/super/SuperTeamsView.vue`, `frontend/src/views/super/SuperTeamAdminsView.vue`

- [ ] **Step 1: SuperTeamsView**

Replace `frontend/src/views/super/SuperTeamsView.vue`:

```vue
<script setup lang="ts">
import { onActivated, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Button, Cell, CellGroup, Dialog, Empty, Field, Form, Popup, Tag, Toast } from 'vant';
import { teamsApi } from '@/api/teams';
import type { Team } from '@/types/api';

const router = useRouter();
const teams = ref<Team[]>([]);
const showCreate = ref(false);
const form = reactive({ name: '' });
const submitting = ref(false);

async function load() { teams.value = await teamsApi.list(); }

async function onCreate() {
  if (!form.name) { Toast.fail('请输入团队名'); return; }
  submitting.value = true;
  try {
    await teamsApi.create(form.name);
    Toast.success('已创建');
    showCreate.value = false; form.name = '';
    load();
  } catch (e: any) {
    Toast.fail(e.response?.data?.message || '创建失败');
  } finally {
    submitting.value = false;
  }
}

async function toggle(t: Team) {
  const next = t.status === 'active' ? 'disabled' : 'active';
  await Dialog.confirm({ title: `${next === 'active' ? '启用' : '停用'} ${t.name}？`, cancelButtonText: '取消', confirmButtonText: '确定' }).catch(() => null);
  try { await teamsApi.update(t.id, { status: next }); Toast.success('已更新'); load(); }
  catch (e: any) { Toast.fail(e.response?.data?.message || '失败'); }
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
```

- [ ] **Step 2: SuperTeamAdminsView**

Replace `frontend/src/views/super/SuperTeamAdminsView.vue`:

```vue
<script setup lang="ts">
import { onActivated, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { Button, Cell, CellGroup, Dialog, Empty, Field, Form, Popup, Tag, Toast } from 'vant';
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
  if (form.username.length < 3 || form.initialPassword.length < 8) { Toast.fail('账号 ≥ 3 位，密码 ≥ 8 位'); return; }
  submitting.value = true;
  try {
    await usersApi.createTeamAdmin(teamId, { ...form });
    Toast.success('已创建');
    showCreate.value = false; form.username = ''; form.initialPassword = '';
    load();
  } catch (e: any) { Toast.fail(e.response?.data?.message || '创建失败'); }
  finally { submitting.value = false; }
}

async function toggleStatus(u: UserRow) {
  const next = u.status === 'active' ? 'disabled' : 'active';
  await Dialog.confirm({ title: `${next === 'active' ? '启用' : '停用'} ${u.username}？`, cancelButtonText: '取消', confirmButtonText: '确定' }).catch(() => null);
  try { await usersApi.setTeamAdminStatus(teamId, u.id, next); Toast.success('已更新'); load(); }
  catch (e: any) { Toast.fail(e.response?.data?.message || '失败'); }
}

async function resetPwd(u: UserRow) {
  const pwd = prompt(`为 ${u.username} 设置新密码（≥ 8 位）`);
  if (!pwd || pwd.length < 8) return;
  try { await usersApi.resetTeamAdminPassword(teamId, u.id, pwd); Toast.success('已重置密码'); }
  catch (e: any) { Toast.fail(e.response?.data?.message || '操作失败'); }
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
```

- [ ] **Step 3: Build + commit**

```bash
npm run build
git add frontend
git commit -m "feat(frontend): super admin teams + team admins pages"
```

---

## Task 11: Build + deploy + Nginx static

**Files:**
- Modify: Nginx config on server (`/etc/nginx/sites-available/fapiao.conf`)

- [ ] **Step 1: Production build locally**

```bash
cd /data/github/fapiao/frontend
npm run build
ls dist/   # expect index.html + assets/
```

- [ ] **Step 2: rsync to server**

```bash
rsync -azv --delete /data/github/fapiao/frontend/dist/ sifusheng:/opt/fapiao/web/
```

- [ ] **Step 3: Update Nginx config (server)**

The current `/etc/nginx/sites-available/fapiao.conf` only reverse-proxies everything to `http://127.0.0.1:3001`. Update to serve static files from `/opt/fapiao/web` for non-`/api/*` paths.

Edit the 443 server block to:

```nginx
server {
  listen 443 ssl http2;
  server_name fp.app.huayihui.art;

  ssl_certificate     /etc/letsencrypt/live/fp.app.huayihui.art/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/fp.app.huayihui.art/privkey.pem;
  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_session_cache shared:SSL:10m;
  ssl_session_timeout 10m;

  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
  add_header X-Content-Type-Options nosniff always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;
  client_max_body_size 30m;

  access_log /var/log/nginx/fapiao.access.log;
  error_log  /var/log/nginx/fapiao.error.log;

  root /opt/fapiao/web;
  index index.html;

  location /api/ {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 60s;
    proxy_send_timeout 60s;
  }

  # SPA fallback
  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

Push the updated config to the server, run `nginx -t`, then `systemctl reload nginx`.

- [ ] **Step 4: Smoke**

```bash
curl -sI https://fp.app.huayihui.art/         # should return 200, content-type: text/html
curl -sS https://fp.app.huayihui.art/api/healthz   # should return {"ok":true}
```

Open browser → log in as `admin / admin123` → confirm responsive UI works on PC + mobile (DevTools mobile mode).

- [ ] **Step 5: Commit Nginx config to repo**

The deployment-time Nginx config lives at `/etc/nginx/sites-available/fapiao.conf` on the server, but a copy should be tracked in the repo for reproducibility:

```bash
ssh sifusheng cat /etc/nginx/sites-available/fapiao.conf > /data/github/fapiao/deploy/nginx-fapiao.conf
mkdir -p /data/github/fapiao/deploy
# (write the conf file shown above)
git add deploy/nginx-fapiao.conf
git commit -m "chore(deploy): track production nginx config"
```

---

## Verification

- [ ] Local `npm run build` from `frontend/` clean
- [ ] All views accessible without console errors
- [ ] Login → dashboard works for each role (super/admin/operator)
- [ ] Operator can upload an invoice and see it in their list, then in detail
- [ ] Admin can list, register, batch-process, export
- [ ] Super admin can create teams + admins
- [ ] Mobile devtools breakpoint (375×812) doesn't break layout
- [ ] PC browser at 1440×900 doesn't sprawl past `--max-content-width`

## Out of scope (handled in plan-04)

- Server hardening (SSH, firewall, fail2ban)
- Test/prod DB separation
- HTTP→HTTPS automation (already there from M1)
- Frontend tests (no e2e/component tests written for this MVP — manual smoke is acceptable)
