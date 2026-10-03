import path from 'node:path';
import { builtinModules } from 'node:module';
import type { PackagingFilesystemPort, ImportReaderPort, ImportAliasPort } from './ports.js';
export interface DistImportInput {
  distDir: string; entry: string; declared: ReadonlySet<string>; fs: PackagingFilesystemPort; imports: ImportReaderPort; aliases: ImportAliasPort;
}
const builtins = new Set(builtinModules);
/** Walk reachable files once. The injected AST parser owns import syntax and comment handling. */
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
