// Shared SonarJS policy: consumers (including Tovu) may import sonarjsConfig.rules.
// Reviewed against the installed 4.2.0 rule catalog and docs, including deprecated
// security hotspots omitted by recommended. Upgrades require reviewing this policy.
import sonarjs from 'eslint-plugin-sonarjs';

export const skippedSonarRules = {
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
export const sonarTestFiles = ['**/__tests__/**', '**/tests/**', '**/test/**', '**/*.test.*', '**/*.spec.*'];

export default sonarjsConfig;
