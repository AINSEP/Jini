/**
 * @file The drift rules for the host desktop app's complexity ceiling, as pure functions. The CLI that
 * runs ESLint and calls these is `scripts/check-complexity.ts`.
 *
 * Mirrors `development/scripts/check-admin-complexity-drift.ts`'s design, including the two choices
 * that file's own header argues for and which are worth restating because getting either wrong
 * makes the ratchet decorative:
 *
 * **Debt is keyed per VIOLATION, never per FILE.** ESLint's flat config has no function-level
 * scope, so a config-level relax can only ever exempt a whole file — and a per-file debt list lets
 * every OTHER function in a listed file drift unnoticed. `App.hooks.ts` is 1272 lines; exempting it
 * wholesale would create a complexity-free zone. So identity is (rule, file, message).
 *
 * **Identity deliberately excludes the line number.** Two functions in one file can produce the
 * identical message at different lines, and a line-keyed entry goes stale on every edit above it —
 * which turns the debt list into noise and trains people to regenerate it wholesale, which is the
 * same as not having one.
 *
 * ## What this file adds beyond the admin version
 *
 * A **non-vacuity check**. `main.ts` reports zero violations at a 9 ceiling, which is true — forcing
 * the threshold to 1 produces 34 findings on the same file, so the rule really is reaching it. But
 * "zero violations" and "the glob matched nothing" are indistinguishable from an exit code, and
 * this repo has already shipped four complexity scopes that silently matched nothing after a
 * restructure (`check-src-complexity-drift.ts` scans nine directories; four no longer exist, and
 * `--no-error-on-unmatched-pattern` turns that into silence). So {@link evaluateRun} requires a
 * minimum linted-file count and fails when the scan shrinks, no matter how clean the result looks.
 */

/** One complexity finding, as `complexity-debt.json` stores it. `reason` is ESLint's message. */
export interface ComplexityViolation {
  rule: string;
  file: string;
  reason: string;
}

/** The slice of one ESLint `-f json` message this file reads. `ruleId` is `null` for a parse error. */
export interface EslintMessage {
  ruleId: string | null;
  message: string;
}

/** The slice of one ESLint `-f json` file result this file reads. */
export interface EslintFileResult {
  filePath: string;
  messages: readonly EslintMessage[];
}

/** {@link diffAgainstBaseline}'s multiset difference. */
export interface BaselineDiff {
  added: ComplexityViolation[];
  removed: ComplexityViolation[];
}

/** {@link evaluateRun}'s verdict. `failures` empty means the gate passes. */
export interface ComplexityRunVerdict extends BaselineDiff {
  current: ComplexityViolation[];
  filesLinted: number;
  failures: string[];
}

/** Stable identity for one violation: `|`-joined because ESLint's own messages contain colons,
 *  quotes and periods, so any human-readable separator risks two distinct violations colliding.
 *  @complexity O(1). */
export function violationKey(violation: ComplexityViolation): string {
  return `${violation.rule}|${violation.file}|${violation.reason}`;
}

/** Counts violations by key, so the diff is a MULTISET diff — two identical messages in one file
 *  are two violations, and fixing one of them must register.
 *  @complexity O(n). */
function countByKey({ violations }: { violations: readonly ComplexityViolation[] }, _options = {}): Map<string, number> {
  const counts = new Map<string, number>();
  for (const v of violations) {
    const key = violationKey(v);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * Multiset difference between the grandfathered baseline and what ESLint reports now.
 *
 * @returns `{ added, removed }` — `added` fails the gate; `removed` is a prompt to shrink the list,
 *   never a failure (a fix must not be punished).
 * @complexity O(n) in violations.
 */
export function diffAgainstBaseline(
  { baseline, current }: { baseline: readonly ComplexityViolation[]; current: readonly ComplexityViolation[] },
  _options = {}
): BaselineDiff {
  const baseCounts = countByKey({ violations: baseline });
  const currentCounts = countByKey({ violations: current });
  const byKey = new Map([...baseline, ...current].map((v): [string, ComplexityViolation] => [violationKey(v), v]));

  const added: ComplexityViolation[] = [];
  const removed: ComplexityViolation[] = [];
  for (const [key, violation] of byKey) {
    const delta = (currentCounts.get(key) ?? 0) - (baseCounts.get(key) ?? 0);
    for (let i = 0; i < delta; i += 1) added.push(violation);
    for (let i = 0; i < -delta; i += 1) removed.push(violation);
  }
  return { added, removed };
}

/**
 * Turn one ESLint JSON run into a verdict.
 *
 * @param input.results ESLint's `-f json` output, already parsed.
 * @param input.baseline the grandfathered violations.
 * @param input.minFilesLinted the smallest plausible scan size; below this the run is not trusted.
 * @returns `{ current, added, removed, filesLinted, failures }`.
 * @complexity O(n) in results.
 */
export function evaluateRun(
  { results, baseline, minFilesLinted }: { results: readonly EslintFileResult[]; baseline: readonly ComplexityViolation[]; minFilesLinted: number },
  _options = {},
): ComplexityRunVerdict {
  const current: ComplexityViolation[] = [];
  for (const result of results) {
    for (const message of result.messages) {
      if (message.ruleId === "complexity" || message.ruleId === "sonarjs/cognitive-complexity") {
        current.push({ rule: message.ruleId, file: result.filePath, reason: message.message });
      }
    }
  }

  const { added, removed } = diffAgainstBaseline({ baseline, current });
  const failures: string[] = [];

  // A clean result and an empty scan look identical from the outside. This is the difference.
  if (results.length < minFilesLinted) {
    failures.push(
      `only ${results.length} file(s) were linted, expected at least ${minFilesLinted}. ` +
        `A shrinking scan reads as "no violations" — the glob is stale, or an ignore pattern is too ` +
        `broad. This is NOT a clean result.`
    );
  }
  if (added.length > 0) {
    failures.push(`${added.length} NEW complexity violation(s) not in the debt list.`);
  }
  return { current, added, removed, filesLinted: results.length, failures };
}

/**
 * Whether an ESLint child process produced a usable report.
 *
 * ESLint exits 1 when it merely FINDS problems — the expected case here — and 2 when it CRASHED,
 * with empty stdout. A caller testing `status !== 1` reads that crash as a pass. This repo has the
 * scar: the admin ratchet's `--rule` technique exits 2 on any desktop-app glob whose directory
 * contains a `.js` file, because no config block matching those files declared the sonarjs plugin.
 *
 * @returns `null` when usable, else the reason it is not.
 * @complexity O(1).
 */
export function rejectUnusableEslintRun({ status, stdout }: { status: number | null; stdout: string | null | undefined }, _options = {}): string | null {
  if (status !== 0 && status !== 1) {
    return `eslint exited ${status} — that is a CRASH, not a finding. Exit 0 and 1 are the only usable outcomes.`;
  }
  const trimmed = (stdout ?? "").trim();
  if (trimmed.length === 0) {
    return "eslint produced no output at all. An empty report is not an empty result.";
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    // `JSON.parse` of a string throws only `SyntaxError`.
    return `eslint output was not JSON (${(error as SyntaxError).message}).`;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return "eslint reported zero files. The scan matched nothing, which is not the same as finding nothing.";
  }
  return null;
}
