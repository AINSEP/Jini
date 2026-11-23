/**
 * @file Direct tests for `complexity-debt.ts`.
 *
 * The two groups that matter most are the ones about results that LOOK clean:
 *
 *  - a scan that matched nothing reports zero violations, exactly like a genuinely clean scan
 *    (this repo has four complexity scopes that silently match nothing after a restructure);
 *  - ESLint exits 2 with empty stdout when a config crashes, and a caller testing `status !== 1`
 *    reads that as a pass (the admin ratchet's --rule technique does exactly this on desktop globs).
 *
 * Both are "the gate reported success while measuring nothing", which is the failure this whole
 * harness exists to make impossible.
 */
import { test } from "vitest";
import assert from "node:assert/strict";

import { evaluateRun, diffAgainstBaseline, violationKey, rejectUnusableEslintRun } from "../complexity-debt.js";
import type { ComplexityViolation, EslintFileResult, EslintMessage } from "../complexity-debt.js";

const v = (rule: string, file: string, reason: string): ComplexityViolation => ({ rule, file, reason });
const CYC = "complexity";
const COG = "sonarjs/cognitive-complexity";

function eslintResult(filePath: string, messages: EslintMessage[] = []): EslintFileResult {
  return { filePath, messages };
}

// --- the diff is a multiset, keyed per violation ------------------------------------------------

test("identity is (rule, file, message) and excludes the line number", () => {
  const a = violationKey(v(CYC, "a.ts", "Function 'f' has a complexity of 10. Maximum allowed is 9."));
  const b = violationKey(v(CYC, "a.ts", "Function 'f' has a complexity of 10. Maximum allowed is 9."));
  assert.equal(a, b, "the same violation at a different line is the same violation");
  assert.notEqual(a, violationKey(v(COG, "a.ts", "Function 'f' has a complexity of 10. Maximum allowed is 9.")));
});

test("two identical messages in one file are TWO violations, not one", () => {
  const one = [v(CYC, "a.ts", "same")];
  const two = [v(CYC, "a.ts", "same"), v(CYC, "a.ts", "same")];
  assert.equal(diffAgainstBaseline({ baseline: one, current: two }).added.length, 1, "the second occurrence is new debt");
  assert.equal(diffAgainstBaseline({ baseline: two, current: one }).removed.length, 1, "and fixing one of them registers");
});

test("a violation in the baseline that no longer reproduces is reported as removed, not as a failure", () => {
  const { added, removed } = diffAgainstBaseline({ baseline: [v(CYC, "a.ts", "gone")], current: [] });
  assert.deepEqual(added, []);
  assert.equal(removed.length, 1);
});

// --- evaluateRun --------------------------------------------------------------------------------

test("a run matching the baseline exactly passes", () => {
  const baseline = [v(CYC, "/a.ts", "msg")];
  const results = [eslintResult("/a.ts", [{ ruleId: CYC, message: "msg" }]), eslintResult("/b.ts", [])];
  const out = evaluateRun({ results, baseline, minFilesLinted: 2 });
  assert.deepEqual(out.failures, []);
  assert.equal(out.current.length, 1);
});

test("a NEW violation fails the run", () => {
  const results = [eslintResult("/a.ts", [{ ruleId: CYC, message: "new one" }]), eslintResult("/b.ts", [])];
  const out = evaluateRun({ results, baseline: [], minFilesLinted: 2 });
  assert.equal(out.added.length, 1);
  assert.ok(out.failures.some((f) => /1 NEW complexity violation/.test(f)));
});

test("non-complexity rules are ignored entirely", () => {
  const results = [eslintResult("/a.ts", [{ ruleId: "sonarjs/todo-tag", message: "x" }]), eslintResult("/b.ts", [])];
  assert.deepEqual(evaluateRun({ results, baseline: [], minFilesLinted: 2 }).current, []);
});

// --- non-vacuity: a shrinking scan must not read as clean ---------------------------------------

test("a scan smaller than the expected minimum FAILS even with zero violations", () => {
  const out = evaluateRun({ results: [eslintResult("/a.ts", [])], baseline: [], minFilesLinted: 93 });
  assert.equal(out.current.length, 0, "the result really is 'no violations'");
  assert.ok(out.failures.some((f) => /only 1 file\(s\) were linted, expected at least 93/.test(f)));
  assert.ok(out.failures.some((f) => /NOT a clean result/.test(f)));
});

test("an EMPTY scan fails rather than reporting a perfect score", () => {
  const out = evaluateRun({ results: [], baseline: [], minFilesLinted: 93 });
  assert.ok(out.failures.length > 0);
});

// --- trap 7: exit 2 is a crash, not a finding ---------------------------------------------------

test("exit 0 with a real report is usable", () => {
  assert.equal(rejectUnusableEslintRun({ status: 0, stdout: '[{"filePath":"/a.ts","messages":[]}]' }), null);
});

test("exit 1 with a real report is usable — ESLint exits 1 when it merely finds problems", () => {
  assert.equal(rejectUnusableEslintRun({ status: 1, stdout: '[{"filePath":"/a.ts","messages":[]}]' }), null);
});

test("exit 2 is rejected as a CRASH even if stdout somehow parses", () => {
  const reason = rejectUnusableEslintRun({ status: 2, stdout: '[{"filePath":"/a.ts","messages":[]}]' });
  assert.match(reason!, /exited 2/);
  assert.match(reason!, /CRASH, not a finding/);
});

test("empty stdout is rejected — an empty report is not an empty result", () => {
  assert.match(rejectUnusableEslintRun({ status: 2, stdout: "" })!, /exited 2/);
  assert.match(rejectUnusableEslintRun({ status: 1, stdout: "" })!, /no output at all/);
  assert.match(rejectUnusableEslintRun({ status: 1, stdout: "   " })!, /no output at all/);
});

test("a missing stdout (spawnSync's null when the pipe never opened) is rejected as no output, not crashed on", () => {
  assert.match(rejectUnusableEslintRun({ status: 0, stdout: null })!, /no output at all/);
  assert.match(rejectUnusableEslintRun({ status: 1, stdout: undefined })!, /no output at all/);
});

test("non-JSON stdout is rejected rather than throwing", () => {
  assert.match(rejectUnusableEslintRun({ status: 1, stdout: "Oops! Something went wrong!" })!, /not JSON/);
});

test("a zero-file report is rejected — matching nothing is not finding nothing", () => {
  const reason = rejectUnusableEslintRun({ status: 0, stdout: "[]" });
  assert.match(reason!, /zero files/);
  assert.match(reason!, /not the same as finding nothing/);
});

test("a null status (killed by signal) is rejected", () => {
  assert.match(rejectUnusableEslintRun({ status: null, stdout: "[]" })!, /CRASH/);
});
