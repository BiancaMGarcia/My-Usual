const CACHE = "my-usual-v29-avatars-lookup";
const ASSETS = ["./", "./index.html", "./styles.css?v=29", "./app.js?v=29", "./manifest.webmanifest?v=29", "./icon-192.png?v=29", "./icon-512.png?v=29", "./avatar-husky-blue.png?v=29", "./avatar-brown-peach.png?v=29", "./avatar-samoyed-lavender.png?v=29", "./avatar-white-mint.png?v=29", "./avatar-spitz-pink.png?v=29", "./avatar-shepherd-yellow.png?v=29"];

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
