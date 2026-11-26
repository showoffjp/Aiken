// Launch mode: build one concept as the business's own website.
//
//   CLIENT=<concept slug> CLIENT_URL=https://www.theirbusiness.com npm run build
//
// The concept moves to the root of the site (scripts/launch.mjs), the concept
// banner, tour and "what changed" notes are left out, search engines may list
// it, and the studio's own pages (home, checkups, SEO reports) are not built.
// See docs/LAUNCH.md for the whole checklist.

/** The concept being launched, or '' for the normal portfolio build. */
export const client = (process.env.CLIENT || '').trim();

/**
 * The launched site's public address, without a trailing slash. Falls back to the
 * Vercel project's production domain, which Vercel sets during its builds.
 */
export const clientUrl = (
  process.env.CLIENT_URL
  || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')
).trim().replace(/\/$/, '');

/**
 * Where the launched site's contact form posts (for example /api/contact once an
 * email service is connected). Without one, the live site shows the phone, email
 * and address but no form, so a message is never silently lost.
 */
export const clientForm = (process.env.CLIENT_FORM_ENDPOINT || '').trim();

/** True when this concept is the one being launched. */
export const isClient = (slug: string) => client !== '' && client === slug;

/** Where a concept's page lives: its own folder, or the root of the business's site once launched. */
export const pageBase = (slug: string) => (isClient(slug) ? '/' : `/${slug}/`);
