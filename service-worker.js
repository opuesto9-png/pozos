const CACHE_NAME = 'pozos-cache-v4';
const ASSETS = [
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];
// librerias externas que la app necesita para arrancar (Firebase y ExcelJS). Las guardamos en el
// celular la primera vez que se abre con señal, asi despues abren al instante aunque no haya señal.
const CDN_URLS = [
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore-compat.js',
  'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js'
];
// cuanto esperamos a la red antes de abrir la version guardada (señal mala = la red "cuelga", no falla)
const HTML_NETWORK_TIMEOUT_MS = 3000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      const tareas = [cache.addAll(ASSETS)];
      // best-effort: si alguna no baja ahora, se guarda igual la primera vez que la app la pida
      tareas.push(cache.add(new Request('./index.html', { cache: 'reload' })).catch(() => {}));
      CDN_URLS.forEach((u) => {
        tareas.push(cache.add(new Request(u, { mode: 'no-cors' })).catch(() => {}));
      });
      return Promise.all(tareas);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

function guardar(request, response) {
  if (!response) return;
  // las respuestas de CDN pedidas en modo no-cors son "opaque" (ok=false pero sirven igual)
  if (response.ok || response.type === 'opaque') {
    const clone = response.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)).catch(() => {});
  }
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = event.request.url;
  const isSameOrigin = url.startsWith(self.location.origin);
  const isHTML = event.request.mode === 'navigate' || url.endsWith('/') || url.endsWith('.html');

  if (isSameOrigin && isHTML) {
    // red primero (sin cache HTTP del navegador) para que las actualizaciones se vean al toque,
    // PERO con tope de espera: con señal mala la red no falla, se queda colgada, y la app no abria.
    // Si en 3 segundos no respondio, abrimos la version guardada; la descarga sigue en segundo plano
    // y la proxima vez que se abra ya esta la version nueva.
    event.respondWith((async () => {
      const cached = (await caches.match(event.request, { ignoreSearch: true })) || (await caches.match('./index.html'));
      const net = fetch(event.request, { cache: 'no-store' }).then((response) => {
        guardar(event.request, response);
        return response;
      });
      event.waitUntil(net.catch(() => {}));
      if (!cached) return net; // nunca se abrio con señal: no hay nada guardado, esperamos a la red
      const timeout = new Promise((resolve) => setTimeout(() => resolve(cached), HTML_NETWORK_TIMEOUT_MS));
      return Promise.race([net.catch(() => cached), timeout]);
    })());
    return;
  }

  if (isSameOrigin) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          guardar(event.request, response);
          return response;
        });
      })
    );
    return;
  }

  // librerias externas conocidas: primero lo guardado (abre al instante sin señal), y se refresca
  // en segundo plano cuando hay conexion
  if (CDN_URLS.includes(url)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const net = fetch(new Request(url, { mode: 'no-cors' })).then((response) => {
          guardar(event.request, response);
          return response;
        });
        if (cached) {
          event.waitUntil(net.catch(() => {}));
          return cached;
        }
        return net;
      })
    );
    return;
  }

  // cualquier otro recurso externo: directo a la red, sin tocar el cache
});
