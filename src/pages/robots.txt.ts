// Concept pages must never be indexed (they would compete with the real
// business in search). The portfolio index follows the `indexable` switch.
import type { APIRoute } from 'astro';
import { demos } from '../lib/demos';
import { site } from '../lib/site';

export const GET: APIRoute = () => {
  const lines = ['User-agent: *'];
  if (!site.indexable) lines.push('Disallow: /');
  else lines.push('Allow: /$', ...demos.map((d) => `Disallow: /${d.slug}/`), 'Disallow: /shots/', 'Disallow: /demo-assets/', 'Disallow: /cards/', '', `Sitemap: ${site.url}/sitemap.xml`);
  return new Response(`${lines.join('\n')}\n`, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
};
