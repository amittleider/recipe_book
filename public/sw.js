// Offline shell cache — network-first.
// Vite emits content-hashed asset filenames, so instead of a static precache
// list we cache same-origin GET responses at runtime. We go to the network
// first and fall back to the cache only when offline, so a new deploy is picked
// up on the next launch instead of being pinned behind a stale cache.
// Google API requests (cross-origin) are never cached.
const CACHE = 'nos-recettes-v2'

self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return // skip Google API, etc.

  // Network-first: serve fresh content when online, refreshing the cache; fall
  // back to the cached copy only when the network is unavailable (offline).
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      try {
        const response = await fetch(request)
        if (response && response.status === 200) {
          cache.put(request, response.clone())
        }
        return response
      } catch (err) {
        const cached = await cache.match(request)
        if (cached) return cached
        throw err
      }
    })
  )
})
