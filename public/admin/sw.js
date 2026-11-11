const CACHE = 'masters-admin-v1';
const OFFLINE_URLS = ['/admin/', '/admin/index.html'];

// Instalar — cacheia o shell
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(OFFLINE_URLS)).then(() => self.skipWaiting())
  );
});

// Ativar — limpa caches velhos
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch — network first, fallback cache
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (!e.request.url.includes('/admin')) return;
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});

// Push — notificação de nova venda
self.addEventListener('push', e => {
  // Payload pode vir vazio (ping) — usa título padrão
  let title = '💰 Nova venda!';
  let body  = 'Toque para ver no painel';
  try {
    if (e.data && e.data.text && e.data.text()) {
      const d = e.data.json();
      if (d.title) title = d.title;
      if (d.body)  body  = d.body;
    }
  } catch {}

  e.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/admin/icon-192.png',
      badge: '/admin/icon-192.png',
      vibrate: [300, 100, 300, 100, 300],
      tag: 'masters-venda',
      renotify: true,
      requireInteraction: true,
      data: { url: '/admin/' }
    )
  );
});

// Click na notificação — abre o admin
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const adminClient = list.find(c => c.url.includes('/admin'));
      if (adminClient) return adminClient.focus();
      return clients.openWindow('/admin/');
    })
  );
});
