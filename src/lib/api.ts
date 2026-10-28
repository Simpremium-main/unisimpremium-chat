import axios from 'axios';

export const api = axios.create({
  // Mesma origem: a API roda dentro deste app Next.js (src/pages/api).
  baseURL: process.env.NEXT_PUBLIC_API_URL || '/api/v1',
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    const orgId = localStorage.getItem('active_org_id');
    if (orgId) {
      config.headers['x-organization-id'] = orgId;
    }
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (error.response?.status === 401 && typeof window !== 'undefined') {
      // "Ver como" expirou (token de 1h, sem refresh): volta para a conta do admin.
      const impersonation = localStorage.getItem('impersonator_session');
      if (impersonation && !localStorage.getItem('refresh_token')) {
        try {
          const saved = JSON.parse(impersonation);
          localStorage.setItem('access_token', saved.accessToken);
          if (saved.refreshToken) localStorage.setItem('refresh_token', saved.refreshToken);
          if (saved.activeOrgId) localStorage.setItem('active_org_id', saved.activeOrgId);
        } finally {
          localStorage.removeItem('impersonator_session');
          (window as { __impersonationExpired?: boolean }).__impersonationExpired = true;
          window.location.href = '/settings/members';
        }
        return Promise.reject(new Error('A visualização como outro membro expirou'));
      }
      const refreshToken = localStorage.getItem('refresh_token');
      if (refreshToken && !error.config._retry) {
        error.config._retry = true;
        try {
          const { data } = await axios.post(
            `${api.defaults.baseURL}/auth/refresh`,
            { refreshToken },
          );
          localStorage.setItem('access_token', data.data.accessToken);
          localStorage.setItem('refresh_token', data.data.refreshToken);
          error.config.headers.Authorization = `Bearer ${data.data.accessToken}`;
          return api(error.config);
        } catch {
          localStorage.removeItem('access_token');
          localStorage.removeItem('refresh_token');
          window.location.href = '/login';
        }
      }
    }
    const message = error.response?.data?.message || error.message;
    return Promise.reject(new Error(Array.isArray(message) ? message[0] : message));
  },
);
