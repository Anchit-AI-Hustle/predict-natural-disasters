/* The part of this site that runs while it is closed.
 *
 * It does one thing: show an alert the background service pushed, and open
 * the record when it is tapped. It caches nothing, so every page is always
 * fetched fresh, exactly as it was before this file existed.
 */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (event) { event.waitUntil(self.clients.claim()); });

self.addEventListener('push', function (event) {
  var msg = {};
  try { msg = event.data ? event.data.json() : {}; } catch (e) { msg = {}; }
  /* A push that arrives unreadable still has to show something - browsers
     penalise a push that shows nothing - and what it shows must not invent a
     hazard. */
  var title = msg.title || 'Predict Natural Disasters';
  var options = {
    body: msg.body || 'Open the site to see what changed near your places.',
    tag: msg.tag || 'pnd-alert',
    renotify: true,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    timestamp: Date.parse(msg.at || '') || Date.now(),
    data: { url: msg.url || '/personal-risk' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var path = (event.notification.data && event.notification.data.url) || '/personal-risk';
  /* Only ever a page of this site: a pushed URL is not a way to send someone
     elsewhere. */
  var target = new URL(path, self.location.origin);
  if (target.origin !== self.location.origin) target = new URL('/personal-risk', self.location.origin);
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].url === target.href && 'focus' in list[i]) return list[i].focus();
    }
    return self.clients.openWindow(target.href);
  }));
});

/* The browser replaced the subscription (keys rotated, or it expired). The
   old one is dead at the push service, so the new one has to reach the store
   or alerts stop silently. The places come from the page's last sync. */
self.addEventListener('pushsubscriptionchange', function (event) {
  event.waitUntil((async function () {
    var cfg = await fetch('/api/alerts', { cache: 'no-store' }).then(function (r) { return r.json(); });
    if (!cfg.available || !cfg.publicKey) return;
    var sub = await self.registration.pushManager.subscribe({
      userVisibleOnly: true, applicationServerKey: keyBytes(cfg.publicKey)
    });
    var places = await placesFromCache();
    if (!places || !places.length) return;
    if (event.oldSubscription) {
      await fetch('/api/alerts', { method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: event.oldSubscription.endpoint }) });
    }
    await fetch('/api/alerts', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON(), places: places }) });
  })());
});

/* The rounded places last sent, kept where a worker can read them. */
self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'pnd-places') {
    event.waitUntil(caches.open('pnd-alert-places').then(function (c) {
      return c.put('/__pnd_places', new Response(JSON.stringify(event.data.places || [])));
    }));
  }
});
function keyBytes(b64u) {
  var s = String(b64u).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  var raw = atob(s), out = new Uint8Array(raw.length);
  for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
function placesFromCache() {
  return caches.open('pnd-alert-places')
    .then(function (c) { return c.match('/__pnd_places'); })
    .then(function (r) { return r ? r.json() : []; })
    .catch(function () { return []; });
}
