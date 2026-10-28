'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

/**
 * Notificações no celular (Web Push) para o app na Tela de Início.
 *
 * iPhone: só funciona com o site adicionado à Tela de Início (Safari →
 * Compartilhar → Adicionar à Tela de Início), iOS 16.4+, e o pedido de
 * permissão precisa vir de um toque do usuário.
 */
export type PushState =
  | 'loading'
  /** Navegador sem Web Push. */
  | 'unsupported'
  /** iPhone/iPad fora da Tela de Início: precisa instalar o app primeiro. */
  | 'needs-install'
  /** Servidor sem chaves VAPID. */
  | 'not-configured'
  | 'denied'
  | 'off'
  | 'on';

const SW_URL = '/sw.js';

const isIos = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;

const hasPushApi = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

async function serverConfig(): Promise<{ enabled: boolean; publicKey: string | null }> {
  const { data } = await api.get('/push/config');
  return data.data;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return (await navigator.serviceWorker.getRegistration('/')) ?? navigator.serviceWorker.register(SW_URL, { scope: '/' });
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = (value + '='.repeat((4 - (value.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function saveSubscription(sub: PushSubscription) {
  const { endpoint, keys } = sub.toJSON();
  await api.post('/push/subscriptions', { endpoint, keys });
}

/** Notificação de teste nos aparelhos ativados desta conta. */
export async function sendTestPush(): Promise<{ sent: number; enabled: boolean }> {
  const { data } = await api.post('/push/test');
  return data.data;
}

/**
 * Ao abrir o app logado: registra o service worker e, se este aparelho já
 * tem notificação ativada, confirma a inscrição no servidor (fica com o
 * usuário logado agora).
 */
export async function bootstrapPush(): Promise<void> {
  if (!hasPushApi()) return;
  const reg = await registration();
  if (Notification.permission !== 'granted') return;
  const sub = await reg.pushManager.getSubscription();
  if (sub) await saveSubscription(sub);
}

/** Sair da conta: este aparelho para de receber as notificações dela. */
export async function removeThisDevice(): Promise<void> {
  if (!hasPushApi()) return;
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await api.delete('/push/subscriptions', { data: { endpoint: sub.endpoint } }).catch(() => undefined);
  await sub.unsubscribe().catch(() => undefined);
}

/** Número no ícone do app (some com 0). */
export function setAppBadge(count: number) {
  const nav = navigator as Navigator & {
    setAppBadge?: (n?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  if (!nav.setAppBadge) return;
  (count > 0 ? nav.setAppBadge(count) : nav.clearAppBadge?.())?.catch(() => undefined);
}

export function usePushNotifications() {
  const [state, setState] = useState<PushState>('loading');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!hasPushApi()) {
      setState(typeof window !== 'undefined' && isIos() && !isStandalone() ? 'needs-install' : 'unsupported');
      return;
    }
    try {
      const cfg = await serverConfig();
      if (!cfg.enabled) return setState('not-configured');
      if (Notification.permission === 'denied') return setState('denied');
      const reg = await navigator.serviceWorker.getRegistration('/');
      const sub = await reg?.pushManager.getSubscription();
      setState(sub && Notification.permission === 'granted' ? 'on' : 'off');
    } catch {
      setState('unsupported');
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /** Precisa ser chamado num toque/clique (exigência do iPhone). */
  const enable = useCallback(async () => {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'off');
        return false;
      }
      const cfg = await serverConfig();
      if (!cfg.enabled || !cfg.publicKey) {
        setState('not-configured');
        return false;
      }
      const reg = await registration();
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToBytes(cfg.publicKey),
        }));
      await saveSubscription(sub);
      setState('on');
      return true;
    } finally {
      setBusy(false);
    }
  }, []);

  const disable = useCallback(async () => {
    setBusy(true);
    try {
      await removeThisDevice();
      setAppBadge(0);
      setState('off');
    } finally {
      setBusy(false);
    }
  }, []);

  return { state, busy, enable, disable, refresh };
}
