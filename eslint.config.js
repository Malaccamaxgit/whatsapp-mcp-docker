import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: null,
      },
      globals: {
        ...globals.node,
        NodeJS: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': 'off',
      'no-unused-vars': 'off',
      'no-console': 'off',
      'curly': ['error', 'all'],
      'eqeqeq': ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-multiple-empty-lines': ['error', { max: 1, maxEOF: 0 }],
      'no-trailing-spaces': 'error',
      'eol-last': 'error',
      'semi': ['error', 'always'],
      'quotes': ['error', 'single', { avoidEscape: true }],
      'indent': ['error', 2, { SwitchCase: 1 }],
      'comma-dangle': ['error', 'never'],
      'space-before-function-paren': ['error', 'always'],
      'space-in-parens': ['error', 'never'],
      'array-bracket-spacing': 'error',
      'object-curly-spacing': ['error', 'always'],
      'key-spacing': 'error',
      'no-multi-spaces': 'error',
      'space-infix-ops': 'error',
      'space-unary-ops': 'error',
      'func-call-spacing': 'error',
      'keyword-spacing': 'error',
      'space-before-blocks': 'error',
      'no-floating-decimal': 'error',
      'no-implicit-coercion': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-return-await': 'error',
      'require-await': 'off',
      // Allow @typescript-eslint/no-explicit-any for server.registerTool handlers (per CLAUDE.md)
      '@typescript-eslint/no-explicit-any': 'off',
      // Allow control character regex for file sanitization (intentionally blocking \\x00-\\x1F)
      'no-control-regex': 'off',
    },
  },
  // Source files - stricter unused var rules
  {
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_|^jid$|^phone$',
        varsIgnorePattern: '^_|^err$|^expectedResponse$|^maliciousFilename$|^plaintext$|^e$|^createMockWaClient$|^WhatsAppClient$|^TextContent$|^MessageWithContext$'
      }],
    },
  },
  // Test files - disable unused-vars (intentionally unused catch variables are common in tests)
  {
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  {
    ignores: ['node_modules/', 'dist/', 'build/', 'coverage/'],
  },
];
