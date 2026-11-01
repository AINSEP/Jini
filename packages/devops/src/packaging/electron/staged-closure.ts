import path from 'node:path';
import { isBuiltin } from 'node:module';
import { optionalPeerClassification, type OptionalPeerManifest } from './optional-peers.js';
import type { PackagingFilesystemPort, ImportReaderPort, RuntimeResolverPort } from './ports.js';
export interface StagedClosureInput {
  root: string;
  /** Host runtime entry files or directories. All installed Jini dist files are also audited. */
  scan: readonly string[];
  /** Package roots sharing this resource tree, e.g. an extracted app.asar directory. */
  packageRoots?: readonly string[];
  fs: PackagingFilesystemPort;
  imports: ImportReaderPort;
  resolver: RuntimeResolverPort;
  /** Native host modules supplied by the executable, e.g. Electron. Never package exceptions. */
  hostModules?: ReadonlySet<string>;
}
export interface StagedClosureAudit { problems: string[]; optIns: string[]; checked: number }
const codeFile = (file: string) => /\.[cm]?[jt]sx?$/.test(file) && !/\.d\.[cm]?ts$/.test(file) && !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file);
const inside = (root: string, target: string) => target === root || target.startsWith(root + path.sep);
const packageName = (specifier: string) => specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/');

/** Scan trees once, never following a symlink outside the stage. O(files), O(files) output. */
function codeFiles(required: { directory: string; root: string; fs: PackagingFilesystemPort }): string[] {
  const { directory, root, fs } = required;
  if (!fs.exists({ path: directory })) return [];
  if (!inside(root, fs.realpath({ path: directory }))) throw new Error(`staged scan escapes root: ${directory}`);
  if (fs.stat({ path: directory }).kind === 'file') return codeFile(directory) ? [fs.realpath({ path: directory })] : [];
  return fs.entries({ path: directory }).flatMap(name => codeFiles({ directory: path.join(directory, name), root, fs }));
}
/** Enumerate nested production package trees, including nested versions and self-contained bundles. */
function jiniFiles(required: { directory: string; root: string; fs: PackagingFilesystemPort }): string[] {
  const { directory, root, fs } = required;
  const modules = path.join(directory, 'node_modules');
  if (!fs.exists({ path: modules })) return [];
  const packages = fs.entries({ path: modules }).filter(name => !name.startsWith('.')).flatMap(name => {
    const entry = path.join(modules, name);
    return name.startsWith('@') ? fs.entries({ path: entry }).map(child => path.join(entry, child)) : [entry];
  });
  return packages.flatMap(directory => {
    if (!inside(root, fs.realpath({ path: directory }))) throw new Error(`staged package escapes root: ${directory}`);
    const own = path.basename(path.dirname(directory)) === '@jini-ai'
      ? codeFiles({ directory: path.join(directory, 'dist'), root, fs }) : [];
    return [...own, ...jiniFiles({ directory, root, fs })];
  });
}
function manifestOwner(required: { file: string; root: string; fs: PackagingFilesystemPort }): OptionalPeerManifest | undefined {
  const { file, root, fs } = required;
  let directory = path.dirname(file);
  while (inside(root, directory)) {
    const manifest = path.join(directory, 'package.json');
    if (fs.exists({ path: manifest })) return JSON.parse(Buffer.from(fs.read({ path: manifest })).toString('utf8'));
    if (directory === root) break;
    directory = path.dirname(directory);
  }
  return undefined;
}
function exemption(required: { file: string; specifier: string; root: string; fs: PackagingFilesystemPort }): string | undefined {
  const { specifier } = required;
  if (specifier.startsWith('.') || specifier.startsWith('#') || path.isAbsolute(specifier)) return undefined;
  const manifest = manifestOwner(required);
  if (!manifest?.name?.startsWith('@jini-ai/')) return undefined;
  return optionalPeerClassification({ manifest, name: packageName(specifier) });
}
/** Check one edge using Node's actual import/require conditions; ancestor resolution is rejected. */
function resolveEdge(required: { file: string; specifier: string; kind: 'import' | 'require'; input: StagedClosureInput }): string {
  const { input, file, specifier, kind } = required;
  const target = input.resolver.resolve({ fromFile: file, specifier, kind });
  const root = input.fs.realpath({ path: input.root });
  if (!inside(root, target)) throw new Error('resolved outside the staged tree');
  if (!input.fs.exists({ path: target })) throw new Error('resolved target does not exist');
  if (!inside(root, input.fs.realpath({ path: target }))) throw new Error('resolved symlink escapes the staged tree');
  if (input.fs.stat({ path: target }).kind !== 'file') throw new Error('resolved target is not a file');
  return target;
}
/**
 * Audit literal runtime references from the staged tree only. All Jini dist files are roots,
 * so deferred loads cannot disappear behind an unexercised feature or a try/catch.
 * Missing peers are exempt only by their owning package's valid opt-in manifest contract.
 * @throws on an invalid scan root, escaping package link, or a parser without runtime references.
 * @complexity O(files + edges × Node resolution cost); each reached file is parsed once.
 */
export function auditStagedClosure(input: StagedClosureInput, _options: Record<string, never> = {}): StagedClosureAudit {
  if (!input.imports.references) throw new Error('staged closure requires an AST runtime-reference reader');
  const root = input.fs.realpath({ path: input.root });
  const queue = [...new Set([...input.scan.flatMap(directory => codeFiles({ directory, root, fs: input.fs })),
    ...(input.packageRoots ?? [root]).flatMap(directory => jiniFiles({ directory, root, fs: input.fs }))])];
  const seen = new Set<string>();
  const problems: string[] = [];
  const optIns: string[] = [];
  const stagedInput = { ...input, root };
  function failure(file: string, specifier: string, location: string, error: unknown): void {
    const optIn = exemption({ file, specifier, root, fs: input.fs });
    if (optIn) optIns.push(`${location} (${optIn})`);
    else problems.push(`${location}: ${error instanceof Error ? error.message : String(error)}`);
  }
  function checkReference(file: string, ref: { specifier: string; kind: 'import' | 'require'; line: number }): void {
    if (isBuiltin(ref.specifier) || input.hostModules?.has(ref.specifier)) return;
    const location = `${path.relative(root, file)}:${ref.line} -> ${ref.specifier}`;
    try {
      const target = resolveEdge({ file, ...ref, input: stagedInput });
      // Third-party packages own their optional internals. This contract audits Jini and host files.
      const relative = path.relative(root, target).split(path.sep).join('/');
      const lastModules = relative.lastIndexOf('node_modules/');
      const owned = lastModules < 0 || /^@jini-ai\/[^/]+\/dist\//.test(relative.slice(lastModules + 'node_modules/'.length));
      if (codeFile(target) && owned) queue.push(target);
    } catch (error) { failure(file, ref.specifier, location, error); }
  }
  function scan(file: string): void {
    const source = Buffer.from(input.fs.read({ path: file })).toString('utf8');
    for (const ref of input.imports.references!({ file, source })) checkReference(file, ref);
  }
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    scan(file);
  }
  return { problems, optIns, checked: seen.size };
}
