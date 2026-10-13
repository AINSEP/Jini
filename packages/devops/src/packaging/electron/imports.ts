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
/** Walk reachable files once. The injected AST parser owns import syntax and comment handling. */
/**
 * Every bare import reachable from `entry` that is neither a builtin nor in `declared`, as
 * `"<package> (<file relative to distDir>)"`, in walk order. A relative import whose target file
 * does not exist is reported too, so a broken walk can never read as a clean one.
 *
 * @complexity O(files + imports) reachable from `entry`; each file is read once.
 */
export function undeclaredDistImports(required: DistImportInput): string[] {
  const { distDir, entry, declared, fs, imports, aliases } = required;
  const queue = [path.resolve(entry)];
  const seen = new Set(queue);
  const problems: string[] = [];
  for (let index = 0; index < queue.length; index++) {
    const file = queue[index]!;
    if (!fs.exists({ path: file })) { problems.push(`${path.relative(distDir, file)} (entry file not found)`); continue; }
    const source = Buffer.from(fs.read({ path: file })).toString('utf8');
    for (const specifier of imports.imports({ file, source })) {
      const alias = aliases.resolve({ specifier, fromFile: file, distDir });
      const target = alias ?? (specifier.startsWith('.') || path.isAbsolute(specifier) ? path.resolve(path.dirname(file), specifier) : undefined);
      const relative = path.relative(distDir, file);
      if (target !== undefined) {
        const absolute = path.resolve(target);
        if (seen.has(absolute)) continue;
        seen.add(absolute);
        if (fs.exists({ path: absolute })) queue.push(absolute);
        else problems.push(`${specifier} (${relative}: file not found)`);
        continue;
      }
      const name = specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/');
      if (!specifier.startsWith('node:') && !builtins.has(name) && !declared.has(name)) problems.push(`${name} (${relative})`);
    }
  }
  return problems;
}
export function assertDistImportsDeclared(required: DistImportInput): void {
  const problems = undeclaredDistImports(required);
  if (problems.length) throw new Error(`built entry imports ${problems.length} undeclared packages or missing files:\n  ${problems.join('\n  ')}`);
}
