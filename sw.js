const CACHE = "my-usual-v50-sticky-popup-controls";
const ASSETS = ["./", "./index.html", "./styles.css?v=50", "./app.js?v=50", "./manifest.webmanifest?v=50", "./icon-192.png?v=50", "./icon-512.png?v=50", "./avatar-husky-blue.png?v=50", "./avatar-brown-peach.png?v=50", "./avatar-samoyed-lavender.png?v=50", "./avatar-white-mint.png?v=50", "./avatar-spitz-pink.png?v=50", "./avatar-shepherd-yellow.png?v=50"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then(cached => cached || caches.match("./index.html")))
  );
});
