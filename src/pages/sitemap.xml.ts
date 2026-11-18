// Sitemap for search engines. Only the portfolio index is ever listed: concept,
// checkup and SEO pages stay out of search so they never compete with the real
// businesses. Empty until `indexable` is switched on in src/lib/site.ts.
import type { APIRoute } from 'astro';
import { site } from '../lib/site';

export const GET: APIRoute = () => {
  const urls = site.indexable && site.url ? [`${site.url}/`] : [];
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u}</loc><changefreq>weekly</changefreq></url>`).join('\n')}\n</urlset>\n`;
  return new Response(body, { headers: { 'content-type': 'application/xml; charset=utf-8' } });
};
