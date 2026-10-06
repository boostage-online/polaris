import base from '@polaris/config/eslint/base.mjs';

export default [
  ...base,
  {
    files: ['test/**/*.ts'],
    rules: {
      // Les corps de réponse supertest sont `any` par construction : les tests les inspectent librement.
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
    },
  },
];
