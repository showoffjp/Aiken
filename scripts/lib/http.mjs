// Small fetch helper built on curl (curl handles proxies, legacy TLS and odd
// servers more gracefully than Node's fetch). Responses are cached on disk so
// re-running a collector never re-hits a site it already has.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CACHE_DIR = path.join(ROOT, '.cache');

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const key = (url) => createHash('sha1').update(url).digest('hex');

function curl(args, timeoutMs) {
  return new Promise((resolve) => {
    execFile('curl', args, { timeout: timeoutMs, maxBuffer: 1 << 20 }, (err, stdout, stderr) => {
      resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

/**
 * Fetch a URL. Returns { ok, status, finalUrl, headers, body, error }.
 * `bucket` namespaces the cache (e.g. "chamber", "sites").
 */
export async function fetchUrl(url, { bucket = 'misc', timeout = 30, refresh = false, maxBytes = 3_000_000 } = {}) {
  const dir = path.join(CACHE_DIR, bucket);
  await mkdir(dir, { recursive: true });
  const base = path.join(dir, key(url));
  const metaFile = `${base}.json`;
  const bodyFile = `${base}.body`;
  const hdrFile = `${base}.hdr`;

  if (!refresh && existsSync(metaFile)) {
    const meta = JSON.parse(await readFile(metaFile, 'utf8'));
    const body = existsSync(bodyFile) ? await readFile(bodyFile, 'utf8') : '';
    return { ...meta, body, cached: true };
  }

  const args = [
    '-sS', '-L', '--compressed',
    '--max-redirs', '6',
    '-A', UA,
    // HTML only: some site builders answer with JSON if it is offered.
    '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    '-H', 'Accept-Language: en-US,en;q=0.9',
    '-m', String(timeout),
    '--max-filesize', String(maxBytes),
    '-D', hdrFile,
    '-o', bodyFile,
    '-w', '%{http_code}\t%{url_effective}\t%{ssl_verify_result}\t%{content_type}\t%{num_redirects}',
    url,
  ];
  const { err, stdout, stderr } = await curl(args, (timeout + 10) * 1000);
  const [code, finalUrl, sslVerify, contentType, redirects] = stdout.split('\t');
  const status = Number(code) || 0;
  let headers = '';
  try { headers = await readFile(hdrFile, 'utf8'); } catch {}
  const meta = {
    url,
    ok: status >= 200 && status < 400,
    status,
    finalUrl: finalUrl || url,
    contentType: contentType || '',
    redirects: Number(redirects) || 0,
    sslVerify: sslVerify || '',
    headers,
    error: status ? '' : (stderr.trim() || (err && err.message) || 'unknown error').slice(0, 300),
    fetchedAt: new Date().toISOString(),
  };
  await writeFile(metaFile, JSON.stringify(meta));
  await rm(hdrFile, { force: true });
  let body = '';
  try { body = await readFile(bodyFile, 'utf8'); } catch {}
  return { ...meta, body, cached: false };
}

/** Run `fn` over `items` with bounded concurrency, preserving order. */
export async function pool(items, concurrency, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try { out[i] = await fn(items[i], i); } catch (e) { out[i] = { error: String(e) }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return out;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Decode the handful of HTML entities that show up in directory listings. */
export function decode(s = '') {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#0?38;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#8217;|&#8216;|&rsquo;|&lsquo;|&apos;/g, "'")
    .replace(/&#8211;|&ndash;/g, '-')
    .replace(/&#8212;|&mdash;/g, '-')
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&eacute;|&#233;/g, 'é')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

export const stripTags = (s = '') => decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
