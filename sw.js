// Gestor Soluções · Service Worker
self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(self.clients.claim()); });

// Sem cache de conteúdo (evita servir versão antiga do app)
self.addEventListener('fetch', e => { /* deixa o navegador buscar normalmente */ });

// Push (fase 2): mostra a notificação na tela do celular
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data.json(); } catch (_) { data = { title: 'Gestor Financeiro', body: (e.data && e.data.text()) || '' }; }
  const title = data.title || 'Gestor Financeiro';
  const opts = {
    body: data.body || '',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    data: data.url || './',
    vibrate: [80, 40, 80]
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(list => {
    for (const c of list) { if ('focus' in c) return c.focus(); }
    if (self.clients.openWindow) return self.clients.openWindow(e.notification.data || './');
  }));
});
