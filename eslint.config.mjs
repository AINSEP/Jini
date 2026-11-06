import tseslint from 'typescript-eslint';
import sonarjs from 'eslint-plugin-sonarjs';
import { sonarjsConfig, sonarSourceFiles, sonarTestFiles, sonarParser, sonarTypeScriptConfig, sonarScriptConfig } from './development/quality/sonarjs.config.mjs';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      // Coverage parsers/checkers are authored source; only report output is generated.
      '!packages/devops/src/checks/coverage/**',
      'foundry/**',
      'AI-Dev-Shop/**',
      // Generated plugin payloads carry upstream directives; authored src stays checked.
      'packages/provider-plugins/plugins/**',
    ],
  },
  { plugins: { sonarjs } },
  {
    // Pre-existing inline `eslint-disable` comments in this repo reference rules
    // from plugins this minimal config intentionally does not load. Without
    // this, ESLint errors with "Definition for rule '...' was not found" on
    // every such comment, flooding quality reports with unrelated errors.
    linterOptions: { noInlineConfig: true },
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: { parser: tseslint.parser },
    rules: {
      complexity: ['warn', 15],
      'sonarjs/cognitive-complexity': ['warn', 15],
    },
  },
  {
    ...sonarjsConfig,
    files: sonarSourceFiles,
    ignores: sonarTestFiles,
    plugins: { ...sonarjsConfig.plugins, '@typescript-eslint': tseslint.plugin },
    languageOptions: { parser: sonarParser },
    linterOptions: { noInlineConfig: false, reportUnusedDisableDirectives: 'off' },
  },
  { ...sonarTypeScriptConfig, ignores: sonarTestFiles },
  sonarScriptConfig,
];
