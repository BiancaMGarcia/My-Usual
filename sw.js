const CACHE = "my-usual-v59-auto-update";
const CORE_ASSETS = ["./", "./index.html", "./styles.css?v=59", "./app.js?v=59"];
const OPTIONAL_ASSETS = ["./manifest.webmanifest?v=59", "./icon-192.png?v=59", "./icon-512.png?v=59", "./avatar-husky-blue.png?v=59", "./avatar-brown-peach.png?v=59", "./avatar-samoyed-lavender.png?v=59", "./avatar-white-mint.png?v=59", "./avatar-spitz-pink.png?v=59", "./avatar-shepherd-yellow.png?v=59"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(async cache=>{await cache.addAll(CORE_ASSETS);await Promise.allSettled(OPTIONAL_ASSETS.map(asset=>cache.add(asset)));}));
  self.skipWaiting();
});

self.addEventListener("message",event=>{if(event.data?.type==="SKIP_WAITING")self.skipWaiting();});

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
    fetch(event.request,{cache:"no-store"})
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
