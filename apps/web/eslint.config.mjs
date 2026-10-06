import nextPlugin from '@next/eslint-plugin-next';
import base from '@polaris/config/eslint/base.mjs';

export default [
  ...base,
  nextPlugin.flatConfig.coreWebVitals,
  { ignores: ['.next/**', 'next.config.ts', 'postcss.config.mjs'] },
];
