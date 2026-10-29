import path from 'node:path';
import { builtinModules } from 'node:module';
import type { PackagingFilesystemPort, ImportReaderPort, ImportAliasPort } from './ports.js';
// ImportAliasPort supplies each host's resolution policy without hard-coding
// a consumer namespace into the shared walk.
export interface DistImportInput {
  /** The built tree's root (`dist/`), passed to ImportAliasPort for host alias resolution. */
  distDir: string;
  /** Absolute path of the file the walk starts from (the CLI entry). */
  entry: string;
  /** Package names allowed as bare imports besides builtins: root `dependencies` plus workspaces. */
  declared: ReadonlySet<string>;
  fs: PackagingFilesystemPort; imports: ImportReaderPort; aliases: ImportAliasPort;
}
const builtins = new Set(builtinModules);
/** The file a specifier points at (host alias first, then relative/absolute paths), or undefined for a bare package. */
function localTarget(required: { specifier: string; file: string; distDir: string; aliases: ImportAliasPort }): string | undefined {
  const { specifier, file, distDir, aliases } = required;
  return aliases.resolve({ specifier, fromFile: file, distDir })
    ?? (specifier.startsWith('.') || path.isAbsolute(specifier) ? path.resolve(path.dirname(file), specifier) : undefined);
}
/** The package a bare specifier names, unless it is a builtin or declared. */
function undeclaredPackage(required: { specifier: string; declared: ReadonlySet<string> }): string | undefined {
  const { specifier, declared } = required;
  const name = specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/');
  return specifier.startsWith('node:') || builtins.has(name) || declared.has(name) ? undefined : name;
}
/**
 * Every bare import reachable from `entry` that is neither a builtin nor in `declared`, as
 * `"<package> (<file relative to distDir>)"`, in walk order. A relative import whose target file
 * does not exist is reported too, so a broken walk can never read as a clean one.
 * Walk reachable files once. The injected AST parser owns import syntax and comment handling.
 *
 * @complexity O(files + imports) reachable from `entry`; each file is read once.
 */
export function undeclaredDistImports(required: DistImportInput): string[] {
  const { distDir, entry, declared, fs, imports, aliases } = required;
  const queue = [path.resolve(entry)];
  const seen = new Set(queue);
  const problems: string[] = [];
  /** Queue an unseen local target once; a missing one is reported once, against its first importer. */
  const visit = (target: string, specifier: string, relative: string): void => {
    const absolute = path.resolve(target);
    if (seen.has(absolute)) return;
    seen.add(absolute);
    if (fs.exists({ path: absolute })) queue.push(absolute);
    else problems.push(`${specifier} (${relative}: file not found)`);
  };
  /** Check one reachable file's imports: follow local targets, report undeclared packages. */
  const scan = (file: string, relative: string): void => {
    const source = Buffer.from(fs.read({ path: file })).toString('utf8');
    for (const specifier of imports.imports({ file, source })) {
      const target = localTarget({ specifier, file, distDir, aliases });
      if (target !== undefined) {
        visit(target, specifier, relative);
        continue;
      }
      const name = undeclaredPackage({ specifier, declared });
      if (name !== undefined) problems.push(`${name} (${relative})`);
    }
  };
  for (let index = 0; index < queue.length; index++) {
    const file = queue[index]!;
    const relative = path.relative(distDir, file);
    if (fs.exists({ path: file })) scan(file, relative);
    else problems.push(`${relative} (entry file not found)`);
  }
  return problems;
}
export function assertDistImportsDeclared(required: DistImportInput): void {
  const problems = undeclaredDistImports(required);
  if (problems.length) throw new Error(`built entry imports ${problems.length} undeclared packages or missing files:\n  ${problems.join('\n  ')}`);
}
