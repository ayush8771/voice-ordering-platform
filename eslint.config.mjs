import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Minimal flat ESLint config for the workspace.
 * Type-aware rules are intentionally not enabled yet; `npm run typecheck`
 * already runs the compiler in strict mode.
 */
export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': 'off',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['frontend/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { window: 'readonly', document: 'readonly', fetch: 'readonly' },
    },
  },
);
