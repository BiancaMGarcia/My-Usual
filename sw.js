const CACHE = "my-usual-v49-item-card-spacing";
const ASSETS = ["./", "./index.html", "./styles.css?v=49", "./app.js?v=49", "./manifest.webmanifest?v=49", "./icon-192.png?v=49", "./icon-512.png?v=49", "./avatar-husky-blue.png?v=49", "./avatar-brown-peach.png?v=49", "./avatar-samoyed-lavender.png?v=49", "./avatar-white-mint.png?v=49", "./avatar-spitz-pink.png?v=49", "./avatar-shepherd-yellow.png?v=49"];

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
