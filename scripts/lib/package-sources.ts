/** Source inventory shared by the neutrality and package-layer guards.
 * Nested packages own their own source tree; scanning the parent must not scan it twice.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

export interface PackageManifest {
  name: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  exports?: Record<string, unknown>;
}
export interface SourcePackage { directory: string; manifest: PackageManifest }

export function sourcePackages(required: { packagesDir: string }, _optional: Record<string, never> = {}): SourcePackage[] {
  const packages: SourcePackage[] = [];
  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || ['node_modules', 'dist', '.git'].includes(entry.name)) continue;
      const child = join(directory, entry.name);
      const manifest = join(child, 'package.json');
      if (existsSync(manifest)) {
        const data: PackageManifest = JSON.parse(readFileSync(manifest, 'utf8'));
        if (data.name?.startsWith('@jini-ai/')) packages.push({ directory: child, manifest: data });
      }
      // Package roots and their immediate children can contain nested packages (cms/forms).
      // Runtime asset projects inside src are content, not workspace packages.
      if (!['src', 'docs', 'ui-ux-design'].includes(entry.name)) visit(child);
    }
  }
  visit(required.packagesDir);
  return packages;
}

export function packageSourceFiles(required: { directory: string }, _optional: Record<string, never> = {}): string[] {
  const files: string[] = [];
  function visit(directory: string): void {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (['__tests__', 'node_modules', 'dist', '.git'].includes(entry.name)) continue;
      const child = join(directory, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (/\.(?:ts|tsx|mts|cts|css)$/.test(entry.name) && !/\.test\./.test(entry.name)) files.push(child);
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
