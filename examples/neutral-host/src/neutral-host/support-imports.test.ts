/**
 * Guards the neutral-host folder's portability. A packed consumer copies this folder and runs it, so:
 * support files import only `node:*`, public `@jini-ai/*` entries and files inside `support/`; test
 * files may also import `vitest` and anything inside this folder; nothing names the original product
 * or reaches a package's private files.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const folder = dirname(fileURLToPath(import.meta.url));
const supportDir = join(folder, 'support');
// Built from parts so this guard does not match itself.
const originalProduct = new RegExp(['to', 'vu'].join(''), 'i');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

function specifiers(file: string): string[] {
  const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) found.push(node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) found.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return found;
}

function inside(required: { readonly file: string; readonly specifier: string; readonly root: string }): boolean {
  const target = resolve(dirname(required.file), required.specifier);
  return target === required.root || target.startsWith(`${required.root}${sep}`);
}

/** Why a specifier is not allowed in `file`, or undefined. */
function refusal(required: { readonly file: string; readonly specifier: string }): string | undefined {
  const { file, specifier } = required;
  const isSupport = file.startsWith(`${supportDir}${sep}`);
  if (specifier.startsWith('.')) {
    const root = isSupport ? supportDir : folder;
    return inside({ file, specifier, root }) ? undefined : `relative import leaves ${relative(folder, root) || '.'}`;
  }
  if (specifier.startsWith('node:')) return undefined;
  if (/^@jini-ai\/[a-z0-9-]+(\/[a-z0-9-/]+)?$/.test(specifier) && !/\/(src|dist)(\/|$)/.test(specifier)) return undefined;
  if (!isSupport && ['vitest', 'typescript'].includes(specifier)) return undefined;
  return 'not a public @jini-ai entry or node: built-in';
}

describe('neutral-host folder portability', () => {
  const files = sources(folder);

  it('finds the support folder and its tests', () => {
    expect(files.some(file => file.startsWith(`${supportDir}${sep}`))).toBe(true);
    expect(files.map(file => relative(folder, file))).toContain('neutral-host.test.ts');
  });

  it('imports only node built-ins, public @jini-ai entries and files that stay inside the folder', () => {
    const problems = files.flatMap(file => specifiers(file)
      .map(specifier => ({ specifier, reason: refusal({ file, specifier }) }))
      .filter(({ reason }) => reason !== undefined)
      .map(({ specifier, reason }) => `${relative(folder, file)}: ${specifier} (${reason})`));
    expect(problems).toEqual([]);
  });

  it('never names the original product', () => {
    const named = files.filter(file => file !== fileURLToPath(import.meta.url) && originalProduct.test(readFileSync(file, 'utf8')));
    expect(named.map(file => relative(folder, file))).toEqual([]);
  });

  it('refuses a relative import that leaves the support folder', () => {
    const file = join(supportDir, 'host.ts');
    expect(refusal({ file, specifier: '../neutral-host.test.ts' })).toMatch(/leaves support/);
    expect(refusal({ file, specifier: '../../../agent-plugin-host/index.js' })).toMatch(/leaves support/);
    expect(refusal({ file, specifier: './counters.ts' })).toBeUndefined();
    expect(refusal({ file, specifier: '@jini-ai/agent-plugins/src/lifecycle/layout.js' })).toMatch(/not a public/);
    expect(refusal({ file, specifier: 'vitest' })).toMatch(/not a public/);
  });
});
