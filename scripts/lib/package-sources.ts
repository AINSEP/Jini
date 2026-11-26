/** Source inventory shared by the neutrality and package-layer guards.
 * Nested packages own their own source tree; scanning the parent must not scan it twice.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

export interface PackageManifest {
  name: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  exports?: Record<string, unknown>;
}
export interface SourcePackage { directory: string; manifest: PackageManifest }

export function duplicateManifestExportKeys({ file, source }: { file: string; source: string }, _optional: Record<string, never> = {}): string[] {
  const root = ts.parseJsonText(file, source).statements[0];
  if (!root || !ts.isExpressionStatement(root) || !ts.isObjectLiteralExpression(root.expression)) return [];
  const maps = root.expression.properties.filter(ts.isPropertyAssignment).flatMap(property => {
    if (!ts.isStringLiteral(property.name) || !ts.isObjectLiteralExpression(property.initializer)) return [];
    if (property.name.text === 'exports') return [{ name: 'exports', value: property.initializer }];
    if (property.name.text !== 'jini') return [];
    return property.initializer.properties.filter(ts.isPropertyAssignment).flatMap(entry => {
      if (!ts.isStringLiteral(entry.name) || entry.name.text !== 'entries' || !ts.isObjectLiteralExpression(entry.initializer)) return [];
      return [{ name: 'jini.entries', value: entry.initializer }];
    });
  });
  const diagnostics: string[] = [];
  for (const map of maps) {
    const seen = new Set<string>();
    for (const property of map.value.properties.filter(ts.isPropertyAssignment)) {
      if (!ts.isStringLiteral(property.name)) continue;
      const key = property.name.text;
      if (seen.has(key)) diagnostics.push(`${file}: duplicate ${map.name} key ${JSON.stringify(key)}`);
      seen.add(key);
    }
  }
  return diagnostics;
}

function readSourcePackage(required: { manifest: string; directory: string }): SourcePackage | undefined {
  if (!existsSync(required.manifest)) return undefined;
  const manifest: PackageManifest = JSON.parse(readFileSync(required.manifest, 'utf8'));
  return manifest.name?.startsWith('@jini-ai/') ? { directory: required.directory, manifest } : undefined;
}

export function sourcePackages(required: { packagesDir: string }, _optional: Record<string, never> = {}): SourcePackage[] {
  const packages: SourcePackage[] = [];
  // Every child of the agent-plugins package is its src or plugin content (a plugin folder may ship
  // its own package.json fixtures); none is a workspace package.
  const agentPluginContent = join(required.packagesDir, 'agent-plugins');
  function visit(directory: string): void {
    if (directory === agentPluginContent) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || ['node_modules', 'dist', '.git'].includes(entry.name)) continue;
      const child = join(directory, entry.name);
      const manifest = join(child, 'package.json');
      const pkg = readSourcePackage({ manifest, directory: child });
      if (pkg) packages.push(pkg);
      // Package roots and their immediate children can contain nested packages (<family>/<domain>).
      // Runtime asset projects inside src are content, not workspace packages.
      if (!['src', 'docs'].includes(entry.name)) visit(child);
    }
  }
  visit(required.packagesDir);
  return packages;
}

export function packageSourceFiles(required: { directory: string }, { includeJavaScript = false }: { includeJavaScript?: boolean } = {}): string[] {
  const files: string[] = [];
  function visit(directory: string): void {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (['__tests__', 'node_modules', 'dist', '.git'].includes(entry.name)) continue;
      const child = join(directory, entry.name);
      if (entry.isDirectory()) visit(child);
      else if ((/\.(?:ts|tsx|mts|cts|css)$/.test(entry.name) || (includeJavaScript && /\.[cm]?jsx?$/.test(entry.name))) && !/\.test\./.test(entry.name)) files.push(child);
    }
  }
  visit(join(required.directory, 'src'));
  return files.sort();
}

/** The parser distinguishes regexes, comments, JSX and nested template expressions.
 * A hand-written comment stripper would mistake URLs and regexes for comments.
 */
export function parseSource(required: { file: string; source: string }, _optional: Record<string, never> = {}): ts.SourceFile {
  return ts.createSourceFile(required.file, required.source, ts.ScriptTarget.Latest, true,
    required.file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function walkFiles(required: { directory: string; skip: readonly string[]; accept: (name: string) => boolean }): string[] {
  const files: string[] = [];
  function visit(directory: string): void {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (required.skip.includes(entry.name)) continue;
      const child = join(directory, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (required.accept(entry.name)) files.push(child);
    }
  }
  visit(required.directory);
  return files.sort();
}

/** Plugin payloads: the `.mjs`/`.js`/`.d.ts` content that ships beside the agent-plugins `src`
 * (each top-level plugin folder). It is published code, so the base rule covers it like source. */
export function payloadSourceFiles(required: { directory: string }, _optional: Record<string, never> = {}): string[] {
  return walkFiles({
    directory: required.directory,
    skip: ['__tests__', 'node_modules', 'dist', '.git', 'src'],
    accept: name => /\.(?:[cm]?jsx?|d\.[cm]?ts)$/.test(name) && !/\.test\./.test(name),
  });
}

/** Test files under `src`: advisory only (unit tests may fake across packages until the tests are moved). */
export function packageTestFiles(required: { directory: string }, _optional: Record<string, never> = {}): string[] {
  return walkFiles({
    directory: join(required.directory, 'src'),
    skip: ['node_modules', 'dist', '.git'],
    accept: name => /\.(?:ts|tsx|mts|cts)$/.test(name),
  }).filter(file => /(?:^|\/)__tests__\//.test(file) || /\.test\./.test(file));
}
