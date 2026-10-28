import { api } from '@/lib/api';

/**
 * "Ver como" outro membro: a sessão do admin fica guardada aqui enquanto o
 * app usa o token temporário (1h, sem refresh) do membro.
 */
const KEY = 'impersonator_session';

interface SavedSession {
  accessToken: string;
  refreshToken: string | null;
  activeOrgId: string | null;
  targetName: string;
  startedAt: string;
}

export function getImpersonation(): SavedSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SavedSession) : null;
  } catch {
    return null;
  }
}

export async function startImpersonation(userId: string, targetName: string): Promise<void> {
  if (getImpersonation()) throw new Error('Volte para a sua conta antes de ver como outra pessoa');
  const { data } = await api.post('/auth/impersonate', { userId });
  const result = data.data ?? data;
  const session: SavedSession = {
    accessToken: localStorage.getItem('access_token') ?? '',
    refreshToken: localStorage.getItem('refresh_token'),
    activeOrgId: localStorage.getItem('active_org_id'),
    targetName,
    startedAt: new Date().toISOString(),
  };
  localStorage.setItem(KEY, JSON.stringify(session));
  localStorage.setItem('access_token', result.accessToken);
  localStorage.removeItem('refresh_token');
  // Recarrega do zero: auth-store, realtime e caches passam a ser do membro.
  window.location.href = '/inbox';
}

export function exitImpersonation(redirect = '/settings/members'): void {
  const session = getImpersonation();
  if (!session) return;
  localStorage.setItem('access_token', session.accessToken);
  if (session.refreshToken) localStorage.setItem('refresh_token', session.refreshToken);
  if (session.activeOrgId) localStorage.setItem('active_org_id', session.activeOrgId);
  localStorage.removeItem(KEY);
  window.location.href = redirect;
}
