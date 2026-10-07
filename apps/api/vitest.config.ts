import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * SWC remplace esbuild pour que `emitDecoratorMetadata` soit honoré : l'injection de dépendances
 * NestJS repose sur les métadonnées de décorateurs, qu'esbuild n'émet pas.
 */
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' }, jsc: { target: 'es2022' } })],
  test: {
    globals: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    projects: [
      {
        plugins: [swc.vite({ module: { type: 'es6' }, jsc: { target: 'es2022' } })],
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          environment: 'node',
          testTimeout: 30_000,
        },
      },
      {
        plugins: [swc.vite({ module: { type: 'es6' }, jsc: { target: 'es2022' } })],
        test: {
          name: 'integration',
          include: ['test/**/*.test.ts'],
          environment: 'node',
          globalSetup: ['./test/global-setup.ts'],
          fileParallelism: false,
          // Les options de délai de la racine ne sont pas héritées par les projets.
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
