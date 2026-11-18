// Copy the self-hosted variable fonts into public/fonts so every concept page
// can load just the two families it uses (no third-party font requests).
import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'node_modules', '@fontsource-variable');
const out = path.join(root, 'public', 'fonts');
await mkdir(out, { recursive: true });

const LABELS = {
  archivo: 'Archivo', bitter: 'Bitter', 'bricolage-grotesque': 'Bricolage Grotesque', cormorant: 'Cormorant',
  'dm-sans': 'DM Sans', fraunces: 'Fraunces', inter: 'Inter', 'libre-franklin': 'Libre Franklin', lora: 'Lora',
  manrope: 'Manrope', 'nunito-sans': 'Nunito Sans', oswald: 'Oswald', outfit: 'Outfit',
  'playfair-display': 'Playfair Display', 'source-sans-3': 'Source Sans 3', 'space-grotesk': 'Space Grotesk', 'work-sans': 'Work Sans',
  unbounded: 'Unbounded', syne: 'Syne', caveat: 'Caveat', 'bodoni-moda': 'Bodoni Moda', 'big-shoulders-display': 'Big Shoulders Display',
  fredoka: 'Fredoka', 'jetbrains-mono': 'JetBrains Mono', anybody: 'Anybody',
};
const SERIF = new Set(['bitter', 'cormorant', 'fraunces', 'lora', 'playfair-display', 'bodoni-moda']);
const MONO = new Set(['jetbrains-mono']);
const SCRIPT = new Set(['caveat']);

const manifest = {};
for (const id of await readdir(src)) {
  const files = path.join(src, id, 'files');
  const normal = `${id}-latin-wght-normal.woff2`;
  const italic = `${id}-latin-wght-italic.woff2`;
  if (!existsSync(path.join(files, normal))) continue;
  await copyFile(path.join(files, normal), path.join(out, `${id}.woff2`));
  const entry = { family: LABELS[id] || id, fallback: SERIF.has(id) ? 'Georgia, "Times New Roman", serif' : MONO.has(id) ? 'ui-monospace, "SF Mono", Menlo, Consolas, monospace' : SCRIPT.has(id) ? '"Segoe Print", "Bradley Hand", cursive' : 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', normal: `/fonts/${id}.woff2` };
  if (existsSync(path.join(files, italic))) {
    await copyFile(path.join(files, italic), path.join(out, `${id}-italic.woff2`));
    entry.italic = `/fonts/${id}-italic.woff2`;
  }
  manifest[id] = entry;
}
await writeFile(path.join(root, 'src', 'lib', 'fonts.json'), JSON.stringify(manifest, null, 1));
console.log(`fonts: ${Object.keys(manifest).length} families copied`);
