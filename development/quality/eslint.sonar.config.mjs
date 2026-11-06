// Isolated entry point: quality:sonar never loads root boundary/complexity rules.
import tseslint from 'typescript-eslint';
import { sonarjsConfig, sonarSourceFiles, sonarTestFiles, sonarParser, sonarTypeScriptConfig, sonarScriptConfig } from './sonarjs.config.mjs';

export default [
  { ignores: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/coverage/**', ...sonarTestFiles] },
  // Copied upstream directives must not activate absent rules or suppress this report's policy.
  { linterOptions: { noInlineConfig: true } },
  {
    ...sonarjsConfig,
    files: sonarSourceFiles,
    plugins: { ...sonarjsConfig.plugins, '@typescript-eslint': tseslint.plugin },
    languageOptions: { parser: sonarParser },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
  },
  sonarTypeScriptConfig,
  sonarScriptConfig,
];
