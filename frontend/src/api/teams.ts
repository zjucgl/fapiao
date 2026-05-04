import { api } from './client';
import type { Team } from '@/types/api';

export const teamsApi = {
  list: () => api.get<Team[]>('/api/super/teams').then((r) => r.data),
  create: (name: string) => api.post<Team>('/api/super/teams', { name }).then((r) => r.data),
  update: (id: string, dto: { name?: string; status?: 'active' | 'disabled' }) =>
    api.patch<Team>(`/api/super/teams/${id}`, dto).then((r) => r.data),
};
