import { toRepoRelative } from './lcov.js';
import type { SourceClassifier } from './lcov.js';

const WRAPPER_HELPER_NAMES = new Set(["__toCommonJS", "__copyProps", "__toESM", "__export"]);

const MIN_DA_RECORDS_FOR_SEVERE_HEURISTIC = 30;

export interface LcovBlock {
  readonly file: string;
  readonly fnda: ReadonlyArray<{ readonly name: string; readonly hits: number }>;
  readonly da: ReadonlyArray<number>;
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
  readonly contaminated: readonly BlockVerdict[];
  readonly evaluated: number;
  readonly skipped: number;
}

export interface GatedVerdict extends BlockVerdict {
  readonly baselined: boolean;
  readonly fails: boolean;
}

/** Apply path-based debt: severe contamination can never be suppressed. */
export function applyBaseline({ contaminated, baselineSet }: { contaminated: readonly BlockVerdict[]; baselineSet: ReadonlySet<string> }): readonly GatedVerdict[] {
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
export function parseBaseline({ baselineJson }: { baselineJson: string }): ReadonlySet<string> {
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
export function parseArgs({ argv }: { argv: readonly string[] }): ParsedArgs {
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
export function parseLcovBlocks({ lcovText }: { lcovText: string }): LcovBlock[] {
  const records = lcovText.replace(/\r\n/g, '\n').split(/^end_of_record$/m);
  const blocks: LcovBlock[] = [];
  for (const record of records) {
    const sfMatch = record.match(/^SF:(.+)$/m);
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

const EXPORT_FROM_STATEMENT =
  /export\s+(?:type\s+)?(?:\{[^{}]*\}|\*(?:\s+as\s+[A-Za-z_$][\w$]*)?)\s+from\s+["'][^"']+["']\s*;?/g;

/** Recognize plain re-export barrels using the inherited source-text heuristic. */
export function isPureReExportBarrelSource({ sourceText }: { sourceText: string }): boolean {
  const withoutComments = sourceText.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const matches = [...withoutComments.matchAll(EXPORT_FROM_STATEMENT)];
  if (matches.length === 0) return false;
  const remaining = withoutComments.replace(EXPORT_FROM_STATEMENT, "").trim();
  return remaining.length === 0;
}

/** Classify esbuild interop contamination using the host source classifier. */
export function classifyBlock({ block, repoRoot, isFirstParty }: { block: LcovBlock; repoRoot: string; isFirstParty: SourceClassifier }, { sourceText }: { sourceText?: string | undefined } = {}): BlockVerdict {
  const file = toRepoRelative({ sourceFile: block.file, repoRoot });
  if (!isFirstParty({ file })) return { file, status: 'skip', severe: false, reason: 'not a first-party source path' };
  if (sourceText !== undefined && isPureReExportBarrelSource({ sourceText })) {
    return {
      file, status: 'skip', severe: false,
      reason: 'pure re-export barrel (source is entirely `export ... from "...";` statements) -- its only ' +
        "instrumented \"functions\" are esbuild's own CJS-interop wrapper helpers plus one lazy getter " +
        'per re-exported name, not a second merged coverage image; wrapper-name presence here is ' +
        'structurally guaranteed for any barrel, with or without Route A, so it carries no ' +
        "contamination signal -- see this file's header",
    };
  }
  const wrapperNamesFound = new Set<string>();
  const wrapperValues = new Set<number>();
  for (const { name, hits } of block.fnda) {
    if (WRAPPER_HELPER_NAMES.has(name)) {
      wrapperNamesFound.add(name);
      wrapperValues.add(hits);
    }
  }
  if (wrapperNamesFound.size === 0) return { file, status: 'ok', severe: false, reason: 'no esbuild CJS-wrapper FNDA records in this block' };
  const fnSummary = block.fnf !== undefined && block.fnh !== undefined ? ` FNF:${block.fnf} FNH:${block.fnh}` : '';
  const contaminatedReason =
    `${wrapperNamesFound.size} esbuild CJS-wrapper helper record(s) [${[...wrapperNamesFound].sort().join(', ')}] ` +
    `present in this block's FNDA records -- two coverage images (real ESM + CJS wrapper) were merged ` +
    `here.${fnSummary} function coverage for this run is untrustworthy`;
  // A tiny barrel can share hit counts by coincidence. Escalation requires enough DA records
  // and a nonzero overlap with the wrapper's own counts; all-zero runs carry no merge signal.
  if (block.da.length >= MIN_DA_RECORDS_FOR_SEVERE_HEURISTIC) {
    const comparisonSet = new Set(wrapperValues);
    comparisonSet.add(0);
    const distinctDa = [...new Set(block.da)].sort((a, b) => a - b);
    const extra = distinctDa.filter((value) => !comparisonSet.has(value));
    const overlapHasRealSignal = distinctDa.some((value) => value !== 0 && comparisonSet.has(value));
    if (extra.length === 0 && overlapHasRealSignal) {
      const wrapperValuesSorted = [...wrapperValues].sort((a, b) => a - b);
      return {
        file, status: 'contaminated', severe: true,
        reason: `${contaminatedReason}. SEVERE: additionally, every one of this block's ${distinctDa.length} ` +
          `distinct DA hit-count value(s) [${distinctDa.join(', ')}] matches a wrapper helper's own FNDA ` +
          `hit-count [${wrapperValuesSorted.join(', ')}] (or 0) -- the wrapper image also won the line-hit ` +
          `merge, so line coverage for this run is untrustworthy too, regardless of what LH:/LF: report`,
      };
    }
  }
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
