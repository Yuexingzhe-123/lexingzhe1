/* Offline-first static PWA. Bump this version when releasing a new build. */
const CACHE = 'cijian-paper-v1.2.0';
const OCR_CACHE = 'cijian-ocr-assets-v1';
const SHELL = [
  './', './index.html', './styles.css', './manifest.webmanifest',
  './src/app.mjs', './src/engine.mjs', './src/storage.mjs',
  './src/document-import.mjs', './src/cloud-ai.mjs', './src/reminders.mjs',
  './vendor/pdf/pdf.min.mjs', './vendor/pdf/pdf.worker.min.mjs',
  './vendor/tesseract/tesseract.min.js', './vendor/tesseract/worker.min.js',
  './data/cet4.tsv', './data/cet6.tsv',
  './icons/icon-192.png', './icons/icon-512.png',
  './VOCABULARY-LICENSE.txt'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE && key !== OCR_CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await caches.match(req);
    if (hit) return hit;
    try {
      const response = await fetch(req);
      if (response.ok && response.type === 'basic') cache.put(req, response.clone());
      return response;
    } catch {
      if (req.mode === 'navigate') return await cache.match('./index.html') || Response.error();
      return Response.error();
    }
  })());
});
