import { defineConfig } from 'astro/config';

// Static site: one portfolio index plus one folder per redesign concept.
export default defineConfig({
  output: 'static',
  trailingSlash: 'ignore',
  build: { format: 'directory' },
  devToolbar: { enabled: false },
});
