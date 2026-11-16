/**
 * R14 — no runtime module cycles in `packages/**\/src`.
 *
 * A runtime cycle is a set of modules that load each other in the emitted JavaScript. It makes
 * evaluation order depend on which file is imported first, and it hides the layer a shared helper
 * belongs to. This check runs dependency-cruiser with `scripts/runtime-cycles.depcruise.mjs`
 * (see that file for why the two compiler-related settings are required) and reports every cycle.
 *
 * Known debt lives in `scripts/runtime-cycle-debt.json`: files allowed to stay in a cycle until
 * their planned fix lands. The list only shrinks:
 *  - a cycle with at least one member that is not listed is a violation;
 *  - a listed file that is no longer in any cycle is a violation ("delete the entry").
 *
 * Tests are out of scope (a test may import anything), matching the config's `exclude`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Violation } from './check-engine-boundaries.js';

const RULE = 'R14-runtime-module-cycle';
const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = join(SCRIPTS_DIR, 'runtime-cycles.depcruise.mjs');
const DEBT_FILE = join(SCRIPTS_DIR, 'runtime-cycle-debt.json');
const DEBT_FILE_LABEL = 'scripts/runtime-cycle-debt.json';
// The root devDependency's CLI entry. Not resolved through `require.resolve`: the package's export
// map names neither `./package.json` nor its `bin` folder.
const DEPCRUISE_BIN = join(SCRIPTS_DIR, '..', 'node_modules', 'dependency-cruiser', 'bin', 'dependency-cruise.mjs');

interface CycleReport {
  readonly from: string;
  readonly cycle: ReadonlyArray<{ readonly name: string }>;
}

export interface CheckRuntimeCyclesOptions {
  /** Repo-relative source roots to scan. Default: every `src` folder of a package under `packages/`. */
  readonly roots?: readonly string[];
  /** Repo-relative files allowed to stay in a cycle. Default: the list in `scripts/runtime-cycle-debt.json`. */
  readonly debtFiles?: readonly string[];
}

/** `packages/<name>/src` for every package, plus one level of nested packages (`packages/cms/forms/src`). */
function packageSourceRoots(required: { repoRoot: string }, _optional: Record<string, never> = {}): string[] {
  const roots: string[] = [];
  const packagesDir = join(required.repoRoot, 'packages');
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'node_modules') continue;
    if (existsSync(join(packagesDir, entry.name, 'src'))) roots.push(`packages/${entry.name}/src`);
    for (const child of readdirSync(join(packagesDir, entry.name), { withFileTypes: true })) {
      const nested = join(packagesDir, entry.name, child.name);
      if (child.isDirectory() && existsSync(join(nested, 'package.json')) && existsSync(join(nested, 'src'))) {
        roots.push(`packages/${entry.name}/${child.name}/src`);
      }
    }
  }
  return roots.sort();
}

function readDebtFiles(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): string[] {
  const parsed = JSON.parse(readFileSync(DEBT_FILE, 'utf8')) as { files?: unknown };
  if (!Array.isArray(parsed.files) || parsed.files.some((file) => typeof file !== 'string')) {
    throw new Error(`${DEBT_FILE_LABEL} must hold { "files": string[] }; found ${JSON.stringify(parsed.files)}`);
  }
  return parsed.files as string[];
}

/** Runs dependency-cruiser and returns its cycle rows. Its exit code is the number of rows, so a
 *  non-zero exit is expected; only a missing or unreadable report is an error. */
function cruiseCycles(required: { repoRoot: string; roots: readonly string[] }, _optional: Record<string, never> = {}): CycleReport[] {
  if (!existsSync(DEPCRUISE_BIN)) throw new Error(`dependency-cruiser is not installed at ${DEPCRUISE_BIN}; run \`pnpm install\` at the repo root, then run the guard again.`);
  const run = spawnSync(process.execPath, [DEPCRUISE_BIN, '--config', CONFIG_FILE, '--output-type', 'json', ...required.roots], {
    cwd: required.repoRoot, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
  });
  const detail = `exit ${run.status ?? `signal ${run.signal}`}; stderr: ${(run.stderr ?? '').trim().slice(0, 2000) || '(empty)'}`;
  if (run.error) throw new Error(`Could not start dependency-cruiser for the runtime-cycle check: ${run.error.message}. ${detail}`);
  let report: { summary?: { violations?: Array<{ type?: string; from: string; cycle?: Array<{ name: string }> }> } };
  try {
    report = JSON.parse(run.stdout);
  } catch (error) {
    throw new Error(`dependency-cruiser printed no readable JSON report for the runtime-cycle check (${(error as Error).message}). ${detail}`);
  }
  if (!report.summary?.violations) throw new Error(`dependency-cruiser's report has no summary.violations list. ${detail}`);
  return report.summary.violations
    .filter((violation) => violation.type === 'cycle')
    .map((violation) => ({ from: violation.from, cycle: violation.cycle ?? [] }));
}

/** One row per cycle (dependency-cruiser reports the same cycle once per entry point it walked from). */
function distinctCycles(required: { reports: readonly CycleReport[] }, _optional: Record<string, never> = {}): string[][] {
  const byMembers = new Map<string, string[]>();
  for (const report of required.reports) {
    const path = [report.from, ...report.cycle.map((step) => step.name).filter((name) => name !== report.from)];
    const key = [...new Set(path)].sort().join('\n');
    if (!byMembers.has(key)) byMembers.set(key, path);
  }
  return [...byMembers.values()];
}

/**
 * Reports every runtime module cycle that involves a file outside the debt list, and every debt
 * entry that is no longer needed.
 * @throws When dependency-cruiser cannot run or prints no report, or the debt file is malformed.
 */
export function checkRuntimeCycles(required: { repoRoot: string }, optional: CheckRuntimeCyclesOptions = {}): Violation[] {
  const roots = optional.roots ?? packageSourceRoots({ repoRoot: required.repoRoot });
  const debt = new Set(optional.debtFiles ?? readDebtFiles());
  const cycles = distinctCycles({ reports: cruiseCycles({ repoRoot: required.repoRoot, roots }) });
  const violations: Violation[] = [];
  for (const path of cycles) {
    const outsideDebt = path.filter((file) => !debt.has(file));
    if (outsideDebt.length === 0) continue;
    violations.push({
      rule: RULE,
      file: outsideDebt[0]!,
      reason: `runtime import cycle: ${[...path, path[0]!].join(' -> ')}. Move what these files share into a leaf file that imports none of them, or turn a type import into a statement-level \`import type\` (an inline \`import { type X }\` still loads the module under verbatimModuleSyntax).`,
    });
  }
  const inSomeCycle = new Set(cycles.flat());
  for (const file of [...debt].sort()) {
    if (!inSomeCycle.has(file)) {
      violations.push({ rule: RULE, file, reason: `listed in ${DEBT_FILE_LABEL} but no longer in a runtime import cycle; delete the entry so the list only shrinks.` });
    }
  }
  return violations;
}
