import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'integration',
          include: ['test/**/*.test.ts'],
          environment: 'node',
          globalSetup: ['./test/global-setup.ts'],
          fileParallelism: false,
        },
      },
    ],
  },
});
