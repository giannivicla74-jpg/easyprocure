/**
 * DocuProcure - Service Worker
 * 
 * Strategia di caching ibrida:
 * - Cache-First per tutti gli asset statici dell'Application Shell (HTML, CSS, JS, Icone, Manifest)
 * - Network-First con fallback in Cache per dati dinamici o chiamate esterne
 * - Pulizia selettiva e invalidazione versioni obsolete durante 'activate'
 * - Offline-First garantito per tutto il flusso operativo dell'Ufficio Acquisti
 */

const CACHE_VERSION = 'docuprocure-v2.2.0';
const STATIC_CACHE_NAME = `docuprocure-static-${CACHE_VERSION}`;
const DYNAMIC_CACHE_NAME = `docuprocure-dynamic-${CACHE_VERSION}`;

// Risorse critiche dell'Application Shell da pre-caricare all'installazione
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './db.js',
  './parser.js',
  './rdo.js',
  './lib/pdf.min.js',
  './lib/pdf.worker.min.js',
  './lib/tesseract.min.js',
  './manifest.json',
  './icons/icon-192.svg',
  './icons/icon-512.svg'
];

/* ==========================================================================
   FASE 1: INSTALLAZIONE SERVICE WORKER (Precaching)
   ========================================================================== */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME)
      .then((cache) => {
        return cache.addAll(PRECACHE_ASSETS);
      })
      .then(() => {
        // Forza l'attivazione immediata del Service Worker senza attendere la chiusura dei tab
        return self.skipWaiting();
      })
      .catch((err) => {
        console.error('[SW] Errore critico nel precaching:', err);
      })
  );
});

/* ==========================================================================
   FASE 2: ATTIVAZIONE & PULIZIA CACHE OBSOLETE (Cleanup)
   ========================================================================== */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            // Elimina tutte le cache che non corrispondono alla versione attiva corrente
            if (cacheName !== STATIC_CACHE_NAME && cacheName !== DYNAMIC_CACHE_NAME) {
              console.log('[SW] Rimozione cache obsoleta:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        // Prende immediatamente il controllo di tutti i client aperti
        return self.clients.claim();
      })
  );
});

/* ==========================================================================
   FASE 3: GESTIONE RICHIESTE DI RETE (Fetch Strategy)
   ========================================================================== */
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Gestisce solo richieste GET HTTP/HTTPS
  if (request.method !== 'GET' || !url.protocol.startsWith('http')) {
    return;
  }

  // Verifica se la richiesta riguarda un asset statico locale (Cache-First)
  const isStaticAsset = PRECACHE_ASSETS.some(asset => {
    const normalizedAsset = new URL(asset, self.location.origin).pathname;
    return url.pathname === normalizedAsset || url.pathname.endsWith('.css') || url.pathname.endsWith('.js') || url.pathname.endsWith('.svg') || url.pathname.endsWith('.json');
  });

  if (isStaticAsset) {
    // -------------------------------------------------------------
    // STRATEGIA 1: CACHE-FIRST (con aggiornamento background facoltativo)
    // -------------------------------------------------------------
    event.respondWith(
      caches.match(request)
        .then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }

          // Se non presente in cache statica, prova a prelevarlo da rete e salvarlo
          return fetch(request)
            .then((networkResponse) => {
              if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
                return networkResponse;
              }
              const responseToCache = networkResponse.clone();
              caches.open(STATIC_CACHE_NAME).then((cache) => {
                cache.put(request, responseToCache);
              });
              return networkResponse;
            })
            .catch(() => {
              // Se fallisce e si tratta di navigazione, restituisce index.html
              if (request.mode === 'navigate') {
                return caches.match('./index.html');
              }
            });
        })
    );
  } else {
    // -------------------------------------------------------------
    // STRATEGIA 2: NETWORK-FIRST con fallback in cache
    // Per chiamate API, risorse dinamiche e dati esterni
    // -------------------------------------------------------------
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(DYNAMIC_CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // Fallback alla copia in cache se offline
          return caches.match(request).then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            if (request.mode === 'navigate') {
              return caches.match('./index.html');
            }
            return new Response(
              JSON.stringify({ error: 'Offline', message: 'Connessione assente. Risorsa non disponibile in cache locale.' }),
              {
                status: 503,
                headers: { 'Content-Type': 'application/json' }
              }
            );
          });
        })
    );
  }
});

/* ==========================================================================
   FASE 4: COMUNICAZIONE TRAMITE MESSAGGI
   ========================================================================== */
self.addEventListener('message', (event) => {
  if (event.data && event.data.action === 'skipWaiting') {
    self.skipWaiting();
  }
});
