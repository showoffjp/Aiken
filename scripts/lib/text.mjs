// Turn a page's HTML into its readable lines of text: headings marked "#1".."#4",
// list items "- ", everything else one block per line. Shared by the digest
// (scripts/digest.mjs) and the spelling check (scripts/typos.mjs).
import { decode } from './http.mjs';

export function blocks(html) {
  // Old hand-edited pages often have content outside <body>, so drop the
  // <head> instead of trusting the body tags.
  const body = html.replace(/<head\b[\s\S]*?<\/head>/i, ' ')
    .replace(/<(script|style|noscript|svg|iframe|select|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const marked = body
    .replace(/<h([1-4])\b[^>]*>/gi, '\n\n#$1 ')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<(br|\/p|\/div|\/tr|\/h[1-6]|\/li|\/td|\/th|\/section|\/article|\/table|\/ul|\/ol|\/dd|\/dt|\/blockquote|\/address|\/figcaption)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decode(marked).split('\n').map((l) => l.replace(/[ \t ]+/g, ' ').trim()).filter((l) => l.length > 1);
}
