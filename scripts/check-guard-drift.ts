/**
 * @module check-guard-drift
 *
 * CI-facing ratchet over `guard.ts`'s own checks (`pnpm guard:drift`, run via `.github/workflows/ci.yml`).
 * `pnpm guard` itself is strict: any violation fails it, which is the right behavior for a developer
 * running it locally against a codebase they expect to be clean. But CI adoption started 2026-08-16
 * with 25 pre-existing violations already accumulated (see `scripts/guard-baseline.json`'s own
 * `_comment` for the full reasoning) — wiring `pnpm guard` straight into CI on day one would have
 * shipped a gate that is red from its first run, which the audit that triggered this specifically
 * warned gets ignored or disabled within days.
 *
 * This script runs the exact same checks `guard.ts` does, then diffs the result against the
 * checked-in baseline as a MULTISET, not a set: `packages/chat/.../types.ts` genuinely has two
 * separate `R2-deep-path` violations today (two different import statements), and a naive
 * presence-only diff would treat a third one appearing later as "already known" just because the
 * key existed once. `newViolationCount` for any (rule, file, reason) key is
 * `max(0, currentCount - baselineCount)` — exactly the count beyond what the baseline already
 * allows for that exact key, both directions (new violations reported as failures; baseline entries
 * no longer reproducing reported, not failed, as a nudge to delete them and let the baseline shrink).
 *
 * Deliberately reuses `runGuardSelfTest` unconditionally ahead of the diff, exactly like `guard.ts`'s
 * own `main()`, and never lets a baseline exempt a self-test failure: a check silently regressing to
 * a no-op is precisely the failure mode `guard.ts`'s header describes as a real past incident (it
 * printed "ok" unconditionally for weeks — see that file's STATUS note), and a violation-count
 * ratchet cannot catch it on its own, since a check that stops finding anything looks identical to
 * "the debt got fixed."
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkAgenticDomPurity } from './check-agentic-dom-purity.js';
import { checkChatPanePublicSurface } from './check-chatpane-public-surface.js';
import { checkDriverIsolation } from './check-driver-isolation.js';
import { checkEngineBoundaries, type Violation } from './check-engine-boundaries.js';
import { checkExtensionlessImports } from './check-extensionless-imports.js';
import { checkProtocolPurity } from './check-protocol-purity.js';
import { runGuardSelfTest } from './lib/self-test.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface GuardBaselineFile {
  readonly _comment: string;
  readonly violations: readonly Violation[];
}

/** Stable identity for a violation, independent of check ordering. `|`-joined rather than a
 * template string with visible separators: a `reason` string legitimately contains colons, dashes,
 * and quotes (see the deep-path reasons), so any human-readable separator risks two distinct
 * violations colliding onto the same key. */
export function violationKey(violation: Violation): string {
  return `${violation.rule}|${violation.file}|${violation.reason}`;
}

function countByKey(violations: readonly Violation[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const violation of violations) {
    const key = violationKey(violation);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export interface GuardDriftResult {
  /** Present in `current` beyond what `baseline` allows for that exact (rule, file, reason) — a
   * real new violation, or an existing one that got MORE numerous. */
  readonly added: readonly Violation[];
  /** Present in `baseline` beyond what `current` still has — a violation that was fixed (or whose
   * count went down); a prompt to delete the now-stale entry from the baseline file. */
  readonly removed: readonly Violation[];
}

/**
 * Multiset diff between `baseline` and `current`. Symmetric in structure (each direction walks its
 * own list against the other's per-key counts) but asymmetric in meaning: `added` is what CI fails
 * on, `removed` is what CI merely reports.
 */
export function diffAgainstBaseline(baseline: readonly Violation[], current: readonly Violation[]): GuardDriftResult {
  const baselineCounts = countByKey(baseline);
  const currentCounts = countByKey(current);

  const added: Violation[] = [];
  const consumedFromBaseline = new Map<string, number>();
  for (const violation of current) {
    const key = violationKey(violation);
    const allowed = baselineCounts.get(key) ?? 0;
    const consumed = consumedFromBaseline.get(key) ?? 0;
    if (consumed >= allowed) {
      added.push(violation);
    } else {
      consumedFromBaseline.set(key, consumed + 1);
    }
  }

  const removed: Violation[] = [];
  const consumedFromCurrent = new Map<string, number>();
  for (const violation of baseline) {
    const key = violationKey(violation);
    const stillPresent = currentCounts.get(key) ?? 0;
    const consumed = consumedFromCurrent.get(key) ?? 0;
    if (consumed >= stillPresent) {
      removed.push(violation);
    } else {
      consumedFromCurrent.set(key, consumed + 1);
    }
  }

  return { added, removed };
}

async function main(): Promise<void> {
  const selfTestFailures = await runGuardSelfTest();
  if (selfTestFailures.length) {
    console.error('[guard:drift] SELF-TEST FAILED — refusing to trust the checks against the real repo.');
    for (const failure of selfTestFailures) {
      console.error(`[guard:drift] self-test: ${failure.expectation}`);
    }
    console.error(
      '\nA guard check no longer detects a known-bad fixture. No baseline can exempt this — see' +
        ' scripts/lib/self-test.ts and guard.ts\'s own header before touching any check-*.ts module.',
    );
    process.exit(1);
  }

  const results = [
    await checkEngineBoundaries(),
    await checkProtocolPurity(),
    await checkAgenticDomPurity(),
    await checkChatPanePublicSurface(),
    await checkExtensionlessImports(),
    await checkDriverIsolation(),
  ];
  const current = results.flat();

  const baselinePath = path.join(__dirname, 'guard-baseline.json');
  const baselineFile = JSON.parse(readFileSync(baselinePath, 'utf8')) as GuardBaselineFile;
  const { added, removed } = diffAgainstBaseline(baselineFile.violations, current);

  if (removed.length > 0) {
    console.log(
      `[guard:drift] ${removed.length} baseline entr${removed.length === 1 ? 'y' : 'ies'} in scripts/guard-baseline.json no longer reproduce(s) — delete to let the baseline shrink:`,
    );
    for (const violation of removed) console.log(`  - [${violation.rule}] ${violation.file}: ${violation.reason}`);
  }

  if (added.length === 0) {
    console.log(
      `[guard:drift] ok — 0 new guard violations (${current.length} total, ${baselineFile.violations.length} in baseline).`,
    );
    return;
  }

  console.error(`[guard:drift] ${added.length} NEW guard violation(s), not covered by scripts/guard-baseline.json:`);
  for (const violation of added) console.error(`  - [${violation.rule}] ${violation.file}: ${violation.reason}`);
  console.error(
    '\nFix the violation, or — only if it is genuinely intentional — add it to scripts/guard-baseline.json with a justification in an update to that file\'s own _comment.',
  );
  process.exit(1);
}

// Guarded, unlike `guard.ts`'s own unconditional `main();`: that file is only ever run directly via
// `tsx`, but this one is also imported as a plain module — `check-guard-drift.test.ts` imports
// `diffAgainstBaseline`/`violationKey` to unit-test the diff logic in isolation. Without this guard,
// importing those two pure functions would also run the real checks against the real repo (slow) and
// risk a bare `process.exit(1)` killing the whole test process outright the moment a real violation
// ever appears, rather than failing one test with a normal assertion. Mirrors the same
// `import.meta.url === process.argv[1]` idiom `packages/cli/src/main.ts` already uses for the same
// reason.
const isMainModule = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  void main();
}
