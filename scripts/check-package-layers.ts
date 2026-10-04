/** Dependency table for the approved architecture wave.
 * Production manifests and source must agree on layer direction. Test-only dependencies
 * are exempt; type imports still count because they appear in published declarations.
 * Domain-to-domain edges are never inferred from the current manifests.
 */
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { REPO_ROOT } from './lib/walk-imports.js';
import { packageSourceFiles, parseSource, sourcePackages, type SourcePackage } from './lib/package-sources.js';

export interface LayerViolation { rule: string; file: string; reason: string }
const layers: Readonly<Record<string, number>> = {
  core: 0, protocol: 1, 'ui-kit': 1,
  platform: 2, oauth: 2, db: 2, diagnostics: 2, sandbox: 2, memory: 2,
  artifacts: 2, 'desktop-host': 2, vibecoding: 2,
  'http-kit': 3, sidecar: 3, 'agent-runtime': 3, cli: 3, agentic: 3,
  'capability-providers': 3, registry: 3,
  daemon: 4, 'user-management': 4, cms: 4, 'cms-forms': 4, mcp: 4,
  integrations: 4, 'agent-plugins': 4, devops: 4, chat: 4, plugins: 4, analytics: 4,
  ui: 5, admin: 5,
  server: 6, sqlite: 6, infra: 6,
};
const sameLayerEdges = new Set(['cli→sidecar', 'cms-forms→cms', 'admin→ui']);

function isPublicEntry(
  required: { spec: string; pkg: SourcePackage | undefined },
  _optional: Record<string, never> = {},
): boolean {
  const exports = required.pkg?.manifest.exports;
  if (!exports) return false;
  const subpath = required.spec.slice('@jini-ai/admin'.length);
  // An export wildcard must not turn traversal or package internals into a public API.
  if (subpath.split('/').some(segment => ['.', '..', 'node_modules'].includes(segment))) return false;
  const key = subpath ? `.${subpath}` : '.';
  if (Object.hasOwn(exports, key)) return exports[key] != null;
  const pattern = Object.keys(exports).filter(entry => entry.includes('*'))
    .sort((a, b) => b.indexOf('*') - a.indexOf('*') || b.length - a.length)
    .find(entry => {
      const [prefix, suffix] = entry.split('*');
      return key.startsWith(prefix!) && key.endsWith(suffix!) && key.length >= entry.length;
    });
  return pattern !== undefined && exports[pattern] != null;
}

export function checkPackageLayers(
  required: { repoRoot: string } = { repoRoot: REPO_ROOT },
  _optional: Record<string, never> = {},
): LayerViolation[] {
  const root = required.repoRoot;
  const violations: LayerViolation[] = [];
  const packages = sourcePackages({ packagesDir: join(root, 'packages') });
  const byName = new Map(packages.map(pkg => [pkg.manifest.name, pkg]));
  function check(pkg: SourcePackage, spec: string, file: string, sourcePath?: string, declaredPeer = false): void {
    if (!spec.startsWith('@jini-ai/')) return;
    const owner = pkg.manifest.name.slice('@jini-ai/'.length);
    const target = spec.slice('@jini-ai/'.length).split('/')[0]!;
    const ownerLayer = layers[owner];
    const targetLayer = layers[target];
    const reason = `${owner} → ${spec}`;
    if (ownerLayer === undefined || targetLayer === undefined) {
      violations.push({ rule: 'L0-unlisted-package', file, reason: `${reason}: package missing from the approved layer table` }); return;
    }
    if ((owner === 'mcp' && target === 'oauth') || (owner === 'oauth' && target === 'mcp')) {
      violations.push({ rule: 'L1-layer-edge', file, reason: `${reason}: MCP and OAuth must never depend on one another` }); return;
    }
    // Public self-imports select an isolated entry of the same package, not a dependency edge.
    if (owner === target && sourcePath !== undefined) return;
    // Optional metadata must not exempt a required dependency in the manifest.
    const optionalPeer = declaredPeer || (sourcePath !== undefined
      && pkg.manifest.peerDependencies?.[`@jini-ai/${target}`] !== undefined
      && pkg.manifest.peerDependenciesMeta?.[`@jini-ai/${target}`]?.optional === true);
    // React integrations compose UI peers in their React subtree. Chat's declared UI
    // dependency covers its components/hooks/helpers, never its framework-free code.
    const reactIntegration = ((owner === 'user-management' && ['ui', 'admin', 'agentic'].includes(target)
      && optionalPeer) || (owner === 'chat' && target === 'ui'))
      && (sourcePath === undefined || /^src\/react\//.test(sourcePath));
    // User management owns an optional admin integration; only its admin subtree may
    // compose published admin entries, keeping server/core and private imports isolated.
    const adminIntegration = owner === 'user-management' && target === 'admin' && optionalPeer
      && sourcePath !== undefined && /^src\/admin\//.test(sourcePath)
      && isPublicEntry({ spec, pkg: byName.get('@jini-ai/admin') });
    if (targetLayer >= ownerLayer && !sameLayerEdges.has(`${owner}→${target}`) && !reactIntegration && !adminIntegration) {
      violations.push({ rule: 'L1-layer-edge', file, reason: `${reason}: L${ownerLayer} cannot depend on L${targetLayer}` });
    }
    if (sourcePath !== undefined && ['ui', 'chat'].includes(owner) && target === 'platform'
      && spec !== '@jini-ai/platform/fetch-with-timeout') {
      violations.push({ rule: 'L2-browser-platform', file, reason: `${reason}: only the isomorphic fetch-with-timeout entry is allowed` });
    }
    if (sourcePath !== undefined && !pkg.manifest.dependencies?.[`@jini-ai/${target}`]
      && !pkg.manifest.peerDependencies?.[`@jini-ai/${target}`]) {
      violations.push({ rule: 'L3-undeclared-edge', file, reason: `${reason}: production import must be a dependency or peerDependency` });
    }
    if (sourcePath !== undefined && !byName.has(`@jini-ai/${target}`)) {
      violations.push({ rule: 'L0-unlisted-package', file, reason: `${reason}: workspace package not found` });
    }
  }
  for (const pkg of packages) {
    const manifestFile = relative(root, join(pkg.directory, 'package.json')).split('\\').join('/');
    if (layers[pkg.manifest.name.slice('@jini-ai/'.length)] === undefined) {
      violations.push({ rule: 'L0-unlisted-package', file: manifestFile, reason: 'package missing from the approved layer table' });
    }
    for (const name of Object.keys(pkg.manifest.dependencies ?? {})) check(pkg, name, manifestFile);
    for (const name of Object.keys(pkg.manifest.peerDependencies ?? {})) check(pkg, name, manifestFile,
      undefined, pkg.manifest.peerDependenciesMeta?.[name]?.optional === true);
    for (const filename of packageSourceFiles({ directory: pkg.directory })) {
      if (filename.endsWith('.css')) continue;
      const ast = parseSource({ file: filename, source: readFileSync(filename, 'utf8') });
      const file = relative(root, filename).split('\\').join('/');
      const sourcePath = relative(pkg.directory, filename).split('\\').join('/');
      function visit(node: ts.Node): void {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier
          && ts.isStringLiteral(node.moduleSpecifier)) check(pkg, node.moduleSpecifier.text, file, sourcePath);
        // Dynamic and require imports are included so the rule cannot be bypassed by syntax.
        if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
          || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
          && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) check(pkg, node.arguments[0].text, file, sourcePath);
        ts.forEachChild(node, visit);
      }
      visit(ast);
    }
  }
  return violations;
}
