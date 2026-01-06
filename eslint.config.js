export default [
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-constant-condition': 'warn',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'prefer-const': 'warn',
      'no-var': 'error',
      'eqeqeq': ['warn', 'smart'],
    },
    ignores: ['node_modules/**', 'test/**'],
  },
];
