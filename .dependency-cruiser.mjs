// Report-only graph checks complement scripts/guard.ts; that guard remains the authority
// for product neutrality, protocol purity, package layers and approved export specifiers.
// Tovu precedent: canonical no-circular includes type edges; filtering type-only edges after
// cycle derivation cannot prove that a cycle contains runtime edges only.
import { globSync } from 'node:fs';
import { binSources, publicEntries, repoRoot, workspacePackages } from './development/quality/workspace-resolution.mjs';

const escaped = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tests = '(?:^|/)(?:__tests__|tests?|testing|fixtures)(?:/|$)|\\.(?:test|spec|fixture)\\.[cm]?[jt]sx?$';
const sourceTree = '^packages/(?:[^/]+/src|cms/forms/src)/';
const publicPaths = [...publicEntries.map(entry => entry.source), ...binSources].map(source => '^' + escaped(source) + '$');
// These are copied into consumer projects, not executed in Jini. The Remotion
// template has its own package.json; shadcn examples require a consumer's @/ UI.
// Keep their edges in the graph, but resolve their host dependencies in that host.
const consumerSources = [
  '^packages/agent-runtime/src/skills/chat-motion-overlay/assets/remotion-template/',
  '^packages/agent-plugins/ui-ux-design/skills/shadcn-ui/examples/',
];
const kernelCore = '^packages/db/src/kernel/kernel-core\\.ts$';
const implicitEntries = [
  // Included by ui/tsconfig.json: ambient matcher augmentation, no importer needed.
  'packages/ui/src/vitest-env.d.ts',
  'packages/ui/src/vitest-jest-dom.d.ts',
  // node-worker-native.test.ts passes these URLs to the native worker/bootstrap.
  'packages/sandbox/src/__tests__/fixtures/register-worker.cjs',
  'packages/sandbox/src/__tests__/fixtures/exit-worker.cjs',
  // Loaded by commerce/vitest.config.ts's setupFiles.
  'packages/commerce/src/react/__tests__/setup.ts',
].map(source => '^' + escaped(source) + '$');

// Guard's residual-JS TODO has no approved allowlist. Surface every source JS file for review
// (including isolated files, which an edge-only rule misses), without inventing exemptions.
for (const file of globSync(['packages/*/src/**/*.{js,jsx,mjs,cjs}', 'packages/cms/forms/src/**/*.{js,jsx,mjs,cjs}'], { cwd: repoRoot })) {
  if (!/(?:^|\/)(?:node_modules|dist|generated|coverage)\//.test(file))
    console.warn(`[residual-js-review] ${file} — classify before defining the guard allowlist`);
}

export default {
  forbidden: [
    { name: 'no-circular', severity: 'warn', from: {}, to: { circular: true } },
    { name: 'no-production-to-tests', severity: 'warn',
      from: { path: sourceTree, pathNot: tests }, to: { path: tests } },
    { name: 'no-orphans', severity: 'warn',
      from: { orphan: true, path: sourceTree, pathNot: [...publicPaths, ...implicitEntries] }, to: {} },
    { name: 'no-unresolved', severity: 'warn',
      from: { pathNot: [...consumerSources, kernelCore] }, to: { couldNotResolve: true } },
    // This file's locally declared require(capability) is not CommonJS loading.
    // Still report every other unresolved specifier in the same file.
    { name: 'no-unresolved-kernel', severity: 'warn', from: { path: kernelCore },
      to: { couldNotResolve: true, pathNot: '^(?:interactiveTransactions|backup)$' } },
    // A malformed bare deep import remains visible even when package exports refuse resolution.
    { name: 'no-unresolved-package-internals', severity: 'warn', from: {},
      to: { path: '^@jini-ai/[^/]+/(?:src|dist)/', couldNotResolve: true } },
    ...workspacePackages.flatMap(({ directory }) => {
      // Nested packages own their own tree (cms/forms is not part of cms).
      const nested = workspacePackages.filter(pkg => pkg.directory.startsWith(directory + '/'))
        .map(pkg => '^' + escaped(pkg.directory) + '/');
      const children = workspacePackages.filter(pkg => pkg.directory.startsWith(directory + '/'))
        .map(pkg => escaped(pkg.directory.slice(directory.length + 1)) + '/');
      const own = '^' + escaped(directory) + '/' + (children.length ? '(?!(?:' + children.join('|') + '))' : '');
      const publicSources = publicEntries.filter(entry => entry.directory === directory && !entry.source.includes('*'))
        .map(entry => '^' + escaped(entry.source) + '$');
      return [
        { name: `no-cross-package-relative:${directory}`, severity: 'warn',
          from: { path: own, pathNot: nested },
          to: { path: '^packages/', pathNot: own, dependencyTypes: ['local'], dependencyTypesNot: ['aliased'] } },
        { name: `no-private-source-import:${directory}`, severity: 'warn',
          from: { pathNot: own }, to: { path: own + 'src/', pathNot: publicSources } },
      ];
    }),
    // Guard TODO: automation may consume only agent-runtime as its pinned subprocess leaf.
    // Include type-only edges: engine domain vocabulary must not leak into automation.
    { name: 'automation-engine-vocabulary-firewall', severity: 'warn',
      from: { path: '^foundry/automation/' },
      to: { path: '^packages/', pathNot: '^packages/agent-runtime/' } },
  ],
  options: {
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    webpackConfig: { fileName: 'development/quality/workspace-resolution.mjs' },
    doNotFollow: { path: '(^|/)node_modules/' },
    exclude: { path: '(^|/)(?:node_modules|dist|coverage|generated|\\.generated)/' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      // Excalidraw's public type subpaths expose only the `types` condition.
      conditionNames: ['import', 'node', 'default', 'types'],
    },
  },
};
