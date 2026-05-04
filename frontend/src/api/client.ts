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
