/**
 * j05 retirement contract: deleting the old workspace must leave no consumer reaching it.
 * This is a read-only source/manifest check; it never loads host code or opens a database.
 * Keep the final absence assertion unconditional. Until the shim release and the competing
 * outbox handoff are resolved, it is deliberately RED by design, not a skipped acceptance gate.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const jiniRoot = fileURLToPath(new URL('../../../', import.meta.url));
const tovuRoot = resolve(jiniRoot, '../Tovu');
const infraName = '@jini-ai/infra';
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']);

// Derive the inventory from disk, rather than a hand-kept consumer list. Never follow symlinks
// or descend into live sites, installed dependencies, generated output or git internals.
function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (['sites', 'node_modules', 'dist', '.git'].includes(entry.name)) return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(path);
    return entry.isFile() ? [path] : [];
  });
}

function importsOf(source: string, path = 'fixture.ts'): string[] {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];
  function visit(node: ts.Node): void {
    let specifier: ts.Node | undefined;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      specifier = node.moduleSpecifier;
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
      || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      specifier = node.arguments[0];
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      specifier = node.moduleReference.expression;
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      specifier = node.argument.literal;
    }
    if (specifier && ts.isStringLiteralLike(specifier)) specifiers.push(specifier.text);
    ts.forEachChild(node, visit);
  }
  visit(file);
  return specifiers;
}

const jiniConsumers = readdirSync(join(jiniRoot, 'packages'), { withFileTypes: true })
  .filter(entry => entry.isDirectory() && entry.name !== 'infra')
  .flatMap(entry => filesUnder(join(jiniRoot, 'packages', entry.name)));
const tovuConsumers = ['apps', 'development'].flatMap(dir => filesUnder(join(tovuRoot, dir)));

test('the import observation sees static, type-only, re-export, dynamic and CommonJS reaches', () => {
  // Positive controls prevent a negative scan passing because its parser cannot see imports.
  assert.deepEqual(importsOf([
    "import {\n value\n} from '@jini-ai/infra/db/core';",
    "import type { Port } from '@jini-ai/infra/db/core';",
    "export * from '@jini-ai/infra/db/sqlite';",
    "const adapter = import('@jini-ai/infra/db/sqlite');",
    "const old = require('@jini-ai/infra');",
    "import oldApi = require('@jini-ai/infra/db/core');",
    "type Alias = import('@jini-ai/infra/db/core').Port;",
  ].join('\n')), [
    `${infraName}/db/core`, `${infraName}/db/core`, `${infraName}/db/sqlite`,
    `${infraName}/db/sqlite`, infraName, `${infraName}/db/core`, `${infraName}/db/core`,
  ]);
  assert.deepEqual(importsOf([
    "// import old from '@jini-ai/infra';",
    "/* export * from '@jini-ai/infra/db/core'; */",
    'const history = "import old from \'@jini-ai/infra\';";',
    "import { value } from '@jini-ai/db/core';",
  ].join('\n')), ['@jini-ai/db/core']);
});

for (const [repo, files] of [['Jini', jiniConsumers], ['Tovu', tovuConsumers]] as const) {
  test(`${repo} consumers have no imports or re-exports of the retired package`, () => {
    const sourceFiles = files.filter(path => sourceExtensions.has(extname(path)));
    assert.ok(sourceFiles.length > 0, `${repo} source inventory must not be empty`);
    const reaches = sourceFiles.flatMap(path => importsOf(readFileSync(path, 'utf8'), path)
      .filter(specifier => specifier === infraName || specifier.startsWith(`${infraName}/`))
      .map(specifier => ({ path, specifier })));
    assert.deepEqual(reaches, [], 'Retirement requires every consumer import to move first');
  });

  test(`${repo} consumer manifests have no dependency on the retired package`, () => {
    const manifests = files.filter(path => path.endsWith('/package.json'));
    if (repo === 'Tovu') manifests.push(join(tovuRoot, 'package.json'));
    assert.ok(manifests.length > 0, `${repo} manifest inventory must not be empty`);
    const dependencies = manifests.flatMap(path => {
      const manifest = JSON.parse(readFileSync(path, 'utf8')) as Record<string, Record<string, unknown>>;
      return ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
        .filter(section => Object.hasOwn(manifest[section] ?? {}, infraName))
        .map(section => ({ path, section }));
    });
    assert.deepEqual(dependencies, [], 'Retirement requires every consumer dependency to move first');
  });
}

test('j05 final state removes the infra workspace, including stale generated leftovers', () => {
  assert.equal(existsSync(join(jiniRoot, 'packages/infra')), false,
    'Retirement is incomplete: retain infra until its release gate and outbox ownership are resolved');
});
