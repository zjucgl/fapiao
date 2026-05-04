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

      { path: 'op', name: 'op-home', component: () => import('@/views/operator/OperatorHomeView.vue'), meta: { roles: ['operator'] } },
      { path: 'op/upload', name: 'op-upload', component: () => import('@/views/operator/OperatorUploadView.vue'), meta: { roles: ['operator'] } },
      { path: 'op/invoices/:id', name: 'op-detail', component: () => import('@/views/operator/OperatorInvoiceDetailView.vue'), meta: { roles: ['operator'] }, props: true },

      { path: 'admin', name: 'admin-home', component: () => import('@/views/admin/AdminHomeView.vue'), meta: { roles: ['team_admin'] } },
      { path: 'admin/invoices/:id', name: 'admin-detail', component: () => import('@/views/admin/AdminInvoiceDetailView.vue'), meta: { roles: ['team_admin'] }, props: true },
      { path: 'admin/operators', name: 'admin-operators', component: () => import('@/views/admin/AdminOperatorsView.vue'), meta: { roles: ['team_admin'] } },

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
