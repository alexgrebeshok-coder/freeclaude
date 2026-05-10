// Flat config for the FreeClaude desktop app.
// Linting scope:
//  - src/main/**     (Node + Electron main, CommonJS-friendly TS)
//  - src/preload/**  (Electron preload, sandboxed)
//  - src/renderer/** (React 19 + Vite renderer)
//  - src/shared/**   (isomorphic — no Node, no DOM dependencies)
//  - test/** + e2e/** (vitest + playwright fixtures)
//
// We intentionally enable a small, opinionated, zero-flake set: TS recommended,
// React hooks, jsx-a11y. We do NOT enable react/recommended for non-component
// files because main/preload don't have JSX.

import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default [
  {
    ignores: [
      'node_modules/**',
      '.vite/**',
      'out/**',
      'dist/**',
      'legacy/**',
      'scripts/**/*.cjs',
      'forge.config.js',
      '*.cjs'
    ]
  },
  ...tseslint.configs.recommended,
  {
    files: ['src/renderer/**/*.{ts,tsx}', 'test/renderer/**/*.{ts,tsx}'],
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y
    },
    languageOptions: {
      globals: { window: 'readonly', document: 'readonly' },
      parserOptions: {
        ecmaFeatures: { jsx: true }
      }
    },
    rules: {
      'react/jsx-uses-react': 'error',
      'react/jsx-uses-vars': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'jsx-a11y/alt-text': 'warn',
      'jsx-a11y/aria-role': 'warn',
      'jsx-a11y/no-noninteractive-element-interactions': 'warn',
      // Prefer the new JSX transform — no React imports required.
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off'
    },
    settings: {
      react: { version: 'detect' }
    }
  },
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly' }
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'off'
    }
  }
];
