import { api } from './client';

export const authApi = {
  refresh: (refreshToken: string) => api.post('/api/auth/refresh', { refreshToken }).then((r) => r.data),
};
