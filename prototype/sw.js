// Offline support: network first (so updates show), cache as fallback.
const CACHE = 'klipzo-beta-v1';
self.addEventListener('install', e => e.waitUntil(
  caches.open(CACHE).then(c => c.addAll(['./', 'index.html', 'manifest.webmanifest', 'icon.svg'])).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// Cross-origin isolation lets the speech engine use several CPU cores (~1.5x faster).
// GitHub Pages can't send these headers, so they are added here; browsers without
// 'credentialless' support (Safari) ignore it and simply stay single-core.
const isolate = r => {
  if (!r || r.type === 'opaque' || r.status === 0) return r;
  const headers = new Headers(r.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
  return new Response(r.body, { status: r.status, statusText: r.statusText, headers });
};

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Hugging Face model files are cached by the speech library itself
  if (e.request.method !== 'GET' || /huggingface\.co$|hf\.co$/.test(url.hostname)) return;
  const own = url.origin === self.location.origin;
  // Own files: always ask the server whether they changed (GitHub Pages lets browsers reuse a copy for 10 min,
  // so visitors saw old versions after an update). Unchanged files come back as a tiny "304 not modified".
  e.respondWith((own ? fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }) : fetch(e.request)).then(r => {
    if (r.status === 200 || r.type === 'opaque') { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return own ? isolate(r) : r;
  }).catch(() => caches.match(e.request).then(r => (own ? isolate(r) : r))));
});
