/*
 * Minimal service worker so the app can be installed on a phone's home screen.
 * It deliberately caches nothing: business data must always come fresh from the server,
 * and nothing private is left on the device. When offline, a short notice is shown for page loads.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate') return; // API calls and assets go straight to the network
  event.respondWith(
    fetch(event.request).catch(() => new Response(
      '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title>'
      + '<body style="font-family:system-ui;padding:32px;color:#374151"><h2>You are offline</h2><p>Stone Crusher Manager needs a connection to the server. Check the Wi-Fi and try again.</p></body>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    ))
  );
});
