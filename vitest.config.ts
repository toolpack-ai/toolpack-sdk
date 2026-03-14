import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
        exclude: ['node_modules', 'dist', 'chrome-devtools-mcp', 'samples', 'tests/integration/multimodal.test.ts', 'tests/integration/tools.test.ts', 'tests/integration/parallel-tools.test.ts'],
    },
});
