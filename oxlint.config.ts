import { defineConfig } from 'oxlint';

const IMPORT_ORDER = {
  type: 'line-length',
  order: 'asc',
  ignoreCase: true,
  newlinesBetween: 'always',
  groups: [
    'type',
    ['builtin', 'external'],
    'internal-type',
    'internal',
    ['parent-type', 'sibling-type', 'index-type'],
    ['parent', 'sibling', 'index'],
    'object',
    'unknown'
  ],
  environment: 'node'
};

const HTTP_STATUS_CODES = [200, 201, 202, 204, 400, 401, 403, 404, 409, 413, 422, 500, 502, 503];

export default defineConfig({
  plugins: ['typescript', 'unicorn', 'import', 'oxc'],
  jsPlugins: ['eslint-plugin-perfectionist'],
  categories: {
    correctness: 'error',
    suspicious: 'error'
  },
  env: {
    builtin: true
  },
  ignorePatterns: [
    'poc/**',
    '**/dist/**',
    '**/generated/**',
    'apps/server/drizzle/**',
    '**/worker-configuration.d.ts',
    'apps/demo/seed/**',
    'apps/demo/recording/**'
  ],
  rules: {
    'id-length': ['error', { min: 2, exceptions: ['c'] }],
    'max-params': ['error', { max: 2 }],
    'no-nested-ternary': 'error',
    'no-void': 'error',
    'no-implicit-coercion': ['error', { boolean: true, number: true, string: true }],
    'no-magic-numbers': [
      'error',
      {
        ignore: [-1, 0, 1, ...HTTP_STATUS_CODES],
        ignoreArrayIndexes: true,
        ignoreDefaultValues: true,
        ignoreTypeIndexes: true
      }
    ],
    'import/no-default-export': 'error',
    'import/no-unassigned-import': ['error', { allow: ['**/*.css'] }],
    'unicorn/filename-case': ['error', { case: 'kebabCase' }],
    'unicorn/no-array-reduce': 'error',
    'unicorn/numeric-separators-style': ['error', { number: { minimumDigits: 4, groupLength: 3 } }],
    'typescript/ban-ts-comment': ['error', { minimumDescriptionLength: 10 }],
    'typescript/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
    'typescript/consistent-type-definitions': ['error', 'type'],
    'typescript/no-explicit-any': 'error',
    'typescript/no-floating-promises': 'error',
    'typescript/no-non-null-assertion': 'error',
    'perfectionist/sort-imports': ['error', IMPORT_ORDER]
  },
  overrides: [
    {
      files: ['apps/server/worker/**/*.ts', 'apps/console/src/**/*.{ts,tsx}'],
      rules: {
        'no-console': 'error'
      }
    },
    {
      files: ['apps/server/worker/log.ts'],
      rules: {
        'no-console': 'off'
      }
    },
    {
      files: ['apps/server/worker/**/*.ts', 'apps/cli/src/**/*.ts'],
      rules: {
        'typescript/explicit-function-return-type': 'error'
      }
    },
    {
      files: ['apps/console/src/**/*.{ts,tsx}'],
      plugins: ['react'],
      rules: {
        'react/rules-of-hooks': 'error',
        'react/exhaustive-deps': 'error',
        'react/react-in-jsx-scope': 'off'
      }
    },
    {
      files: ['apps/server/worker/index.ts', '**/*.config.ts', '.lintstagedrc.js'],
      rules: {
        'import/no-default-export': 'off'
      }
    }
  ]
});
