const CACHE = 'djmusta-v6';
const STATIC = [
  '/',
  '/index.html',
  '/offline.html',
  '/404.html',
  '/site.webmanifest',
  '/banner.jpg',
  '/favicon.ico',
  '/favicon-96x96.png',
  '/apple-touch-icon.png',
  '/song-router.js',
  '/download-enhancement.js',
  '/language-support.js',
  '/extended-features.js',
  '/advanced-features.js',
  '/ui-enhancements.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/web-app-manifest-192x192.png',
  '/web-app-manifest-512x512.png',
  '/translations/en.json',
  '/translations/lg.json',
  '/translations/xog.json'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(async cache => {
    await Promise.all(STATIC.map(async asset => {
      try { await cache.add(asset); } catch (error) { console.warn('Cache skipped:', asset); }
    }));
  }).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  // Only cache GET requests, skip API and audio
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('/api/')) return;
  if (e.request.url.includes('mustabackend')) return;
  if (e.request.url.includes('.mp3')) return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request).then(cached => {
        if (cached) return cached;
        if (e.request.mode === 'navigate') return caches.match('/offline.html');
        return new Response('Offline', { status: 503 });
      }))
  );
});

// ============================================================
// PUSH NOTIFICATIONS
// ============================================================

// When a push notification arrives from the server
self.addEventListener('push', e => {
  let data = {
    title: '🎵 DJ Musta Music',
    body: 'New songs just dropped! Come listen.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    url: '/'
  };

  if (e.data) {
    try {
      const payload = e.data.json();
      data = { ...data, ...payload };
    } catch {
      data.body = e.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: data.icon || '/icons/icon-192.png',
    badge: data.badge || '/icons/icon-192.png',
    image: data.image || undefined,
    tag: data.tag || 'djmusta-notification',
    renotify: true,
    requireInteraction: false,
    vibrate: [200, 100, 200],
    data: { url: data.url || '/', songId: data.songId || null },
    actions: [
      { action: 'play', title: '▶ Play Now' },
      { action: 'dismiss', title: 'Dismiss' }
    ]
  };

  e.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// When user taps the notification
self.addEventListener('notificationclick', e => {
  e.notification.close();

  const url = e.notification.data?.url || '/';
  const songId = e.notification.data?.songId;
  const targetUrl = songId ? `/?song=${songId}` : url;

  if (e.action === 'dismiss') return;

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // If site is already open, focus it and navigate
      for (const client of windowClients) {
        if (client.url.includes('djmusta.com') || client.url.includes('localhost')) {
          client.focus();
          client.navigate(targetUrl);
          return;
        }
      }
      // Otherwise open a new tab
      return clients.openWindow(targetUrl);
    })
  );
});

