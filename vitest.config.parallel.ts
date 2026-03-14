import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/integration/parallel-tools.test.ts'],
    exclude: [],
    environment: 'node',
  },
});
