import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // nodemailer is an optional peer dep — not installed in the monorepo dev env.
    // Without this, Vite attempts to bundle it during tests and logs a resolution
    // error to stderr even though the dynamic import() is wrapped in a .catch().
    external: ['nodemailer'],
  },
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    fileParallelism: false,
  },
});
