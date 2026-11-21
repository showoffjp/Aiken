// A small service worker per concept, scoped to /<slug>/. Once someone has
// opened the page, it keeps a copy of the page, its styles, fonts and photos,
// so the page still opens with no signal (the number, hours and address are
// always at hand). The page itself is fetched fresh whenever there is a
// connection; the copy is only a fallback.
import type { APIRoute } from 'astro';
import { demos, type Demo } from '../../lib/demos';

export function getStaticPaths() {
  return demos.map((demo) => ({ params: { slug: demo.slug }, props: { demo } }));
}

// Changes on every build, so a new deploy installs a new worker and clears
// the old copies.
const BUILD = Date.now().toString(36);

export const GET: APIRoute = ({ props }) => {
  const { slug } = (props as { demo: Demo }).demo;
  const js = `// Offline copy of /${slug}/ (build ${BUILD})
const CACHE = ${JSON.stringify(`${slug}-${BUILD}`)};
const PAGE = ${JSON.stringify(`/${slug}/`)};
const ASSET = new RegExp(${JSON.stringify(`^/(_astro|fonts|demo-assets/${slug})/|^/${slug}/(icon-|manifest)`)});

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const res = await fetch(PAGE, { cache: 'no-cache' });
    if (!res.ok) return;
    const html = await res.clone().text();
    await cache.put(PAGE, res);
    const urls = new Set();
    for (const m of html.matchAll(/(?:href|src)="(\\/[^"#?]+)"/g)) if (ASSET.test(m[1])) urls.add(m[1]);
    // Photos are listed in srcset too; keep the smallest copy of each so the
    // offline page has its pictures without a big download.
    for (const m of html.matchAll(/srcset="([^"]+)"/g)) {
      const first = m[1].split(',')[0].trim().split(/\\s+/)[0];
      if (ASSET.test(first)) urls.add(first);
    }
    // Ask the server, not the browser's own cache, so a photo replaced under the
    // same name is saved as the new picture rather than the old one.
    await Promise.all([...urls].slice(0, 60).map((u) => cache.add(new Request(u, { cache: 'no-cache' })).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE && key.startsWith(${JSON.stringify(`${slug}-`)})) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (req.mode === 'navigate') {
    if (url.pathname !== PAGE) return;
    // Fresh when online, the saved copy when not.
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) (await caches.open(CACHE)).put(PAGE, res.clone());
        return res;
      } catch {
        return (await caches.match(PAGE)) || Response.error();
      }
    })());
    return;
  }
  if (!ASSET.test(url.pathname)) return;
  // Styles, fonts and photos: the saved copy first, refreshed in the background.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    // The background refresh checks with the server (no-cache), so a replaced
    // photo reaches the saved copy instead of the browser's older one.
    const net = (init) => fetch(req, init).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; });
    if (hit) { event.waitUntil(net({ cache: 'no-cache' }).catch(() => {})); return hit; }
    return net();
  })());
});
`;
  return new Response(js, { headers: { 'content-type': 'text/javascript; charset=utf-8' } });
};
