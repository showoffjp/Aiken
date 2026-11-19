// Home-screen icons for each concept: /<slug>/icon-180.png (iPhone),
// icon-192.png and icon-512.png (Android), icon-maskable.png (Android's shaped icons).
import type { APIRoute } from 'astro';
import { demos, type Demo } from '../../lib/demos';
import { appIconPng } from '../../lib/appicon';

const SIZES = ['180', '192', '512', 'maskable'];
export function getStaticPaths() {
  return demos.flatMap((demo) => SIZES.map((size) => ({ params: { slug: demo.slug, size }, props: { demo } })));
}

export const GET: APIRoute = async ({ params, props }) => {
  const demo = (props as { demo: Demo }).demo;
  const png = await appIconPng(demo, params.size === 'maskable' ? 512 : Number(params.size), params.size === 'maskable');
  return new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png' } });
};
