'use client';

import { useAuthStore } from '@/stores/auth-store';

/** Rota do app → página do perfil de acesso (o mais específico primeiro). */
const ROUTE_PAGES: Array<[string, string]> = [
  ['/settings/contacts', 'contacts'],
  // Respostas rápidas: quem atende pelo inbox cadastra as suas.
  ['/settings/quick-replies', 'inbox'],
  ['/settings', 'settings'],
  ['/inbox', 'inbox'],
  ['/groups', 'inbox'],
  ['/requests', 'inbox'],
  ['/order-queries', 'inbox'],
  ['/contacts', 'contacts'],
  ['/pipelines', 'pipelines'],
  ['/dashboard', 'dashboard'],
  ['/projects', 'projects'],
  ['/ai-agents', 'jarvis'],
  ['/chatbot', 'jarvis'],
  ['/automations', 'automations'],
];

/** Ordem de preferência da página inicial quando a atual não é permitida. */
const LANDING: Array<[string, string]> = [
  ['inbox', '/inbox'],
  ['dashboard', '/dashboard'],
  ['contacts', '/contacts'],
  ['pipelines', '/pipelines'],
  ['projects', '/projects'],
  ['jarvis', '/ai-agents'],
  ['automations', '/automations'],
  ['settings', '/settings'],
];

export function pageForPath(pathname: string): string | null {
  return ROUTE_PAGES.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`))?.[1] ?? null;
}

/**
 * Permissões do usuário na org ativa. Dono/admin e atendente sem perfil
 * podem tudo (`access` null); com perfil, só o que ele libera.
 */
export function useAccess() {
  const access = useAuthStore((s) => s.organizations.find((o) => o.id === s.activeOrgId)?.access ?? null);
  // Mesma regra do servidor (common/access/catalog.ts → canAccess): sub-página
  // exige a mãe; mãe sem nenhuma sub-página escolhida libera todas.
  const canPage = (key: string) => {
    if (!access) return true;
    const dot = key.indexOf('.');
    if (dot < 0) return access.pages.includes(key);
    const parent = key.slice(0, dot);
    if (!access.pages.includes(parent)) return false;
    const chosen = access.pages.filter((p) => p.startsWith(`${parent}.`));
    return chosen.length === 0 || chosen.includes(key);
  };
  const can = (key: string) => !access || access.actions.includes(key);
  const canPath = (pathname: string) => {
    const page = pageForPath(pathname);
    return !page || canPage(page);
  };
  const landing = () => LANDING.find(([page]) => canPage(page))?.[1] ?? null;
  return { access, canPage, can, canPath, landing };
}
