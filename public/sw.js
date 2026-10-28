/*
 * Service worker do UniSimpremium (app na Tela de Início).
 *
 * Push: conversa nova ou mensagem nova em "Não respondidas", "IA para
 * Humano" ou "IA Aguardando". O payload (PushPayload no servidor) traz
 * título, texto, a página a abrir e o número do ícone do app.
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'UniSimpremium', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'UniSimpremium';
  const tasks = [
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag,
      renotify: !!data.tag,
      data: { url: data.url || '/inbox' },
    }),
  ];
  if (typeof data.badge === 'number' && self.navigator && 'setAppBadge' in self.navigator) {
    tasks.push(
      (data.badge > 0 ? self.navigator.setAppBadge(data.badge) : self.navigator.clearAppBadge()).catch(() => {}),
    );
  }
  event.waitUntil(Promise.all(tasks));
});

// Toque na notificação: abre (ou foca) o app na conversa.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/inbox', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (new URL(w.url).origin === self.location.origin && 'focus' in w) {
          return w.focus().then((c) => (c && 'navigate' in c ? c.navigate(target) : undefined));
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
