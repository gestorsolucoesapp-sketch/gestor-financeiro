// Gestor Soluções · Service Worker (offline shell + push)
const CACHE = 'gf-shell-v112';
const CORE = [
  './', 'index.html', 'manifest.json',
  'icon-192.png', 'icon-512.png', 'apple-touch-icon.png',
  'assets/supabase.js', 'assets/logo.jpg'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(CORE.map(u => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return; // gravações do Supabase (POST/PATCH) passam direto
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  // marcador de versão → sempre da rede, nunca cacheia (auto-update)
  if (sameOrigin && url.pathname.endsWith('version.json')) {
    e.respondWith(fetch(req, { cache: 'no-store' }).catch(() => new Response('{}', { headers: { 'Content-Type': 'application/json' } })));
    return;
  }
  // Imagens (logos de bancos etc) → cache-first, qualquer origem
  if (req.destination === 'image') {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res && (res.status === 200 || res.type === 'opaque')) {
          const cp = res.clone(); caches.open(CACHE).then(c => c.put(req, cp));
        }
        return res;
      }).catch(() => hit))
    );
    return;
  }
  // API de dados do Supabase e qualquer outra origem → nunca intercepta
  if (!sameOrigin) return;

  // App/HTML → network-first: online pega a versão nova, offline usa a cópia salva
  const isDoc = req.mode === 'navigate' ||
    (sameOrigin && (url.pathname.endsWith('/') || url.pathname.endsWith('index.html')));
  if (isDoc) {
    e.respondWith(
      fetch(req)
        .then(res => { const cp = res.clone(); caches.open(CACHE).then(c => c.put('index.html', cp)); return res; })
        .catch(() => caches.match('index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  // Demais assets (ícones, manifest, supabase-js) → cache-first
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res && res.status === 200) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(req, cp)); }
      return res;
    }).catch(() => hit))
  );
});

// ---- Push (fase 2) ----
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data.json(); } catch (_) { data = { title: 'Gestor Financeiro', body: (e.data && e.data.text()) || '' }; }
  const title = data.title || 'Gestor Financeiro';
  const opts = { body: data.body || '', icon: 'icon-192.png', badge: 'icon-192.png', data: data.url || './', vibrate: [80, 40, 80] };
  e.waitUntil(self.registration.showNotification(title, opts));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(list => {
    for (const c of list) { if ('focus' in c) return c.focus(); }
    if (self.clients.openWindow) return self.clients.openWindow(e.notification.data || './');
  }));
});
