// Concept pages must never be indexed (they would compete with the real
// business in search). The portfolio index follows the `indexable` switch.
import { client, clientUrl } from '../lib/client';
import type { APIRoute } from 'astro';
import { demos } from '../lib/demos';
import { site } from '../lib/site';

export const GET: APIRoute = () => {
  // A launched business site (src/lib/client.ts) is meant to be found.
  if (client) return new Response(`User-agent: *\nAllow: /\n${clientUrl ? `\nSitemap: ${clientUrl}/sitemap.xml\n` : ''}`, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  const lines = ['User-agent: *'];
  if (!site.indexable) lines.push('Disallow: /');
  else lines.push('Allow: /$', ...demos.map((d) => `Disallow: /${d.slug}/`), 'Disallow: /shots/', 'Disallow: /demo-assets/', 'Disallow: /cards/', '', `Sitemap: ${site.url}/sitemap.xml`);
  return new Response(`${lines.join('\n')}\n`, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
};
