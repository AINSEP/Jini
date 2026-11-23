/** `XP4-runtime`: production runtime syntax under Core's `src/contracts/**` (owner rule XP4: contracts hold
 * types only; runtime code lives at its owning implementation path). Moved here from the legacy
 * `check-no-cross-package.ts` XP4 scan so it is blocking through the injection ratchet: existing runtime
 * syntax is frozen by occurrence, and any new runtime statement — in an existing contract file or a new
 * one — fails. Keyed by path, syntax kind and the declared name (or the referenced module), never by line.
 * The legacy CLI keeps its empty-emit assertion for the built JavaScript.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import type { Finding } from './injection-debt.js';
import { parseSource, type SourcePackage } from './package-sources.js';

const RULE = 'XP4-runtime';
const NON_PRODUCTION = /(?:^|\/)(?:__tests__|tests|fixtures)\/|\.(?:test|spec)\.[cm]?tsx?$/;

/** A contract statement that emits nothing: an interface, a type alias, or a type-only import/export. */
export function validContractStatement(node: ts.Statement, _optional: Record<string, never> = {}): boolean {
  if (ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword)) return false;
  if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) return true;
  if (ts.isImportDeclaration(node)) return node.importClause?.isTypeOnly === true;
  return ts.isExportDeclaration(node) && node.isTypeOnly;
}

/** The stable name part of a key: the declared name, or the module a statement references. */
function nameOf(node: ts.Statement, ast: ts.SourceFile): string {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) return node.moduleSpecifier.text;
  if (ts.isVariableStatement(node)) return node.declarationList.declarations.map(item => item.name.getText(ast)).join(',');
  const named = node as ts.Statement & { name?: ts.Node };
  return named.name ? named.name.getText(ast) : '-';
}

/** A type-only import that leaves Core's `src` is also a contract finding (contracts depend on Core only). */
function leavesCore(required: { node: ts.Statement; filename: string; coreSrc: string }): string | undefined {
  const { node } = required;
  if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) return undefined;
  const specifier = node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : undefined;
  if (!specifier) return undefined;
  const inside = specifier.startsWith('.') && resolve(dirname(required.filename), specifier).startsWith(required.coreSrc + sep);
  return inside ? undefined : specifier;
}

function fileFindings(required: { root: string; filename: string; coreSrc: string }): Finding[] {
  const ast = parseSource({ file: required.filename, source: readFileSync(required.filename, 'utf8') });
  const file = relative(required.root, required.filename).split(sep).join('/');
  return ast.statements.flatMap(node => {
    const kind = ts.SyntaxKind[node.kind];
    if (!validContractStatement(node)) return [{ rule: RULE, file, spec: `${kind}:${nameOf(node, ast)}`, kind, reason: `${kind} ${nameOf(node, ast)} is runtime syntax in a types-only contract file; move it to its owning implementation module` }];
    const outside = leavesCore({ node, filename: required.filename, coreSrc: required.coreSrc });
    return outside ? [{ rule: RULE, file, spec: `import:${outside}`, kind: 'outside-core-reference', reason: `contract references ${outside}, outside @jini-ai/core src` }] : [];
  });
}

/**
 * Every XP4 runtime-syntax occurrence in Core's production contract sources.
 * @complexity O(contract files × statements).
 */
export function contractRuntimeFindings(required: { root: string; packages: readonly SourcePackage[] }, _optional: Record<string, never> = {}): Finding[] {
  const core = required.packages.find(pkg => pkg.manifest.name === '@jini-ai/core');
  if (!core) return [];
  const coreSrc = join(core.directory, 'src');
  return ts.sys.readDirectory(join(coreSrc, 'contracts'), ['.ts', '.tsx', '.mts'], undefined, ['**/*'])
    .filter(filename => !filename.endsWith('.d.ts') && !NON_PRODUCTION.test(relative(coreSrc, filename).split(sep).join('/')))
    .sort()
    .flatMap(filename => fileFindings({ root: required.root, filename, coreSrc }));
}
