/** The runtime value exports each public entry of a package actually ships, for the Gate C1
 * approved-runtime list (`metadata.approvedRuntime` in `scripts/injection-debt.json`).
 *
 * An entry is a manifest `exports` key as written (`./contracts/server` → `@jini-ai/core/contracts/server`,
 * fix GC.2). Its source is the condition target mapped from `dist/` back to `src/`. Value exports are
 * followed through local re-exports (`export * from`, `export { a as b } from`, `import { a }; export { a }`)
 * so a name counts at the entry that re-exports it. Type-only syntax is erased and never counts: that is
 * how a type cannot be presented as runtime. Syntactic, not checker-based, because the same enumeration has
 * to run over the trusted base tree read through git, which has no program or node_modules.
 */
import { posix } from 'node:path';
import ts from 'typescript';
import { parseSource } from './package-sources.js';

/** Reads a repo-relative POSIX path; undefined when it does not exist (live fs or a git tree). */
export type ReadFile = (path: string) => string | undefined;
type Conditions = string | null | Conditions[] | { [condition: string]: Conditions };
interface Manifest { name: string; exports?: unknown }

const CONDITION_ORDER = ['import', 'default', 'require', 'node', 'types'];

/** The first file target of an export entry, by condition preference. */
function targetOf(entry: Conditions): string | undefined {
  if (typeof entry === 'string') return entry;
  if (entry === null) return undefined;
  if (Array.isArray(entry)) return entry.map(targetOf).find(Boolean);
  const keys = [...CONDITION_ORDER.filter(key => key in entry), ...Object.keys(entry).filter(key => !CONDITION_ORDER.includes(key))];
  return keys.map(key => targetOf(entry[key]!)).find(Boolean);
}

/** `<public spec>` -> source path (repo-relative) for every concrete `exports` key. Patterns and
 * `./package.json` name no module. A manifest with no `exports` exposes only its root. */
/** The `exports` field as a key -> conditions map; a bare target or no field exposes only the root. */
function exportMap(manifest: Manifest): Record<string, Conditions> {
  const field = manifest.exports as Conditions | undefined;
  const isMap = typeof field === 'object' && field !== null && !Array.isArray(field) && Object.keys(field).some(key => key.startsWith('.'));
  return isMap ? field as Record<string, Conditions> : { '.': field ?? null };
}

/** `<public spec>` -> source path (repo-relative) for every concrete `exports` key. Patterns and
 * `./package.json` name no module. A manifest with no `exports` exposes only its root. */
export function publicEntries(required: { manifest: Manifest; directory: string }, _optional: Record<string, never> = {}): Map<string, string | undefined> {
  const { manifest, directory } = required;
  const entries = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(exportMap(manifest))) {
    if (key.includes('*') || key === './package.json') continue;
    const target = targetOf(value);
    const spec = key === '.' ? manifest.name : `${manifest.name}/${key.slice(2)}`;
    entries.set(spec, target ? posix.join(directory, target.replace(/^\.\/dist\//, './src/')) : undefined);
  }
  return entries;
}

const SOURCE_SUFFIXES = ['', '.ts', '.tsx', '.mts', '/index.ts', '/index.tsx'];

/** A `dist`-style `.js`/`.d.ts` target or a relative specifier, mapped to the source file that exists. */
function sourceFile(required: { path: string; read: ReadFile }): { path: string; text: string } | undefined {
  const stem = required.path.replace(/\.d\.(ts|mts|cts)$/, '').replace(/\.(m|c)?jsx?$/, '').replace(/\.(m|c)?tsx?$/, '');
  for (const suffix of SOURCE_SUFFIXES) {
    const path = suffix === '' ? required.path : `${stem}${suffix}`;
    const text = /\.(m|c)?tsx?$/.test(path) && !path.endsWith('.d.ts') ? required.read(path) : undefined;
    if (text !== undefined) return { path, text };
  }
  return undefined;
}

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind): boolean =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some(modifier => modifier.kind === kind) ?? false);

/** Names a declaration statement binds as runtime values (declare, const enum and types bind none). */
function declaredValues(node: ts.Statement): string[] {
  if (hasModifier(node, ts.SyntaxKind.DeclareKeyword)) return [];
  if (ts.isVariableStatement(node)) return node.declarationList.declarations.flatMap(item => ts.isIdentifier(item.name) ? [item.name.text] : []);
  if (ts.isEnumDeclaration(node)) return hasModifier(node, ts.SyntaxKind.ConstKeyword) ? [] : [node.name.text];
  if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) return [node.name.text];
  return [];
}

interface Walk { read: ReadFile; memo: Map<string, Set<string>> }
interface ModuleScan { path: string; ast: ts.SourceFile }

/** Runtime exports of the module a relative specifier names; empty for an external or missing module. */
function exportsOfSpecifier(required: { from: string; specifier: string; walk: Walk }): Set<string> {
  if (!required.specifier.startsWith('.')) return new Set();
  return moduleExports({ path: posix.join(posix.dirname(required.from), required.specifier), walk: required.walk });
}

/** Value names an `import { … } from './x'` binds locally, when they resolve to a runtime export there. */
function importedValues(required: { node: ts.Statement; scan: ModuleScan; walk: Walk }): string[] {
  const { node } = required;
  const clause = ts.isImportDeclaration(node) ? node.importClause : undefined;
  if (!clause || clause.isTypeOnly || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) return [];
  const specifier = (node as ts.ImportDeclaration).moduleSpecifier as ts.StringLiteral;
  const target = exportsOfSpecifier({ from: required.scan.path, specifier: specifier.text, walk: required.walk });
  return clause.namedBindings.elements.filter(element => !element.isTypeOnly && target.has((element.propertyName ?? element.name).text))
    .map(element => element.name.text);
}

/** Local value bindings: declarations plus value imports that resolve to a runtime export. */
function localValues(required: { scan: ModuleScan; walk: Walk }): Set<string> {
  const values = new Set<string>();
  for (const node of required.scan.ast.statements) {
    [...declaredValues(node), ...importedValues({ node, ...required })].forEach(name => values.add(name));
  }
  return values;
}

/** `export { a as b }` / `export { a as b } from` / `export *` / `export * as ns` contributions. */
function reExported(required: { node: ts.ExportDeclaration; scan: ModuleScan; walk: Walk; locals: () => Set<string> }): string[] {
  const { node, scan, walk } = required;
  if (node.isTypeOnly) return [];
  const specifier = node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : undefined;
  if (node.exportClause && ts.isNamespaceExport(node.exportClause)) return [node.exportClause.name.text];
  const source = specifier ? exportsOfSpecifier({ from: scan.path, specifier, walk }) : required.locals();
  if (!node.exportClause) return [...source].filter(name => name !== 'default');
  return node.exportClause.elements.filter(element => !element.isTypeOnly && source.has((element.propertyName ?? element.name).text))
    .map(element => element.name.text);
}

function exportsOfScan(required: { scan: ModuleScan; walk: Walk }): Set<string> {
  const names = new Set<string>();
  let locals: Set<string> | undefined;
  const lazyLocals = (): Set<string> => (locals ??= localValues(required));
  for (const node of required.scan.ast.statements) {
    if (ts.isExportAssignment(node)) names.add('default');
    else if (ts.isExportDeclaration(node)) reExported({ node, ...required, locals: lazyLocals }).forEach(name => names.add(name));
    else if (hasModifier(node, ts.SyntaxKind.ExportKeyword)) {
      const declared = declaredValues(node);
      if (hasModifier(node, ts.SyntaxKind.DefaultKeyword) && declared.length > 0) names.add('default');
      else declared.forEach(name => names.add(name));
    }
  }
  return names;
}

/** Runtime exports of one module path; cycle-safe (a module in progress contributes nothing twice). */
function moduleExports(required: { path: string; walk: Walk }): Set<string> {
  const found = sourceFile({ path: required.path, read: required.walk.read });
  if (!found) return new Set();
  const cached = required.walk.memo.get(found.path);
  if (cached) return cached;
  const names = new Set<string>();
  required.walk.memo.set(found.path, names);
  const scan = { path: found.path, ast: parseSource({ file: found.path, source: found.text }) };
  exportsOfScan({ scan, walk: required.walk }).forEach(name => names.add(name));
  return names;
}

/**
 * Every `<public spec>#<runtime export>` pair a package ships, sorted.
 * @param required.manifest The package manifest (its `name` and `exports`).
 * @param required.directory The package directory, repo-relative POSIX.
 * @param required.read Reader for repo-relative paths (live tree or a git base tree).
 * @complexity O(modules reachable from the public entries), each parsed once per call.
 */
export function runtimeExportPairs(required: { manifest: Manifest; directory: string; read: ReadFile }, _optional: Record<string, never> = {}): string[] {
  const walk: Walk = { read: required.read, memo: new Map() };
  const pairs: string[] = [];
  for (const [spec, path] of publicEntries(required)) {
    if (!path) continue;
    for (const name of moduleExports({ path, walk })) pairs.push(`${spec}#${name}`);
  }
  return [...new Set(pairs)].sort();
}
