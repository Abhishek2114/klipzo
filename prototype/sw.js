// Offline support: network first (so updates show), cache as fallback.
const CACHE = 'video-editor-v1';
self.addEventListener('install', e => e.waitUntil(
  caches.open(CACHE).then(c => c.addAll(['./', 'index.html', 'manifest.webmanifest', 'icon.svg'])).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Hugging Face model files are cached by the speech library itself
  if (e.request.method !== 'GET' || /huggingface\.co$|hf\.co$/.test(url.hostname)) return;
  e.respondWith(fetch(e.request).then(r => {
    if (r.status === 200 || r.type === 'opaque') { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request)));
});
