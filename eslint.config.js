import tseslint from 'typescript-eslint';

const sharedRules = {
  'no-constant-condition': 'warn',
  'no-empty': ['warn', { allowEmptyCatch: true }],
  'prefer-const': 'warn',
  'no-var': 'error',
  'eqeqeq': ['warn', 'smart'],
};

const globals = {
  console: 'readonly',
  process: 'readonly',
  Buffer: 'readonly',
  URL: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  fetch: 'readonly',
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  Response: 'readonly',
  RequestInit: 'readonly',
};

export default [
  // Global ignores: a config object with ONLY `ignores` excludes these paths
  // from every following config. (An `ignores` key sitting next to `rules`
  // only scopes that one object — dist/ was being linted that way.)
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'site/**',
      'coverage/**',
      'dev_notes/**',
      'test/**',
      '.code-review-graph/**',
    ],
  },

  // Plain JS (bin loader, scripts)
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals,
    },
    rules: {
      ...sharedRules,
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },

  // TypeScript sources (lib/, bin/rev.ts)
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parser: tseslint.parser,
      globals,
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      ...sharedRules,
      // Base rule misreads TS constructs (enums, declared params); use the
      // TS-aware variant.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },
];
