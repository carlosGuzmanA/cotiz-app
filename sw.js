/* =========================================================
   CotizaClima — Service Worker
   Estrategia:
     · Precache de todos los activos estáticos locales
     · Cache-first para activos locales
     · Network-first para CDN externo (fonts, FA, jsPDF)
     · Network-only para APIs de Firebase (siempre datos frescos)
     · Fallback offline → index.html en navegaciones
   ========================================================= */

const CACHE_VERSION = 'v1.1.2';
const CACHE_NAME = `cotizaclima-${CACHE_VERSION}`;

// Activos locales a precargar al instalar el SW
const PRECACHE_URLS = [
  './',
  './index.html',
  './quotes.html',
  './clients.html',
  './catalog.html',
  './aceptar.html',
  './assets/js/aceptar.js',
  './assets/css/aceptar.css',
  './assets/js/app.js',
  './assets/js/quote-persistence.js',
  './assets/js/firebase-auth.js',
  './assets/js/quotes-repo.js',
  './assets/js/client-repo.js',
  './assets/js/ranking-repo.js',
  './assets/js/catalog-repo.js',
  './assets/css/styles.css',
  './assets/css/quotes.css',
  './manifest.json',
  './assets/icons/icon.svg',
  './assets/icons/icon-maskable.svg',
  './assets/img/clark.svg',
  './assets/img/daikin.png',
  './assets/img/daitsu.png',
  './assets/img/hisense.svg',
  './assets/img/ika.png',
  './assets/img/kendal.svg',
  './assets/img/lg.svg',
  './assets/img/midea.png',
  './assets/img/tcl.webp',
  './assets/img/vesta.webp',
];

// Patrones de URL que nunca deben cachearse (APIs Firebase / Auth)
const NETWORK_ONLY_PATTERNS = [
  /firebaseio\.com/,
  /identitytoolkit\.googleapis\.com/,
  /securetoken\.googleapis\.com/,
];

// ── Install: precachear activos estáticos ──────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
      .then(() => self.clients.matchAll().then((clients) => {
                    clients.forEach((client) => client.navigate(client.url));
        })))
});

// ── Activate: limpiar cachés obsoletos ────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ── Fetch: estrategia según tipo de recurso ───────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Ignorar peticiones no-GET (POST, PUT, DELETE, etc.)
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 1. Firebase / Auth → siempre red (nunca cachear tokens ni datos)
  if (NETWORK_ONLY_PATTERNS.some((pattern) => pattern.test(request.url))) {
    event.respondWith(fetch(request));
    return;
  }

  // 2. Navegaciones HTML → cache-first; fallback a index.html cuando offline
  if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
            .then((response) => {
                const clone = response.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
                return response;
            })
            .catch(() => caches.match('./index.html'))
        );
        return;
    }

  // 3. Activos locales (mismo origen) → cache-first
  if (url.origin === self.location.origin) {
        event.respondWith(
            caches.match(request).then((cached) => {
            const fetchPromise = fetch(request).then((response) => {
                if (response && response.ok) {
                const clone = response.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
                }
                return response;
            });

            return cached || fetchPromise;
            })
        );
        return;
    }

    if (navigator.serviceWorker) {
        navigator.serviceWorker.addEventListener("controllerchange", () => {
            window.location.reload();
        });
    }

  // 4. Recursos externos (Google Fonts, Font Awesome, jsPDF CDN)
  //    → network-first, fallback a caché si hay error de red
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
