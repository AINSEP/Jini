import type { SourceReaderPort } from '../ports.js';

export interface FileCoverage { file: string; lf: number; lh: number; brf: number; brh: number; fnf: number; fnh: number }
export interface SourceClassificationRules {
  prefixes: readonly string[];
  sourceExtensions: readonly string[];
  excludedDirectories: readonly string[];
  excludedBasenames: readonly string[];
  testPattern: RegExp;
}
export type SourceClassifier = (args: { file: string }) => boolean;

/** LCOV's empty denominator is vacuously 100%; area checks separately reject empty scopes. */
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

/** Parse LCOV summaries without filtering source or accessing a filesystem. */
export function parseLcov({ text, repoRoot }: { text: string; repoRoot: string }): FileCoverage[] {
  const out: FileCoverage[] = [];
  for (const record of text.replace(/\r\n/g, '\n').split(/^end_of_record$/m)) {
    const source = record.match(/^SF:(.+)$/m)?.[1];
    if (!source) continue;
    out.push({ file: toRepoRelative({ sourceFile: source, repoRoot }), lf: field(record, 'LF'), lh: field(record, 'LH'), brf: field(record, 'BRF'), brh: field(record, 'BRH'), fnf: field(record, 'FNF'), fnh: field(record, 'FNH') });
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

/** Merge separate coverage images without adding incomparable counters; higher line-hit image wins. */
export function mergeCoverage({ reports, isMeasurable }: {
  reports: readonly (readonly FileCoverage[])[]; isMeasurable: SourceClassifier;
}): ReadonlyMap<string, FileCoverage> {
  const byFile = new Map<string, FileCoverage>();
  for (const report of reports) for (const record of report) {
    if (!isMeasurable({ file: record.file })) continue;
    const previous = byFile.get(record.file);
    if (!previous || record.lh > previous.lh) byFile.set(record.file, { ...record });
  }
  return byFile;
}
