// public/service-worker.js

const CACHE_NAME = "financas-offline-v2";

// Só arquivos que realmente existem em produção
const ASSETS_TO_CACHE = [
  "/",
  "/index.html",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png"
];

// Instalação: pré-cacheia os arquivos principais
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// Ativação: limpa caches antigos
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch: usa cache primeiro; se não tiver, busca na rede e salva no cache.
// Se estiver offline e for navegação de página, cai pro index.html.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  // Ignora requisições que não são http/https (ex: chrome-extension)
  if (!event.request.url.startsWith("http")) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone);
          });
          return response;
        })
        .catch(() => {
          // Se for navegação (abrir página) e deu erro, mostra o app
          if (event.request.mode === "navigate") {
            return caches.match("/index.html");
          }
          // Para outros arquivos, só falha silenciosamente
          return new Response("Você está offline.", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        });
    })
  );
});
