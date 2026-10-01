const config = {
  '*.{json,jsonc,yml,yaml}': ['oxfmt --no-error-on-unmatched-pattern'],
  '*.{js,ts,tsx}': [
    'oxlint --type-aware --fix --no-error-on-unmatched-pattern',
    'oxfmt --no-error-on-unmatched-pattern'
  ],
  '*.{ts,tsx}': [() => 'npm run typecheck']
};

export default config;
