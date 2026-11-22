/** L6: the base packages stay pure. `core` holds types, constants, pure functions and factories
 * whose state lives only in the object they return; `protocol` holds wire schemas and guards.
 * Forbidden: Node built-ins, runtime dependencies (core none, protocol only zod), reads of
 * process/window/document/navigator/globalThis, module-scope `let` or a Map/Set written later, and
 * direct timer or fetch calls (those arrive as injected ports with a default). A parameter, destructured
 * name, local or import of the same name is that injected port, not the global. */
import { builtinModules } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { createHardwiringInspector } from '../../packages/devops/src/checks/hardwiring.js';
import { importSites } from './import-sites.js';
import { packageSourceFiles, parseSource, type SourcePackage } from './package-sources.js';
import type { Finding } from './injection-debt.js';

const RULE = 'L6-base-purity';
const ALLOWED_DEPENDENCIES: Readonly<Record<string, readonly string[]>> = { core: [], protocol: ['zod'] };
const GLOBALS = new Set(['process', 'window', 'document', 'navigator', 'globalThis']);
const EFFECT_CALLS = new Set(['setTimeout', 'setInterval', 'setImmediate', 'fetch']);
const MUTATORS = new Set(['set', 'add', 'delete', 'clear']);
const NODE_BUILTINS = new Set(builtinModules);
// The hardwiring check owns lexical-binding resolution: an injected `fetch` port is not the global.
const inspector = createHardwiringInspector({ compiler: ts });
const isGlobal = (node: ts.Identifier): boolean => !inspector.hasLocalBinding({ node, name: node.text });

const isNodeBuiltin = (spec: string): boolean => spec.startsWith('node:') || NODE_BUILTINS.has(spec.split('/')[0]!);
const isBaseSpec = (spec: string): boolean => /^@jini-ai\/(?:core|protocol)(?:\/|$)/.test(spec);

interface Where { file: string; reason: string }
const finding = (where: Where, spec: string, kind: string): Finding => ({ rule: RULE, file: where.file, spec, kind, reason: `${where.reason}: ${spec}` });

function importFindings(required: { where: Where; source: string; allowed: readonly string[] }): Finding[] {
  const found: Finding[] = [];
  for (const site of importSites({ file: required.where.file, source: required.source })) {
    const bare = site.spec.startsWith('@') ? site.spec.split('/').slice(0, 2).join('/') : site.spec.split('/')[0]!;
    if (isNodeBuiltin(site.spec)) found.push(finding(required.where, site.spec, 'node-builtin'));
    else if (!site.spec.startsWith('.') && !isBaseSpec(site.spec) && !required.allowed.includes(bare)) {
      found.push(finding(required.where, site.spec, 'external-import'));
    }
  }
  return found;
}

/** A name that is declared, or is a member name, is not a read of the global. */
function isNameOnly(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isQualifiedName(parent)) return parent.right === node;
  return ts.isTypeQueryNode(parent) || (parent as { name?: ts.Node }).name === node;
}

function writtenCollections(ast: ts.SourceFile): Set<string> {
  const written = new Set<string>();
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression) && MUTATORS.has(node.expression.name.text)) {
      written.add(node.expression.expression.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return written;
}

function globalFindings(required: { where: Where; ast: ts.SourceFile }): Finding[] {
  const found: Finding[] = [];
  function visit(node: ts.Node): void {
    if (ts.isIdentifier(node) && GLOBALS.has(node.text) && !isNameOnly(node) && isGlobal(node)) found.push(finding(required.where, node.text, 'global'));
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && EFFECT_CALLS.has(node.expression.text) && isGlobal(node.expression)) {
      found.push(finding(required.where, node.expression.text, 'effect-call'));
    }
    ts.forEachChild(node, visit);
  }
  visit(required.ast);
  return found;
}

const isNewCollection = (init: ts.Expression | undefined): boolean => Boolean(init && ts.isNewExpression(init)
  && ts.isIdentifier(init.expression) && ['Map', 'Set'].includes(init.expression.text));

function stateFindings(required: { where: Where; ast: ts.SourceFile }): Finding[] {
  const written = writtenCollections(required.ast);
  const found: Finding[] = [];
  for (const statement of required.ast.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const isLet = (statement.declarationList.flags & ts.NodeFlags.Let) !== 0;
    for (const declaration of statement.declarationList.declarations) {
      const name = declaration.name.getText(required.ast);
      if (isLet) found.push(finding(required.where, `let ${name}`, 'module-state'));
      else if (isNewCollection(declaration.initializer) && written.has(name)) found.push(finding(required.where, `mutable ${name}`, 'module-state'));
    }
  }
  return found;
}

function manifestFindings(required: { pkg: SourcePackage; root: string; name: string }): Finding[] {
  const file = relative(required.root, join(required.pkg.directory, 'package.json')).split('\\').join('/');
  const allowed = ALLOWED_DEPENDENCIES[required.name] ?? [];
  const dependencies = Object.keys(required.pkg.manifest.dependencies ?? {}).filter(name => !allowed.includes(name));
  return dependencies.map(name => finding({ file, reason: `${required.name} may only depend on ${allowed.join(', ') || 'nothing'}` }, name, 'manifest-dependency'));
}

function sourceFindings(required: { pkg: SourcePackage; root: string; name: string }): Finding[] {
  const allowed = ALLOWED_DEPENDENCIES[required.name] ?? [];
  return packageSourceFiles({ directory: required.pkg.directory }).filter(file => !file.endsWith('.css')).flatMap(filename => {
    const source = readFileSync(filename, 'utf8');
    const file = relative(required.root, filename).split('\\').join('/');
    const where = { file, reason: `${required.name} must stay pure` };
    const ast = parseSource({ file: filename, source });
    return [...importFindings({ where, source, allowed }), ...globalFindings({ where, ast }), ...stateFindings({ where, ast })];
  });
}

export function basePurityFindings(required: { root: string; packages: readonly SourcePackage[] }, _optional: Record<string, never> = {}): Finding[] {
  return required.packages.flatMap(pkg => {
    const name = pkg.manifest.name.slice('@jini-ai/'.length);
    if (!Object.hasOwn(ALLOWED_DEPENDENCIES, name)) return [];
    return [...manifestFindings({ pkg, root: required.root, name }), ...sourceFindings({ pkg, root: required.root, name })];
  });
}
