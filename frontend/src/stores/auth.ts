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
    localStorage.setItem('access_token', accessToken.value!);
    localStorage.setItem('refresh_token', refreshToken.value!);
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
