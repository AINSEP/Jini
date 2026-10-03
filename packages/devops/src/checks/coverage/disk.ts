import { pct } from './lcov.js';

export interface LcovCounters {
  lf: number;
  lh: number;
  brf: number;
  brh: number;
  fnf: number;
  fnh: number;
}

export type CoverageAxis = "line" | "branch" | "funcs";

export interface CoverageArea {
  id: string;
  dirs?: readonly string[];
  excludeDirs?: readonly string[];
  extensions?: readonly string[];
  floors?: Partial<Record<CoverageAxis, number>>;
  knownUnmeasured?: readonly string[];
  minFilesOnDisk?: number;
}

export interface RunnerGlobs {
  nodeArgs: readonly string[];
  globs: readonly string[];
}

export interface TestPass extends RunnerGlobs {
  id: string;
}

export interface DiskAreaResult {
  id: string;
  actual: Record<CoverageAxis, number>;
  measuredCount: number;
  onDiskCount: number;
  unmeasured: string[];
  newlyUnmeasured: string[];
  recovered: string[];
  failures: string[];
}

/** Exclude test and declaration filenames from a production-source inventory. */
export function isMeasurableSource({ file: relPath }: { file: string }): boolean {
  if (/\.(test|spec)\.(js|cjs|mjs|ts|tsx|mts)$/.test(relPath)) return false;
  if (relPath.endsWith(".d.ts")) return false;
  return true;
}

/** Match excluded directories on segment boundaries. */
export function isInExcludedDir({ file: relPath, excludeDirs }: { file: string; excludeDirs: readonly string[] }): boolean {
  return excludeDirs.some((dir) => {
    const base = dir.replace(/\/+$/, "");
    return relPath === base || relPath.startsWith(`${base}/`);
  });
}

/** Read a chain of node test commands into runner/glob records; reject other commands. */
export function parseNodeTestScript({ script }: { script: string }): RunnerGlobs[] {
  return script.split("&&").map((command) => {
    const tokens = [...command.matchAll(/"([^"]*)"|(\S+)/g)].map((match) => match[1] ?? match[2]!);
    const testAt = tokens.indexOf("--test");
    if (tokens[0] !== "node" || testAt < 0) {
      throw new Error(`not a "node [args] --test <globs>" command: ${command.trim()}`);
    }
    return { nodeArgs: tokens.slice(1, testAt), globs: tokens.slice(testAt + 1) };
  });
}

function globsByRunner(passes: readonly RunnerGlobs[]): Map<string, Set<string>> {
  const byRunner = new Map<string, Set<string>>();
  for (const pass of passes) {
    const runner = ["node", ...pass.nodeArgs].join(" ");
    const globs = byRunner.get(runner) ?? new Set();
    for (const glob of pass.globs) globs.add(glob);
    byRunner.set(runner, globs);
  }
  return byRunner;
}

function unmatchedGlobs(
  side: ReadonlyMap<string, ReadonlySet<string>>,
  other: ReadonlyMap<string, ReadonlySet<string>>
): { runner: string; glob: string }[] {
  const unmatched: { runner: string; glob: string }[] = [];
  for (const [runner, globs] of side) {
    for (const glob of globs) if (!other.get(runner)?.has(glob)) unmatched.push({ runner, glob });
  }
  return unmatched;
}

/** Report every runner/glob mismatch between two explicitly supplied inventories. */
export function runnerSplitDrift({ passes, scriptPasses }: { passes: readonly RunnerGlobs[]; scriptPasses: readonly RunnerGlobs[] }): string[] {
  const inPasses = globsByRunner(passes);
  const inScript = globsByRunner(scriptPasses);
  return [
    ...unmatchedGlobs(inScript, inPasses).map(
      ({ runner, glob }) => `package.json runs ${glob} under "${runner}"; TEST_PASSES does not`
    ),
    ...unmatchedGlobs(inPasses, inScript).map(
      ({ runner, glob }) => `TEST_PASSES runs ${glob} under "${runner}"; package.json does not`
    ),
  ];
}

function total(records: readonly LcovCounters[]): LcovCounters {
  const sum = { lf: 0, lh: 0, brf: 0, brh: 0, fnf: 0, fnh: 0 };
  for (const r of records) {
    sum.lf += r.lf;
    sum.lh += r.lh;
    sum.brf += r.brf;
    sum.brh += r.brh;
    sum.fnf += r.fnf;
    sum.fnh += r.fnh;
  }
  return sum;
}

function floorFailures(
  area: CoverageArea,
  measured: LcovCounters
): { actual: Record<CoverageAxis, number>; failures: string[] } {
  const actual = {
    line: pct({ hit: measured.lh, found: measured.lf }),
    branch: pct({ hit: measured.brh, found: measured.brf }),
    funcs: pct({ hit: measured.fnh, found: measured.fnf }),
  };
  const failures: string[] = [];
  for (const axis of ["line", "branch", "funcs"] as const) {
    const floor = area.floors?.[axis];
    if (typeof floor === "number" && actual[axis] < floor) {
      failures.push(`${axis} ${actual[axis].toFixed(2)}% < floor ${floor}%`);
    }
  }
  return { actual, failures };
}

/** Evaluate floors against an independently supplied source inventory and declared gaps. */
export function evaluateDiskArea({ area, onDisk, coverage }: { area: CoverageArea; onDisk: readonly string[]; coverage: ReadonlyMap<string, LcovCounters> }): DiskAreaResult {
  const diskPaths = [...new Set(onDisk)];
  const known = new Set(area.knownUnmeasured ?? []);
  const measuredPaths = diskPaths.filter((p) => coverage.has(p));
  const unmeasured = diskPaths.filter((p) => !coverage.has(p));
  const measured = total(measuredPaths.map((p) => coverage.get(p)!));
  const { actual, failures } = floorFailures(area, measured);
  const newlyUnmeasured = unmeasured.filter((p) => !known.has(p));
  if (newlyUnmeasured.length > 0) {
    failures.push(
      `${newlyUnmeasured.length} file(s) have NO coverage record and are not in knownUnmeasured: ` +
        `${newlyUnmeasured.join(", ")}. Add a test, or grandfather them explicitly with a reason.`
    );
  }
  const minOnDisk = area.minFilesOnDisk ?? 1;
  if (diskPaths.length < minOnDisk) {
    failures.push(
      `only ${diskPaths.length} file(s) found on disk, expected at least ${minOnDisk}. ` +
        `The glob is stale (directory renamed?) or the scan is broken — this is NOT a pass.`
    );
  }
  const recovered = [...known].filter((p) => coverage.has(p));

  return {
    id: area.id,
    actual,
    measuredCount: measuredPaths.length,
    onDiskCount: diskPaths.length,
    unmeasured,
    newlyUnmeasured,
    recovered,
    failures,
  };
}

/** Render floors and every measured/unmeasured source path in an area. */
export function formatDiskArea({ result, area }: { result: DiskAreaResult; area: CoverageArea }): string {
  const lines = [`  ${result.failures.length === 0 ? "OK  " : "FAIL"}  ${result.id}`];
  const floors: Partial<Record<CoverageAxis, number>> = area.floors ?? {};
  for (const axis of ["line", "branch", "funcs"] as const) {
    const floor = floors[axis];
    const shown = `${result.actual[axis].toFixed(2)}%`;
    lines.push(`          ${axis.padEnd(6)} ${shown.padStart(7)}  ${typeof floor === "number" ? `(floor ${floor}%)` : "(no floor configured)"}`);
  }
  lines.push(`          files:  ${result.measuredCount} measured of ${result.onDiskCount} on disk`);
  if (result.unmeasured.length > 0) {
    lines.push(`          UNMEASURED (${result.unmeasured.length}, known gap — no test loads these):`);
    for (const p of result.unmeasured) lines.push(`            - ${p}`);
  }
  if (result.recovered.length > 0) {
    lines.push(`          NOW COVERED, remove from knownUnmeasured: ${result.recovered.join(", ")}`);
  }
  for (const f of result.failures) lines.push(`          ! ${f}`);
  return lines.join("\n");
}
