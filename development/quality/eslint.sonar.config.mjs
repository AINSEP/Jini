// Isolated entry point: quality:sonar never loads root boundary/complexity rules.
import tseslint from 'typescript-eslint';
import { sonarjsConfig, sonarSourceFiles, sonarTestFiles } from './sonarjs.config.mjs';

export default [
  { ignores: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/coverage/**', ...sonarTestFiles] },
  {
    ...sonarjsConfig,
    files: sonarSourceFiles,
    languageOptions: { parser: tseslint.parser },
    linterOptions: { noInlineConfig: true },
  },
];
