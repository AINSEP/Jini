// Shared SonarJS policy: consumers (including Tovu) may import sonarjsConfig.rules.
// Reviewed against the installed 4.2.0 rule catalog and docs, including deprecated
// security hotspots omitted by recommended. Upgrades require reviewing this policy.
import sonarjs from 'eslint-plugin-sonarjs';
import tseslint from 'typescript-eslint';

export const skippedSonarRules = {
  'no-redundant-optional': 'exactOptionalPropertyTypes deliberately distinguishes omission from an explicit undefined.',
  'no-unused-function-argument': 'Preserve the required (input, options = {}) boundary and callback contracts.',
  'function-name': 'PascalCase React components and public API names are intentional.',
  'variable-name': 'Public protocol/property names may follow external conventions.',
  'comment-regex': 'No project-specific comment ban is defined.',
  'file-header': 'License provenance is maintained by NOTICE and source maps, not mandatory file headers.',
  'arrow-function-convention': 'Formatting belongs to the existing formatter.',
  'shorthand-property-grouping': 'Property ordering is cosmetic and can obscure logical grouping.',
  'no-tab': 'Whitespace belongs to the formatter.',
  'max-lines': 'Raw file size alone does not establish a maintainability defect.',
  'max-lines-per-function': 'Use the existing complexity budgets rather than raw line counts.',
  'cyclomatic-complexity': 'Duplicates the existing core complexity rule and its strict override.',
  'no-wildcard-import': 'Public barrel re-exports and namespace imports are established conventions.',
  'no-undefined-assignment': 'Explicit undefined is part of TypeScript optional-value contracts.',
  'max-union-size': 'Discriminated unions legitimately exceed the default three-member limit.',
  'file-name-differ-from-class': 'Kebab-case modules and framework filenames are intentional.',
  'no-return-type-any': 'Boundary adapters may intentionally expose dynamic values.',
  'no-implicit-dependencies': 'Workspace exports and TS aliases are owned by manifests and dependency-cruiser.',
};

const asWarning = value => ['warn', ...(Array.isArray(value) ? value.slice(1) : [])];

export const sonarjsConfig = {
  plugins: { sonarjs },
  settings: sonarjs.configs.recommended.settings,
  rules: {
    // The flat recommended export includes explicit off entries; enable those
    // below too, then apply the documented convention exclusions.
    ...Object.fromEntries(Object.entries(sonarjs.configs.recommended.rules)
      .map(([name, value]) => [name, value === 'off' ? 'off' : asWarning(value)])),
    ...Object.fromEntries(Object.entries(sonarjs.rules)
      .filter(([, rule]) => !rule.meta.docs.recommended)
      .map(([name]) => [`sonarjs/${name}`, 'warn'])),
    ...Object.fromEntries(Object.keys(skippedSonarRules).map(name => [`sonarjs/${name}`, 'off'])),
    'sonarjs/cognitive-complexity': ['warn', 15],
    'sonarjs/no-duplicate-string': ['warn', { threshold: 5 }],
    'sonarjs/no-nested-functions': ['warn', { threshold: 4 }],
    'sonarjs/max-switch-cases': ['warn', 30],
  },
};

export const sonarSourceFiles = [
  'packages/*/src/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}',
  'packages/cms/forms/src/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}',
];
export const sonarTestFiles = [
  '**/__tests__/**', '**/tests/**', '**/test/**', '**/*.test.*', '**/*.spec.*',
  // Compile-only rejection proofs deliberately contain invalid calls and unthrown errors.
  '**/*.typecheck.ts',
];

// These two legacy React directives belong to plugins this report does not load.
// Filter only their comment metadata; source, locations and Sonar directives stay intact.
export const sonarParser = {
  ...tseslint.parser,
  parseForESLint(source, options) {
    const parsed = tseslint.parser.parseForESLint(source, options);
    parsed.ast.comments = parsed.ast.comments.filter(comment =>
      !/^\s*eslint-disable-next-line\s+react(?:-hooks\/exhaustive-deps|\/no-danger)(?:\s*--[^]*)?\s*$/.test(comment.value));
    return parsed;
  },
};

export const sonarTypeScriptConfig = {
  files: sonarSourceFiles.map(pattern => pattern.replace('js,jsx,mjs,cjs,', '')),
  rules: { 'sonarjs/no-reference-error': 'off' }, // tsc owns TypeScript names and globals.
};

// These Node scripts also run callbacks in Playwright's page context. Declare only
// their runtime globals; keep reference checking enabled on JavaScript.
export const sonarScriptConfig = {
  files: ['packages/agent-runtime/src/skills/web-clone/scripts/**/*.mjs'],
  languageOptions: {
    globals: Object.fromEntries([
      'process', 'console', 'URL', 'fetch', 'Buffer', 'performance',
      'document', 'window', 'location', 'getComputedStyle', 'CSS', 'Node', 'CSSFontFaceRule', 'Image',
    ].map(name => [name, 'readonly'])),
  },
};

export default sonarjsConfig;
