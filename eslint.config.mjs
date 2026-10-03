import tseslint from 'typescript-eslint';
import sonarjs from 'eslint-plugin-sonarjs';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      'foundry/**',
      'AI-Dev-Shop/**',
    ],
  },
  {
    // Pre-existing inline `eslint-disable` comments in this repo reference rules
    // from plugins this minimal config intentionally does not load. Without
    // this, ESLint errors with "Definition for rule '...' was not found" on
    // every such comment, flooding a complexity-only run with unrelated errors.
    linterOptions: { noInlineConfig: true },
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: { parser: tseslint.parser },
    plugins: { sonarjs },
    rules: {
      complexity: ['warn', 15],
      'sonarjs/cognitive-complexity': ['warn', 15],
    },
  },
  {
    files: ['packages/*/src/**/*.{ts,tsx,mts,cts}', 'packages/cms/forms/src/**/*.{ts,tsx,mts,cts}'],
    languageOptions: { parser: tseslint.parser },
    ignores: ['**/__tests__/**', '**/*.test.*'],
    rules: {
      'no-restricted-syntax': ['error',
        ...[
          ['tovu', 'Consumer product identities belong to the host.'],
          ['apps\\u002f(website|admin|desktop)|#src\\u002f|@tovu', 'Consumer source paths are forbidden.'],
          ['Settings →|this site|EXTERNAL_MCP|g3-approval', 'Use host-neutral messages and injected wire constants.'],
          ['U-0[0-9][0-9]|REQ-|SEC-|INV-|SPEC-', 'Specification IDs belong in rationale comments, never runtime strings.'],
        ].flatMap(([pattern, message]) => [
          { selector: `Literal[value=/${pattern}/i]`, message },
          { selector: `TemplateElement[value.cooked=/${pattern}/i]`, message },
          { selector: `JSXText[value=/${pattern}/i]`, message },
        ]),
      ],
    },
  },
];
