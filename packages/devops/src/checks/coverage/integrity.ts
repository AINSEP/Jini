import { toRepoRelative } from './lcov.js';
import type { SourceClassifier } from './lcov.js';

const WRAPPER_HELPER_NAMES = new Set(["__toCommonJS", "__copyProps", "__toESM", "__export"]);

// 30 is comfortably below the real severe block measured 2026-08-21 (357 DA records) and comfortably above a trivial single-purpose file.
const MIN_DA_RECORDS_FOR_SEVERE_HEURISTIC = 30;

export interface LcovBlock {
  /** Raw `SF:` path text, not yet normalized to repo-relative. */
  readonly file: string;
  readonly fnda: ReadonlyArray<{ readonly name: string; readonly hits: number }>;
  /** `DA:` hit counts only, in record order. Line numbers are deliberately not kept: the report is file-granular, and instrumented line numbers may not match source lines. */
  readonly da: ReadonlyArray<number>;
  /** Declared `FNF:` and `FNH:` counts can be read directly because aggregate counts are unaffected by the comment-stripping line-number bug. A record may omit either summary. */
  readonly fnf?: number | undefined;
  readonly fnh?: number | undefined;
}

export type BlockStatus = "contaminated" | "ok" | "skip";

export interface BlockVerdict {
  readonly file: string;
  readonly status: BlockStatus;
  readonly severe: boolean;
  readonly reason: string;
}

export interface IntegrityReport {
  /** Every CONTAMINATED block, severe or not — filter on `.severe` for the SEVERE subset. */
  readonly contaminated: readonly BlockVerdict[];
  /** Number of blocks run through the heuristics, excluding skipped blocks. */
  readonly evaluated: number;
  readonly skipped: number;
}

export interface GatedVerdict extends BlockVerdict {
  readonly baselined: boolean;
  readonly fails: boolean;
}

/** Apply path-based debt: severe contamination can never be suppressed. */
export function applyBaseline({ contaminated, baselineSet }: { contaminated: readonly BlockVerdict[]; baselineSet: ReadonlySet<string> }, _optional: Record<string, never> = {}): readonly GatedVerdict[] {
  return contaminated.map((v) => {
    const baselined = baselineSet.has(v.file);
    return { ...v, baselined, fails: v.severe || !baselined };
  });
}

interface BaselineFile {
  readonly _comment?: readonly string[];
  readonly knownContaminated?: readonly string[];
}

/** Read the caller-provided baseline JSON; an absent ledger is empty. */
export function parseBaseline({ baselineJson }: { baselineJson: string }, _optional: Record<string, never> = {}): ReadonlySet<string> {
  const parsed = JSON.parse(baselineJson) as BaselineFile;
  return new Set(parsed.knownContaminated ?? []);
}

export const DEFAULT_BASELINE_COMMENT: readonly string[] = [
  'Known, reviewed coverage-contamination debt, recorded by path.',
  'Severe findings always fail regardless of baseline membership.',
];

/** Serialize deduplicated, sorted debt paths for reviewable changes. */
export function serializeBaseline({ paths }: { paths: readonly string[] }, { comment = DEFAULT_BASELINE_COMMENT }: { comment?: readonly string[] | undefined } = {}): string {
  const knownContaminated = [...new Set(paths)].sort((a, b) => a.localeCompare(b));
  return `${JSON.stringify({ _comment: comment, knownContaminated }, null, 2)}\n`;
}

export interface ParsedArgs {
  readonly lcovArg?: string | undefined;
  readonly baselinePath?: string | undefined;
  readonly updateBaseline: boolean;
}

/** Parse coverage artifact and baseline CLI arguments without process globals. */
// One optional positional, one value-bearing flag and one boolean flag keep this parser small enough to avoid a parsing dependency. The first non-flag argument wins, matching the permissive handling of the other check scripts.
export function parseArgs({ argv }: { argv: readonly string[] }, _optional: Record<string, never> = {}): ParsedArgs {
  let lcovArg: string | undefined;
  let baselinePath: string | undefined;
  let updateBaseline = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--update-baseline") {
      updateBaseline = true;
    } else if (arg === "--baseline") {
      baselinePath = argv[i + 1];
      i++; // consume the flag's value too
    } else if (!arg.startsWith("--") && lcovArg === undefined) {
      lcovArg = arg;
    }
  }
  return { lcovArg, baselinePath, updateBaseline };
}

/** Parse function and line hit records, preserving summaries when present. */
export function parseLcovBlocks({ lcovText }: { lcovText: string }, _optional: Record<string, never> = {}): LcovBlock[] {
  const records = lcovText.replace(/\r\n/g, '\n').split(/^end_of_record$/m);
  const blocks: LcovBlock[] = [];
  for (const record of records) {
    const sfMatch = record.match(/^SF:(.+)$/m);
    // A record with no `SF:` line is malformed input or text before the first block. Ignore it as the coverage loader does.
    if (!sfMatch) continue;
    const fnda = [...record.matchAll(/^FNDA:(\d+),(.+)$/gm)].map((m) => ({
      hits: Number(m[1]),
      name: m[2]!,
    }));
    const da = [...record.matchAll(/^DA:\d+,(\d+)$/gm)].map((m) => Number(m[1]));
    const fnfMatch = record.match(/^FNF:(\d+)$/m);
    const fnhMatch = record.match(/^FNH:(\d+)$/m);
    blocks.push({
      file: sfMatch[1]!.trim(),
      fnda,
      da,
      fnf: fnfMatch ? Number(fnfMatch[1]) : undefined,
      fnh: fnhMatch ? Number(fnhMatch[1]) : undefined,
    });
  }
  return blocks;
}

// The `[^{}]*` class spans multiline export lists without a dot-all flag. Export specifier lists cannot contain nested braces, so the match stays within one statement. The semicolon is optional for ASI.
const EXPORT_FROM_STATEMENT =
  /export\s+(?:type\s+)?(?:\{[^{}]*\}|\*(?:\s+as\s+[A-Za-z_$][\w$]*)?)\s+from\s+["'][^"']+["']\s*;?/g;

/** Recognize plain re-export barrels using the inherited source-text heuristic. */
// Check the file’s source because a logic-bearing file can coincidentally have the same LCOV shape as a pure barrel. Any real declaration keeps the file subject to normal contamination checks.
export function isPureReExportBarrelSource({ sourceText }: { sourceText: string }, _optional: Record<string, never> = {}): boolean {
  const withoutComments = sourceText.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const matches = [...withoutComments.matchAll(EXPORT_FROM_STATEMENT)];
  if (matches.length === 0) return false;
  const remaining = withoutComments.replace(EXPORT_FROM_STATEMENT, "").trim();
  return remaining.length === 0;
}

const BARREL_SKIP_REASON =
  'pure re-export barrel (source is entirely `export ... from "...";` statements) -- its only ' +
  "instrumented \"functions\" are esbuild's own CJS-interop wrapper helpers plus one lazy getter " +
  'per re-exported name, not a second merged coverage image; wrapper-name presence here is ' +
  'structurally guaranteed for any barrel, with or without Route A, so it carries no ' +
  "contamination signal -- see this file's header";

/** The esbuild wrapper helper names present in a block's FNDA records, and their hit counts. */
function collectWrapperHits(fnda: LcovBlock['fnda']): { names: Set<string>; values: Set<number> } {
  const names = new Set<string>();
  const values = new Set<number>();
  for (const { name, hits } of fnda) {
    if (WRAPPER_HELPER_NAMES.has(name)) {
      names.add(name);
      values.add(hits);
    }
  }
  return { names, values };
}

/** The SEVERE suffix when the wrapper image also won the line-hit merge, otherwise undefined. */
// A bare ‘few distinct DA values’ threshold flagged 53–54 first-party files in every historical validation run, including clean runs. Comparing DA values to the wrapper's own FNDA counts identified the one independently confirmed corrupt block across the six runs.
function severeLineMergeReason(da: readonly number[], wrapperValues: ReadonlySet<number>): string | undefined {
  // A tiny barrel can share hit counts by coincidence. Escalation requires enough DA records
  // and a nonzero overlap with the wrapper's own counts; all-zero runs carry no merge signal.
  if (da.length < MIN_DA_RECORDS_FOR_SEVERE_HEURISTIC) return undefined;
  const comparisonSet = new Set(wrapperValues);
  // Dead or unreached code under either image legitimately reads 0.
  comparisonSet.add(0);
  const distinctDa = [...new Set(da)].sort((a, b) => a - b);
  const extra = distinctDa.filter((value) => !comparisonSet.has(value));
  const overlapHasRealSignal = distinctDa.some((value) => value !== 0 && comparisonSet.has(value));
  if (extra.length > 0 || !overlapHasRealSignal) return undefined;
  const wrapperValuesSorted = [...wrapperValues].sort((a, b) => a - b);
  return `. SEVERE: additionally, every one of this block's ${distinctDa.length} ` +
    `distinct DA hit-count value(s) [${distinctDa.join(', ')}] matches a wrapper helper's own FNDA ` +
    `hit-count [${wrapperValuesSorted.join(', ')}] (or 0) -- the wrapper image also won the line-hit ` +
    `merge, so line coverage for this run is untrustworthy too, regardless of what LH:/LF: report`;
}

/** Classify esbuild interop contamination using the host source classifier. */
export function classifyBlock({ block, repoRoot, isFirstParty }: { block: LcovBlock; repoRoot: string; isFirstParty: SourceClassifier }, { sourceText }: { sourceText?: string | undefined } = {}): BlockVerdict {
  const file = toRepoRelative({ sourceFile: block.file, repoRoot });
  if (!isFirstParty({ file })) return { file, status: 'skip', severe: false, reason: 'not a first-party source path' };
  if (sourceText !== undefined && isPureReExportBarrelSource({ sourceText })) return { file, status: 'skip', severe: false, reason: BARREL_SKIP_REASON };
  const wrapper = collectWrapperHits(block.fnda);
  if (wrapper.names.size === 0) return { file, status: 'ok', severe: false, reason: 'no esbuild CJS-wrapper FNDA records in this block' };
  const fnSummary = block.fnf !== undefined && block.fnh !== undefined ? ` FNF:${block.fnf} FNH:${block.fnh}` : '';
  const contaminatedReason =
    `${wrapper.names.size} esbuild CJS-wrapper helper record(s) [${[...wrapper.names].sort().join(', ')}] ` +
    `present in this block's FNDA records -- two coverage images (real ESM + CJS wrapper) were merged ` +
    `here.${fnSummary} function coverage for this run is untrustworthy`;
  const severeSuffix = severeLineMergeReason(block.da, wrapper.values);
  if (severeSuffix !== undefined) return { file, status: 'contaminated', severe: true, reason: `${contaminatedReason}${severeSuffix}` };
  return { file, status: 'contaminated', severe: false, reason: `${contaminatedReason}.` };
}

/** Evaluate supplied LCOV text and an optional host source reader, without disk I/O. */
export function checkCoverageIntegrity({ lcovText, repoRoot, isFirstParty }: { lcovText: string; repoRoot: string; isFirstParty: SourceClassifier }, { readSource }: { readSource?: ((args: { file: string }) => string | undefined) | undefined } = {}): IntegrityReport {
  const verdicts = parseLcovBlocks({ lcovText }).map((block) => {
    const file = toRepoRelative({ sourceFile: block.file, repoRoot });
    return classifyBlock({ block, repoRoot, isFirstParty }, { sourceText: readSource?.({ file }) });
  });
  const contaminated = verdicts.filter((v) => v.status === "contaminated");
  const skipped = verdicts.filter((v) => v.status === "skip").length;
  return { contaminated, evaluated: verdicts.length - skipped, skipped };
}
