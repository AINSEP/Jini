import type { SourceReaderPort } from '../ports.js';

interface CoverageEntries { line: ReadonlyMap<string, number>; branch: ReadonlyMap<string, number>; funcs: ReadonlyMap<string, number> | undefined }
export interface FileCoverage { file: string; lf: number; lh: number; brf: number; brh: number; fnf: number; fnh: number; entries?: CoverageEntries }
export interface SourceClassificationRules {
  prefixes: readonly string[];
  sourceExtensions: readonly string[];
  excludedDirectories: readonly string[];
  excludedBasenames: readonly string[];
  testPattern: RegExp;
}
export type SourceClassifier = (args: { file: string }) => boolean;

/** LCOV's empty denominator is vacuously 100%; area checks separately reject empty scopes. */
/** `pct(0, 0)` is 100: a file with no branches is fully branch-covered. Correct per file, and
 *  dangerous per area — which is why {@link evaluateArea} never relies on it to decide whether an
 *  area was measured at all.
 *  @complexity O(1). */
// evaluateArea is the disk inventory owner, now evaluateDiskArea in ./disk.ts.
export function pct({ hit, found }: { hit: number; found: number }): number { return found === 0 ? 100 : 100 * hit / found; }

/** Normalize paths with a directory boundary check, including Windows paths on non-Windows hosts. */
export function toRepoRelative({ sourceFile, repoRoot }: { sourceFile: string; repoRoot: string }): string {
  const file = sourceFile.trim().replace(/\\/g, '/');
  const root = repoRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  if (file === root) return '';
  if (file.startsWith(`${root}/`)) return file.slice(root.length + 1);
  return file;
}

/** Match caller-supplied integration suffixes and directory segments. */
export function isIntegrationTestFile({ file, suffixes, directories }: {
  file: string; suffixes: readonly string[]; directories: readonly string[];
}): boolean {
  const normalized = file.replace(/\\/g, '/');
  return suffixes.some((suffix) => normalized.endsWith(suffix)) || directories.some((dir) => `/${normalized}`.includes(`/${dir.replace(/^\/+|\/+$/g, '')}/`));
}

/** Match source roots on directory boundaries and apply host-defined exclusions. */
export function isMeasurableSourceFile({ file, rules }: { file: string; rules: SourceClassificationRules }): boolean {
  const normalized = file.replace(/\\/g, '/');
  if (!rules.prefixes.some((prefix) => normalized.startsWith(`${prefix.replace(/\/+$/, '')}/`))) return false;
  if (!rules.sourceExtensions.some((extension) => normalized.endsWith(extension))) return false;
  const parts = normalized.split('/');
  if (parts.some((part) => rules.excludedDirectories.includes(part))) return false;
  if (rules.excludedBasenames.includes(parts.at(-1) ?? '')) return false;
  // Do not mutate a host's global/sticky regex or inherit its lastIndex.
  return !new RegExp(rules.testPattern.source, rules.testPattern.flags.replace(/[gy]/g, '')).test(normalized);
}

function field(record: string, name: string): number { return Number(record.match(new RegExp(`^${name}:(\\d+)$`, 'm'))?.[1] ?? 0); }

/** Preserve entry identities for exact unions; ambiguous function declarations retain summaries only.
 * @complexity O(n) time and space in record entries. */
function readEntries(record: string): CoverageEntries | undefined {
  if (!/^(?:DA|BRDA|FNDA|FN):/m.test(record)) return undefined;
  const line = new Map<string, number>();
  const branch = new Map<string, number>();
  for (const match of record.matchAll(/^DA:(\d+),(\d+)/gm)) line.set(match[1]!, Number(match[2]));
  for (const match of record.matchAll(/^BRDA:(\d+,[^,\n]+,[^,\n]+),(\d+|-)$/gm)) branch.set(match[1]!, Number(match[2]) || 0);
  return { line, branch, funcs: readFunctionEntries(record) };
}

/** Classic FNDA names do not disambiguate duplicate declarations; never infer their hit locations.
 * @complexity O(n) time and space in function declarations and counts. */
function readFunctionEntries(record: string): ReadonlyMap<string, number> | undefined {
  const declared = new Map<string, string>();
  const entries = new Map<string, number>();
  for (const match of record.matchAll(/^FN:(\d+),(?:(\d+),)?(.+)$/gm)) {
    const name = match[3]!;
    if (declared.has(name)) return undefined;
    const key = JSON.stringify([Number(match[1]), match[2], name]);
    declared.set(name, key);
    entries.set(key, 0);
  }
  const counted = new Set<string>();
  for (const match of record.matchAll(/^FNDA:(\d+),(.+)$/gm)) {
    const key = declared.get(match[2]!);
    if (!key || counted.has(key)) return undefined;
    counted.add(key);
    entries.set(key, Number(match[1]));
  }
  return entries;
}

/** Parse LCOV summaries without filtering source or accessing a filesystem. */
export function parseLcov({ text, repoRoot }: { text: string; repoRoot: string }): FileCoverage[] {
  const out: FileCoverage[] = [];
  for (const record of text.replace(/\r\n/g, '\n').split(/^end_of_record$/m)) {
    const source = record.match(/^SF:(.+)$/m)?.[1];
    if (!source) continue;
    const entries = readEntries(record);
    out.push({ ...(entries ? { entries } : {}), file: toRepoRelative({ sourceFile: source, repoRoot }), lf: field(record, 'LF'), lh: field(record, 'LH'), brf: field(record, 'BRF'), brh: field(record, 'BRH'), fnf: field(record, 'FNF'), fnh: field(record, 'FNH') });
  }
  return out;
}

/** Read the exact supplied artifact; missing/unreadable artifacts propagate the reader's error. */
export function loadLcov({ lcovPath, repoRoot, reader }: { lcovPath: string; repoRoot: string; reader: SourceReaderPort }): FileCoverage[] {
  return parseLcov({ text: reader.readText({ path: lcovPath }), repoRoot });
}

/** Load and classify coverage without repository-specific route knowledge. */
export function loadRouteCoverage({ lcovPath, repoRoot, reader, isMeasurable }: {
  lcovPath: string; repoRoot: string; reader: SourceReaderPort; isMeasurable: SourceClassifier;
}): FileCoverage[] { return loadLcov({ lcovPath, repoRoot, reader }).filter((record) => isMeasurable({ file: record.file })); }

/** Union matching instrumentation; summaries alone cannot identify overlapping hits.
 * @throws When reports lack entries or use incompatible instrumentation.
 * @complexity O(e) time and space in entries. */
function unionEntries(a: ReadonlyMap<string, number> | undefined, b: ReadonlyMap<string, number> | undefined, found: number, axis: string): Map<string, number> {
  if (found === 0) return new Map();
  if (!a || !b) throw new Error(axis === 'function' ? 'Cannot union function coverage without unambiguous LCOV declarations' : `Cannot union ${axis} coverage without LCOV entries`);
  if (a.size !== found || b.size !== found || [...a.keys()].some((key) => !b.has(key))) throw new Error(`Incompatible ${axis} coverage layouts`);
  const merged = new Map(a);
  for (const [key, count] of b) merged.set(key, Math.max(merged.get(key)!, count));
  return merged;
}

function unionRecords(a: FileCoverage, b: FileCoverage): FileCoverage {
  if (a.lf !== b.lf || a.brf !== b.brf || a.fnf !== b.fnf) throw new Error('Incompatible line, branch or function coverage totals');
  const line = unionEntries(a.entries?.line, b.entries?.line, a.lf, 'line');
  const branch = unionEntries(a.entries?.branch, b.entries?.branch, a.brf, 'branch');
  const funcs = unionEntries(a.entries?.funcs, b.entries?.funcs, a.fnf, 'function');
  const hit = (entries: ReadonlyMap<string, number>) => [...entries.values()].filter((count) => count > 0).length;
  return { file: a.file, lf: line.size, lh: hit(line), brf: branch.size, brh: hit(branch), fnf: funcs.size, fnh: hit(funcs), entries: { line, branch, funcs } };
}

/** Union separate reports by line, branch and function identity without double counting.
 * @throws If duplicate records cannot be unioned from matching entry-level evidence.
 * @complexity O(e) time and space in supplied entries. */
export function mergeCoverage({ reports, isMeasurable }: {
  reports: readonly (readonly FileCoverage[])[]; isMeasurable: SourceClassifier;
}): ReadonlyMap<string, FileCoverage> {
  const byFile = new Map<string, FileCoverage>();
  for (const report of reports) for (const record of report) {
    if (!isMeasurable({ file: record.file })) continue;
    const previous = byFile.get(record.file);
    byFile.set(record.file, previous ? unionRecords(previous, record) : { ...record });
  }
  return byFile;
}
