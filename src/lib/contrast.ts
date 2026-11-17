// Derive text colours from a concept's palette that meet WCAG AA contrast
// (4.5:1 for normal text), so every concept passes automatically whatever
// brand colours it is given.
type RGB = [number, number, number];
const hex = (h: string): RGB => {
  const s = h.replace('#', '');
  const f = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16)) as RGB;
};
const toHex = (c: RGB) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
const lum = (c: RGB) => {
  const [r, g, b] = c.map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const ratio = (a: string, b: string) => {
  const [x, y] = [lum(hex(a)), lum(hex(b))].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
const mix = (a: string, b: string, t: number) => { const A = hex(a), B = hex(b); return toHex(A.map((v, i) => v + (B[i] - v) * t) as RGB); };

/** Move `fg` toward `toward` in small steps until it reaches `min` contrast on `bg`. */
export function ensure(fg: string, bg: string, toward: string, min = 4.5): string {
  if (ratio(fg, bg) >= min) return fg;
  for (let t = 0.05; t <= 1.0001; t += 0.05) { const c = mix(fg, toward, t); if (ratio(c, bg) >= min) return c; }
  return toward;
}
/** Of several candidates, the one with the most contrast on `bg`. */
export const best = (bg: string, ...cands: string[]) => cands.sort((a, b) => ratio(b, bg) - ratio(a, bg))[0];

export function accessible(c: { bg: string; surface: string; ink: string; primary: string; onPrimary: string; accent: string }) {
  const dark = lum(hex(c.bg)) < 0.2;
  const onPrimary = ratio(c.onPrimary, c.primary) >= 4.5 ? c.onPrimary : best(c.primary, c.onPrimary, '#ffffff', '#111111');
  const toward = dark ? '#ffffff' : c.ink;
  const soft = mix(c.bg, c.primary, 0.09);
  // The animated background washes the page with up to ~18% of the primary or
  // accent colour, so text must also hold up on those tints.
  const tintP = mix(c.bg, c.primary, 0.18), tintA = mix(c.bg, c.accent, 0.18);
  const onAll = (fg: string) => [c.bg, c.surface, soft, tintP, tintA].reduce((f, bg) => ensure(f, bg, toward), fg);
  const primaryText = onAll(c.primary);
  const onAccent = best(c.accent, c.ink, c.bg, '#111111', '#ffffff');
  const accentBtn = ratio(onAccent, c.accent) >= 4.5 ? c.accent : ensure(c.accent, onAccent, lum(hex(onAccent)) > 0.5 ? '#000000' : '#ffffff');
  return {
    '--on-primary': onPrimary,
    '--primary-text': primaryText,
    '--accent-on-primary': ensure(c.accent, c.primary, ratio('#ffffff', c.primary) > ratio('#000000', c.primary) ? '#ffffff' : '#000000'),
    '--accent-on-photo': ensure(c.accent, '#0d0f13', '#ffffff'),
    '--on-accent': onAccent,
    '--accent-btn': accentBtn,
    '--on-primary-soft': ratio(onPrimary, c.primary) >= 8 ? `color-mix(in srgb, ${onPrimary} 84%, transparent)` : onPrimary,
    '--foot-muted': ensure(mix(c.bg, c.ink, 0.45), c.ink, c.bg),
    '--muted-text': [c.bg, c.surface, soft, tintP, tintA].reduce((f, bg) => ensure(f, bg, c.ink), (c as { muted?: string }).muted || c.ink),
  };
}
