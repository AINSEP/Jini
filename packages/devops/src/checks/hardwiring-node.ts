/** Node adapters for hardwiring inventories, resolution, package identities and debt generation.
 * Host policy supplies aliases, scan inputs and the debt path; the compiler remains an injected port.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { isBuiltin } from 'node:module';
import type ts from 'typescript';
import { diffHardwiringDebt, HARDWIRING_RULES, syntaxError } from './hardwiring.js';
import type { HardwiringViolation } from './hardwiring.js';

/** Authored inventory excludes generated output, fixtures and tests. O(directory entries). */
export function sourceFiles({ directory, declarations = false }: { directory: string; declarations?: boolean }, _options: Record<string, never> = {}): string[] {
  const found: string[] = [];
  function visit(dir: string): void {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'dist', 'build', 'coverage', 'release', 'release-verify', 'staging', '__tests__', '__measurements__', 'fixtures', 'vendor', '.git', '.build'].includes(entry.name)) continue;
      const file = join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (/\.[cm]?[jt]sx?$/.test(file) && !/\.(?:test|spec)\./.test(file) && (declarations || !/\.d\.[cm]?ts$/.test(file))) found.push(file);
    }
  }
  visit(directory);
  return found.sort();
}

/** Runtime compiler resolution denies declarations which can erase React edges.
 * Resolution failures omit the specifier because import literals may contain secrets.
 */
export function createResolver({ root, compiler: c, runtime = false, aliases = {} }: {
  root: string; compiler: typeof ts; runtime?: boolean; aliases?: Readonly<Record<string, string>>;
}, _options: Record<string, never> = {}) {
  const options: ts.CompilerOptions = { moduleResolution: c.ModuleResolutionKind.Bundler, module: c.ModuleKind.ESNext, allowJs: true, resolveJsonModule: true, customConditions: ['browser'] };
  // A declaration entry can erase every React edge while its executable imports React.
  // Keep browser/export resolution in the maintained compiler, but deny declaration candidates.
  const host = runtime ? { ...c.sys, fileExists: (file: string) => !/\.d\.[cm]?ts$/.test(file) && c.sys.fileExists(file) } : c.sys;
  return (specifier: string, file: string): string | undefined => {
    if (isBuiltin(specifier) || /\.(?:css|scss|sass|less|svg|png|jpg|woff2?|json)(?:\?|$)/.test(specifier)) return undefined;
    const resolved = c.resolveModuleName(aliased(specifier, aliases), file, options, host).resolvedModule?.resolvedFileName;
    if (!resolved) throw new Error(`Unresolved code import in ${relative(root, file)} (specifier omitted); refusing an incomplete public/plugin graph.`);
    return executable(resolved);
  };
}

/** The first matching host alias prefix wins. */
function aliased(specifier: string, aliases: Readonly<Record<string, string>>): string {
  const match = Object.entries(aliases).find(([prefix]) => specifier.startsWith(prefix));
  return match ? join(match[1], specifier.slice(match[0].length)) : specifier;
}

/** Prefer executable published JS over its paired declaration file for bundle reachability. */
function executable(resolved: string): string {
  if (!resolved.endsWith('.d.ts')) return resolved;
  const stem = resolved.slice(0, -5);
  return [stem + '.js', stem + '.mjs'].find(candidate => existsSync(candidate)) ?? resolved;
}

/** Debt stops at dependency package ownership; authored apps/content keep file identities.
 * Realpaths can point at sibling workspace packages locally and node_modules in CI.
 * Normalize dependency ownership to the manifest name so publishing cannot move its waiver.
 */
export function displayGraphFile({ file, root, authoredDirectories = ['apps', 'content'] }: {
  file: string; root: string; authoredDirectories?: readonly string[];
}, _options: Record<string, never> = {}): string {
  if (authoredDirectories.some(directory => file.startsWith(join(root, directory) + '/'))) return relative(root, file).replaceAll('\\', '/');
  for (let dir = dirname(file); dirname(dir) !== dir; dir = dirname(dir)) {
    const manifest = join(dir, 'package.json');
    if (!existsSync(manifest)) continue;
    const data = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string };
    if (data.name) return `node_modules/${data.name}`;
  }
  return relative(root, file).replaceAll('\\', '/');
}

/** Export maps may expose wildcard entries; private declarations stay excluded. */
function wildcardTargets(file: string): string[] {
  // Only called for targets containing '*', so split always yields a prefix and a suffix.
  const [prefix, suffix] = file.split('*') as [string, string];
  return sourceFiles({ directory: dirname(prefix), declarations: true })
    .filter(candidate => candidate.startsWith(prefix) && candidate.endsWith(suffix));
}

/** Select installed public targets, favouring declarations without executing package code. */
function publicTargets(directory: string, exports: unknown): string[] {
  const targets: string[] = [];
  function selectPath(value: string): void {
    if (!value.startsWith('./')) throw new Error(`Invalid public export target in ${directory}.`);
    const file = resolve(directory, value);
    if (value.includes('*')) targets.push(...wildcardTargets(file));
    else if (existsSync(file)) targets.push(file);
    else throw new Error(`Missing installed public entry in ${directory}.`);
  }
  function selectRecord(record: Record<string, unknown>): void {
    const entryKeys = Object.keys(record).filter(key => key.startsWith('.'));
    if (entryKeys.length) {
      for (const key of entryKeys) select(record[key]);
      return;
    }
    const condition = ['types', 'import', 'default', 'node', 'browser', 'require'].find(key => record[key] !== undefined);
    if (condition) select(record[condition]);
  }
  function select(value: unknown): void {
    if (typeof value === 'string') selectPath(value);
    else if (Array.isArray(value)) {
      const candidate = value.find(item => item !== null);
      if (candidate !== undefined) select(candidate);
    } else if (value && typeof value === 'object') selectRecord(value as Record<string, unknown>);
  }
  select(exports);
  return targets;
}

interface InstalledManifest { name?: string; exports?: unknown; types?: string; main?: string }

/** Packages without `exports` fall back to their legacy types/main entry, made package-relative. */
function legacyEntry({ types, main }: InstalledManifest): string | undefined {
  const legacy = types ?? main;
  if (!legacy) return undefined;
  return legacy.startsWith('./') ? legacy : './' + legacy;
}

function packageEntries(directory: string): string[] {
  const manifest = join(directory, 'package.json');
  if (!existsSync(manifest)) return [];
  const data = JSON.parse(readFileSync(manifest, 'utf8')) as InstalledManifest;
  if (!data.name?.startsWith('@jini-ai/')) return [];
  return publicTargets(directory, data.exports ?? legacyEntry(data));
}

/** Parsing errors fail closed for every loaded file, including transitive declarations. */
function assertParsed(program: ts.Program): void {
  for (const file of program.getSourceFiles()) {
    const failure = syntaxError({ tree: file, file: file.fileName });
    if (failure) throw failure;
  }
}

function callableExports(c: typeof ts, checker: ts.TypeChecker, tree: ts.SourceFile): string[] {
  const module = checker.getSymbolAtLocation(tree);
  if (!module) return [];
  return checker.getExportsOfModule(module).filter((item) => {
    const symbol = item.flags & c.SymbolFlags.Alias ? checker.getAliasedSymbol(item) : item;
    // Interfaces with call signatures are types, not public runtime functions.
    if (!(symbol.flags & c.SymbolFlags.Value)) return false;
    return checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration ?? tree).getCallSignatures().length > 0;
  }).map((item) => item.name);
}

/** HW5 reads only installed package export entries, including aliases and re-export barrels.
 * TypeScript's checker owns symbol resolution; no source checkout or private dist scan is used.
 * Parsing errors fail closed; this creates an analysis program without running a typecheck.
 */
export function installedPublicFunctions({ root, compiler: c }: { root: string; compiler: typeof ts }, _options: Record<string, never> = {}): ReadonlySet<string> {
  const installed = join(root, 'node_modules/@jini-ai');
  if (!existsSync(installed)) throw new Error('Jini export inventory unavailable; install the declared packages.');
  const entries = readdirSync(installed).flatMap(item => packageEntries(join(installed, item)));
  const program = c.createProgram(entries, { moduleResolution: c.ModuleResolutionKind.Bundler, module: c.ModuleKind.ESNext, allowJs: true, noEmit: true, skipLibCheck: true });
  assertParsed(program);
  const checker = program.getTypeChecker();
  const found = new Set<string>();
  for (const entry of entries) {
    const tree = program.getSourceFile(entry);
    if (tree) for (const name of callableExports(c, checker, tree)) found.add(name);
  }
  if (!found.size) throw new Error('Jini export inventory is empty; refusing a vacuous duplication check.');
  return found;
}

/** Shared occurrence ratchet and the sole debt generator. Never regenerate baselines in CI. */
export async function runHardwiring({ collect, debtPath, baselineComment, logger = console }: {
  collect: () => readonly HardwiringViolation[] | Promise<readonly HardwiringViolation[]>;
  debtPath: string; baselineComment: string; logger?: Pick<Console, 'log' | 'error'>;
}, { writeBaseline = false }: { writeBaseline?: boolean } = {}): Promise<HardwiringViolation[]> {
  const violations = await collect();
  if (writeBaseline) writeFileSync(debtPath, JSON.stringify({ _comment: baselineComment, violations }, null, 2) + '\n');
  const debt = JSON.parse(readFileSync(debtPath, 'utf8')) as { violations: HardwiringViolation[] };
  const { added, removed } = diffHardwiringDebt({ baseline: debt.violations, current: violations });
  for (const rule of HARDWIRING_RULES) logger.log(`[hardwiring] ${rule}: ${violations.filter(v => v.rule === rule).length} total; ${added.filter(v => v.rule === rule).length} new`);
  if (removed.length) logger.log(`[hardwiring] ${removed.length} stale debt occurrences; remove them from ${debtPath}.`);
  for (const v of added) logger.error(`[hardwiring] ${v.rule} ${v.file}:${v.line}: ${v.reason}`);
  return added;
}
