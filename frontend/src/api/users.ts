import { api } from './client';
import type { UserRow } from '@/types/api';

export const usersApi = {
  listTeamAdmins: (teamId: string) => api.get<UserRow[]>(`/api/super/teams/${teamId}/admins`).then((r) => r.data),
  createTeamAdmin: (teamId: string, dto: { username: string; initialPassword: string }) =>
    api.post<UserRow>(`/api/super/teams/${teamId}/admins`, dto).then((r) => r.data),
  resetTeamAdminPassword: (teamId: string, userId: string, newPassword: string) =>
    api.patch(`/api/super/teams/${teamId}/admins/${userId}/password`, { newPassword }).then((r) => r.data),
  setTeamAdminStatus: (teamId: string, userId: string, status: 'active' | 'disabled') =>
    api.patch(`/api/super/teams/${teamId}/admins/${userId}/status`, { status }).then((r) => r.data),

  listOperators: () => api.get<UserRow[]>('/api/admin/operators').then((r) => r.data),
  createOperator: (dto: { username: string; initialPassword: string }) =>
    api.post<UserRow>('/api/admin/operators', dto).then((r) => r.data),
  resetOperatorPassword: (userId: string, newPassword: string) =>
    api.patch(`/api/admin/operators/${userId}/password`, { newPassword }).then((r) => r.data),
  setOperatorStatus: (userId: string, status: 'active' | 'disabled') =>
    api.patch(`/api/admin/operators/${userId}/status`, { status }).then((r) => r.data),
};
