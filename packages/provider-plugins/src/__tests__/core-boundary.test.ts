/**
 * Obs #3 / Langfuse #10 boundary: vendor SDKs live only in this distribution's plugin sources.
 * Scans every other workspace package's source imports and manifest dependency fields. Specifiers are
 * read with the TypeScript parser (Codex wave-2 MED: a regex missed ``import(`langfuse`)`` and
 * `import /* c *\/ ('langfuse')`), so every static `import`/`export … from`, `import x = require()`,
 * `import()`, `require()`/`require.resolve()` and `import('x')` type form counts, and text inside
 * comments or ordinary strings does not. What this does NOT catch: a vendor reached through an
 * unlisted transitive dependency, or a computed specifier (`import(name)`, a template with `${}`);
 * the packed-install test covers what the plugins themselves bundle.
 */
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';

const packagesRoot = fileURLToPath(new URL('../../..', import.meta.url));
const VENDOR = /^(?:@opentelemetry\/|@sentry\/|posthog-(?:node|js)$|langfuse(?:$|-)|stripe$)/;

/** A literal module name: a string or a template without substitutions. */
const literalText = (node: ts.Node | undefined): string | undefined =>
  node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;

const isRequireCallee = (callee: ts.Expression): boolean => (ts.isIdentifier(callee) && callee.text === 'require')
  || (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === 'require' && callee.name.text === 'resolve');

/** The module specifier one node names, if it is an import/export/require form. */
function specifierOf(node: ts.Node): string | undefined {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return literalText(node.moduleSpecifier);
  if (ts.isExternalModuleReference(node)) return literalText(node.expression);
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) return literalText(node.argument.literal);
  if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || isRequireCallee(node.expression))) return literalText(node.arguments[0]);
  return undefined;
}

/** Every literal module specifier in one source text, parsed (never pattern-matched). */
export function moduleSpecifiers({ text, fileName }: { text: string; fileName: string }): string[] {
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    const specifier = specifierOf(node);
    if (specifier !== undefined) found.push(specifier);
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, false, fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS));
  return found;
}

async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await sourceFiles(full));
    else if (/\.(?:[cm]?[jt]sx?)$/.test(entry.name)) out.push(full);
  }
  return out;
}

async function manifestOffenders({ name, root }: { name: string; root: string }): Promise<string[]> {
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8').catch(() => '{}')) as Record<string, Record<string, string> | undefined>;
  return ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
    .flatMap(field => Object.keys(manifest[field] ?? {}).filter(dependency => VENDOR.test(dependency)).map(dependency => `${name}/package.json ${field}: ${dependency}`));
}

async function sourceOffenders({ root }: { root: string }): Promise<string[]> {
  const offenders: string[] = [];
  for (const file of await sourceFiles(path.join(root, 'src')).catch(() => [])) {
    // Every file is parsed: no raw-text pre-filter (Codex fix-lane MED), since an escaped literal
    // (`'lang\u0066use'`) names a vendor without containing its name verbatim.
    const text = await readFile(file, 'utf8');
    for (const specifier of moduleSpecifiers({ text, fileName: file })) if (VENDOR.test(specifier)) offenders.push(`${path.relative(packagesRoot, file)}: ${specifier}`);
  }
  return offenders;
}

it('no core package imports or declares a vendor SDK', async () => {
  const packages = (await readdir(packagesRoot, { withFileTypes: true })).filter(entry => entry.isDirectory() && entry.name !== 'provider-plugins');
  expect(packages.length).toBeGreaterThan(20);
  const offenders: string[] = [];
  for (const { name } of packages) {
    const root = path.join(packagesRoot, name);
    offenders.push(...await manifestOffenders({ name, root }), ...await sourceOffenders({ root }));
  }
  expect(offenders).toEqual([]);
}, 60_000);

it.each(['@opentelemetry/api', '@sentry/node', 'posthog-node', 'posthog-js', 'langfuse', 'stripe'])('the scan recognizes %s', (specifier) => {
  expect(VENDOR.test(specifier)).toBe(true);
});

it.each(['@jini-ai/diagnostics', 'stripe-like', 'posthog', 'node:fs'])('the scan ignores %s', (specifier) => {
  expect(VENDOR.test(specifier)).toBe(false);
});

it.each([
  ['a template-literal dynamic import', 'await import(`langfuse`);'],
  ['a commented dynamic import', "await import /* why */ ('langfuse');"],
  ['a multi-line require', "const s = require(\n  'stripe'\n);"],
  ['require.resolve', "require.resolve('@sentry/node');"],
  ['a re-export', "export * from '@opentelemetry/api';"],
  ['a type-only import', "import type { PostHog } from 'posthog-node';"],
  ['an import type node', "type L = import('langfuse').Langfuse;"],
  ['import-equals require', "import Stripe = require('stripe');"],
  ['a side-effect import', "import 'posthog-js';"],
])('the parser finds the vendor in %s', (_name, text) => {
  expect(moduleSpecifiers({ text, fileName: 'probe.ts' }).filter(specifier => VENDOR.test(specifier))).toHaveLength(1);
});

it.each([
  ['a line comment', "// import 'stripe';"],
  ['a block comment', "/* require('langfuse') */"],
  ['an ordinary string', "const text = \"import('stripe')\";"],
  ['a computed import', "const name = 'stripe'; await import(name); await import(`${name}`);"],
])('the parser ignores %s', (_name, text) => {
  expect(moduleSpecifiers({ text, fileName: 'probe.tsx' }).filter(specifier => VENDOR.test(specifier))).toEqual([]);
});

it('the complete scanner finds a vendor named through escaped literal text (Codex fix-lane MED)', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'jini-boundary-'));
  try {
    await mkdir(path.join(root, 'src'));
    // Neither file contains a vendor word verbatim; the parser decodes both literals to `langfuse`.
    await writeFile(path.join(root, 'src', 'unicode.ts'), "await import('lang\\u0066use');\n");
    await writeFile(path.join(root, 'src', 'hex.ts'), "require('\\x6cangfuse');\n");
    expect((await sourceOffenders({ root })).map(offender => offender.split(': ')[1])).toEqual(['langfuse', 'langfuse']);
  } finally { await rm(root, { recursive: true, force: true }); }
});
