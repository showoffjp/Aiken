import { defineConfig } from 'astro/config';

// Static site: one portfolio index plus one folder per redesign concept.
export default defineConfig({
  output: 'static',
  trailingSlash: 'ignore',
  // Each page's CSS is small (about 7 KB), so inline it rather than make the
  // browser wait for a separate stylesheet before the first paint.
  build: { format: 'directory', inlineStylesheets: 'always' },
  devToolbar: { enabled: false },
});
