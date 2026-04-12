import { defineConfig } from 'tsup';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pkg = require('./package.json');

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'channels/index': 'src/channels/index.ts',
    'testing/index': 'src/testing/index.ts',
  },
  dts: true,
  format: ['esm', 'cjs'],
  splitting: false,
  sourcemap: false,
  clean: true,
  outDir: 'dist',
  outExtension({ format }) {
    return { js: format === 'esm' ? '.js' : '.cjs' };
  },
  external: Object.keys(pkg.peerDependencies || {}),
  shims: true,
  esbuildOptions(options) {
    options.platform = 'node';
  },
  minify: true,
});
