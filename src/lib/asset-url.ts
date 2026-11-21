// URL for a file in /public, with a short fingerprint of its contents as ?v=.
// Screenshots and thumbnails keep their names when they are re-taken, so
// without this a browser (or the offline copy) can keep showing the old
// picture for days. Returns '' when the file does not exist.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const PUB = path.join(process.cwd(), 'public');
const seen = new Map<string, string>();

export function assetUrl(rel: string): string {
  if (seen.has(rel)) return seen.get(rel)!;
  const file = path.join(PUB, rel);
  const url = existsSync(file) ? `/${rel}?v=${createHash('sha1').update(readFileSync(file)).digest('hex').slice(0, 8)}` : '';
  seen.set(rel, url);
  return url;
}
