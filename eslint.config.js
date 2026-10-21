import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['build/', 'dist/', 'node_modules/', 'tools/probe/'] },
  js.configs.recommended,
  {
    rules: {
      'no-unused-vars': ['error', { caughtErrors: 'none' }],
    },
  },
  {
    files: ['src/app/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.browser, PalmServiceBridge: 'readonly' },
    },
  },
  {
    // webOS JS service: CommonJS on the TV's Node.js runtime
    files: ['src/service/**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
  },
  {
    files: ['scripts/**', 'test/**', 'tools/*.mjs', '*.js'],
    languageOptions: { globals: globals.node },
  },
];
