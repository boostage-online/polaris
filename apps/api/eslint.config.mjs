import base from '@polaris/config/eslint/base.mjs';
export default [
  ...base,
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    rules: {
      // Les décorateurs NestJS sur des classes vides sont normaux
      '@typescript-eslint/no-extraneous-class': 'off',
    },
  },
];
