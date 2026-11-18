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
const hsl = (h: string) => {
  const [r, g, b] = hex(h).map((v) => v / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const hh = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [hh * 60, s, l];
};
const fromHsl = (h: number, s: number, l: number) => {
  const k = (n: number) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return toHex([f(0) * 255, f(8) * 255, f(4) * 255]);
};
/** A third colour for gradients: the primary's hue turned 40 degrees away from the accent, kept lively. */
export function hue3(primary: string, accent: string) {
  const [hp, sp] = hsl(primary), [ha] = hsl(accent);
  const dir = ((ha - hp + 540) % 360) - 180 > 0 ? -1 : 1;
  return fromHsl((hp + dir * 40 + 360) % 360, Math.max(0.45, Math.min(0.8, sp + 0.1)), 0.5);
}
/** A second gradient stop: the primary's hue turned ~25 degrees toward the
 *  accent (never a muddy blend of opposites), still readable under the label. */
function primary2(primary: string, accent: string, label: string) {
  const [hp, sp, lp] = hsl(primary), [ha] = hsl(accent);
  const dir = ((ha - hp + 540) % 360) - 180 >= 0 ? 1 : -1;
  const lighter = lum(hex(label)) < 0.5; // dark label: the stop may go lighter, else darker
  for (const dh of [26, 18, 34, 10])
    for (const dl of [0, 0.05, 0.1, 0.15]) {
      const x = fromHsl((hp + dir * dh + 360) % 360, Math.min(1, sp * 1.08 + 0.04), Math.max(0, Math.min(1, lp + (lighter ? dl : -dl))));
      if (ratio(label, x) >= 4.5) return x;
    }
  return primary;
}
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
  // The vivid hero and section gradients go up to ~30% of the theme colours.
  const tintP = mix(c.bg, c.primary, 0.3), tintA = mix(c.bg, c.accent, 0.3), tintH = mix(c.bg, hue3(c.primary, c.accent), 0.3);
  const grounds = [c.bg, c.surface, soft, tintP, tintA, tintH, mix(c.bg, c.primary, 0.15), mix(c.bg, c.accent, 0.15)];
  const onAll = (fg: string) => grounds.reduce((f, bg) => ensure(f, bg, toward), fg);
  const primaryText = onAll(c.primary);
  const onAccent = best(c.accent, c.ink, c.bg, '#111111', '#ffffff');
  const accentBtn = ratio(onAccent, c.accent) >= 4.5 ? c.accent : ensure(c.accent, onAccent, lum(hex(onAccent)) > 0.5 ? '#000000' : '#ffffff');
  // Two dark grounds in the theme colour (chalkboard, ticker, blueprint) that
  // keep white text at 7:1 or better, and an accent that reads on each.
  const deepOf = (base: string, t: number) => { let d = mix(base, c.primary, t); while (ratio('#ffffff', d) < 7) d = mix(d, '#000000', 0.1); return d; };
  const deep = deepOf('#101418', 0.28), deep2 = deepOf('#0a1428', 0.42);
  return {
    '--deep': deep,
    '--deep2': deep2,
    '--accent-on-deep': ensure(c.accent, deep, '#ffffff'),
    '--accent-on-deep2': ensure(c.accent, deep2, '#ffffff'),
    '--on-primary': onPrimary,
    '--primary-text': primaryText,
    '--accent-on-primary': ensure(c.accent, c.primary, ratio('#ffffff', c.primary) > ratio('#000000', c.primary) ? '#ffffff' : '#000000'),
    '--accent-on-photo': ensure(c.accent, '#0d0f13', '#ffffff'),
    '--on-accent': onAccent,
    '--accent-btn': accentBtn,
    '--on-primary-soft': ratio(onPrimary, c.primary) >= 8 ? `color-mix(in srgb, ${onPrimary} 84%, transparent)` : onPrimary,
    '--foot-muted': ensure(mix(c.bg, c.ink, 0.45), c.ink, c.bg),
    '--muted-text': grounds.reduce((f, bg) => ensure(f, bg, c.ink), (c as { muted?: string }).muted || c.ink),
    // Headings and body ink, held to 4.5:1 on every light ground above.
    '--ink-safe': onAll(c.ink),
    // An accent that reads as text on the light grounds (gradient headlines).
    '--accent-text': onAll(c.accent),
    // A third, related hue for gradients, and a second button stop that keeps
    // the button label readable.
    '--hue3': hue3(c.primary, c.accent),
    '--primary-2': primary2(c.primary, c.accent, onPrimary),
  };
}
