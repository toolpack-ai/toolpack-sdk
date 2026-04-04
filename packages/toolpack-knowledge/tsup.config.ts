import { defineConfig } from 'tsup';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pkg = require('./package.json');

export default defineConfig({
  entry: ['src/index.ts'],
  dts: true,
  format: ['esm', 'cjs'],
  splitting: false,
  sourcemap: false,
  clean: true,
  outDir: 'dist',
  outExtension({ format }) {
    return { js: format === 'esm' ? '.js' : '.cjs' };
  },
  external: Object.keys(pkg.dependencies || {}),
  shims: true,
  esbuildOptions(options) {
    options.platform = 'node';
  },
  minify: true,
});
