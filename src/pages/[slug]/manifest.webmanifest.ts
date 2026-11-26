// Web app manifest per concept, so "Add to Home Screen" / "Install" uses the
// business's name, colours and icon, and opens straight to its page.
import { pageBase } from '../../lib/client';
import type { APIRoute } from 'astro';
import { demos, type Demo } from '../../lib/demos';
import { appName } from '../../lib/appicon';

export function getStaticPaths() {
  return demos.map((demo) => ({ params: { slug: demo.slug }, props: { demo } }));
}

export const GET: APIRoute = ({ props }) => {
  const demo = (props as { demo: Demo }).demo;
  const base = pageBase(demo.slug); // '/' on a launched site
  const manifest = {
    name: demo.name,
    short_name: appName(demo),
    description: demo.hero.lede,
    start_url: base,
    scope: base,
    display: 'standalone',
    background_color: demo.colors.bg,
    theme_color: demo.colors.primary,
    icons: [
      { src: `${base}icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `${base}icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: `${base}icon-maskable.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
  return new Response(JSON.stringify(manifest, null, 2), { headers: { 'content-type': 'application/manifest+json' } });
};
