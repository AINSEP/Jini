/**
 * @file Direct tests for `coverage-floors.ts`.
 *
 * The assertions that matter most here are the ones about files that are NOT in the lcov, because
 * that is the failure this module exists for: node's `--test-coverage-include` filters what was
 * loaded rather than forcing files in, so a file with no test leaves the denominator and the
 * percentage goes UP. A percentage-only floor cannot see that. Several tests below therefore check
 * that a HIGH percentage still fails when the scope quietly shrank.
 */
import { test } from "vitest";
import assert from "node:assert/strict";

import {
  evaluateDiskArea as evaluate, formatDiskArea as format, pct as percentage,
  isMeasurableSource as measurable, isInExcludedDir as excluded,
  parseNodeTestScript as parseScript, runnerSplitDrift as drift,
} from '../index.js';
import type { LcovCounters, CoverageArea, RunnerGlobs, DiskAreaResult } from '../index.js';
function evaluateArea(area: CoverageArea, onDisk: readonly string[], coverage: ReadonlyMap<string, LcovCounters>) { return evaluate({ area, onDisk, coverage }); }
function formatArea(result: DiskAreaResult, area: CoverageArea) { return format({ result, area }); }
function pct(hit: number, found: number) { return percentage({ hit, found }); }
function isMeasurableSource(file: string) { return measurable({ file }); }
function isInExcludedDir(file: string, excludeDirs: readonly string[] = []) { return excluded({ file, excludeDirs }); }
function parseNodeTestScript(script: string) { return parseScript({ script }); }
function runnerSplitDrift(passes: readonly RunnerGlobs[], scriptPasses: readonly RunnerGlobs[]) { return drift({ passes, scriptPasses }); }

const perfect = { lf: 100, lh: 100, brf: 10, brh: 10, fnf: 5, fnh: 5 };
const poor = { lf: 100, lh: 50, brf: 10, brh: 5, fnf: 5, fnh: 1 };

function cov(entries: [string, LcovCounters][]): Map<string, LcovCounters> {
  return new Map(entries);
}

test("pct treats zero-found as 100 — correct for a file with no branches", () => {
  assert.equal(pct(0, 0), 100);
  assert.equal(pct(1, 2), 50);
});

test("test files and .d.ts files are not production source", () => {
  assert.equal(isMeasurableSource("src/a.js"), true);
  assert.equal(isMeasurableSource("src/a.test.js"), false);
  assert.equal(isMeasurableSource("src/a.spec.ts"), false);
  assert.equal(isMeasurableSource("src/a.d.ts"), false);
  assert.equal(isMeasurableSource("src/renderer/electron-webview.d.ts"), false);
});

// --- excludeDirs: cutting an area by role, not by extension --------------------------------------

test("a path inside an excluded directory, at any depth, is excluded", () => {
  assert.equal(isInExcludedDir("src/renderer/App.hooks.ts", ["src/renderer"]), true);
  assert.equal(isInExcludedDir("src/renderer/deep/nested/x.ts", ["src/renderer"]), true);
  assert.equal(isInExcludedDir("src/contracts/project.ts", ["src/renderer", "src/contracts"]), true);
});

test("the excluded directory itself counts as excluded, so a walk can prune it", () => {
  assert.equal(isInExcludedDir("src/renderer", ["src/renderer"]), true);
});

test("a sibling that merely SHARES the prefix is not excluded — the match is on a directory boundary", () => {
  // A bare startsWith would put src/renderer-foo/ and src/renderer.js in the renderer role, and a
  // main-process file would silently leave the 96/90/90 area it belongs to.
  assert.equal(isInExcludedDir("src/renderer-foo/x.js", ["src/renderer"]), false);
  assert.equal(isInExcludedDir("src/renderer.js", ["src/renderer"]), false);
  assert.equal(isInExcludedDir("src/rendererx/y.ts", ["src/renderer"]), false);
});

test("the match is anchored at the start of the path, not anywhere inside it", () => {
  assert.equal(isInExcludedDir("src/speech/src/renderer/x.js", ["src/renderer"]), false);
});

test("a trailing slash in the configured directory changes nothing, including the boundary", () => {
  assert.equal(isInExcludedDir("src/renderer/x.ts", ["src/renderer/"]), true);
  assert.equal(isInExcludedDir("src/renderer", ["src/renderer/"]), true);
  assert.equal(isInExcludedDir("src/renderer-foo/x.ts", ["src/renderer/"]), false);
});

test("no excludeDirs — absent or empty — excludes nothing", () => {
  assert.equal(isInExcludedDir("src/renderer/x.ts", []), false);
  assert.equal(isInExcludedDir("src/renderer/x.ts", undefined), false);
});

// --- the core trap: percentages cannot see their own scope shrinking ---------------------------

test("a file on disk with NO coverage record fails the area, even at 100% on what was measured", () => {
  const area = { id: "js", floors: { line: 90 } };
  const result = evaluateArea(area, ["src/a.js", "src/b.js"], cov([["src/a.js", perfect]]));

  assert.equal(result.actual.line, 100, "the measured half really is at 100%");
  assert.ok(result.failures.length > 0, "and the area must STILL fail");
  assert.deepEqual(result.newlyUnmeasured, ["src/b.js"]);
  assert.match(result.failures[0]!, /NO coverage record/);
  assert.match(result.failures[0]!, /src\/b\.js/, "the untested file must be named");
});

test("an explicitly grandfathered gap does NOT fail — debt is allowed when it is declared", () => {
  const area = { id: "ts", floors: { line: 90 }, knownUnmeasured: ["src/b.ts"] };
  const result = evaluateArea(area, ["src/a.ts", "src/b.ts"], cov([["src/a.ts", perfect]]));

  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.unmeasured, ["src/b.ts"], "but it is still reported");
});

test("a THIRD unmeasured file fails even when two are grandfathered — the list cannot grow", () => {
  const known = ["src/1.ts", "src/2.ts"];
  const area = { id: "ts", knownUnmeasured: known };
  const result = evaluateArea(area, [...known, "src/3.ts", "src/a.ts"], cov([["src/a.ts", perfect]]));

  assert.deepEqual(result.newlyUnmeasured, ["src/3.ts"]);
  assert.ok(result.failures.some((f) => /src\/3\.ts/.test(f)));
});

test("the grandfather list is an ENUMERATION, not a count — nine DIFFERENT files still fail", () => {
  // The ratchet must not be satisfiable by keeping the same NUMBER of gaps. If it were a count or a
  // percentage, "9 files unmeasured" could quietly become nine different files while the gate stayed
  // green — a scope that silently widened without ever growing.
  const area = { id: "ts", knownUnmeasured: ["src/old-a.ts", "src/old-b.ts"] };
  const onDisk = ["src/new-a.ts", "src/new-b.ts", "src/covered.ts"];
  const result = evaluateArea(area, onDisk, cov([["src/covered.ts", perfect]]));

  assert.equal(result.unmeasured.length, 2, "the COUNT of gaps is unchanged");
  assert.deepEqual(
    result.newlyUnmeasured,
    ["src/new-a.ts", "src/new-b.ts"],
    "but both are different files, and both must fail"
  );
  assert.ok(result.failures.some((f) => /src\/new-a\.ts/.test(f)));
});

test("swapping ONE grandfathered file for another fails, even at an identical count", () => {
  const area = { id: "ts", knownUnmeasured: ["src/a.ts", "src/b.ts"] };
  const result = evaluateArea(area, ["src/a.ts", "src/c.ts"], cov([]));

  assert.equal(result.unmeasured.length, 2);
  assert.deepEqual(result.newlyUnmeasured, ["src/c.ts"], "the substituted file is caught by name");
  assert.ok(result.failures.length > 0);
});

test("a grandfathered file that regained coverage is flagged so the list shrinks", () => {
  const area = { id: "ts", knownUnmeasured: ["src/b.ts"] };
  const result = evaluateArea(area, ["src/b.ts"], cov([["src/b.ts", perfect]]));

  assert.deepEqual(result.recovered, ["src/b.ts"]);
  assert.deepEqual(result.failures, [], "recovering is not itself a failure, only a prompt");
});

test("an area whose directory vanished fails instead of reading as a clean 100%", () => {
  // pct()'s zero-found-is-100 convention would otherwise report perfect scores on an empty area —
  // the exact shape of a gate that has silently stopped gating.
  const area = { id: "bin", floors: { line: 85, branch: 80, funcs: 62 }, minFilesOnDisk: 2 };
  const result = evaluateArea(area, [], cov([]));

  assert.equal(result.actual.line, 100, "the percentages really do read 100");
  assert.ok(result.failures.some((f) => /expected at least 2/.test(f)));
  assert.ok(result.failures.some((f) => /NOT a pass/.test(f)));
});

test("a partial disappearance fails too, not only a total one", () => {
  const area = { id: "js", minFilesOnDisk: 24 };
  const result = evaluateArea(area, ["src/a.js", "src/b.js"], cov([["src/a.js", perfect], ["src/b.js", perfect]]));
  assert.ok(result.failures.some((f) => /only 2 file\(s\) found on disk, expected at least 24/.test(f)));
});

// --- ordinary floor behaviour -------------------------------------------------------------------

test("an area below its line floor fails and names the axis", () => {
  const area = { id: "js", floors: { line: 90, branch: 90, funcs: 90 } };
  const result = evaluateArea(area, ["src/a.js"], cov([["src/a.js", poor]]));

  assert.ok(result.failures.some((f) => /line 50\.00% < floor 90%/.test(f)));
  assert.ok(result.failures.some((f) => /branch 50\.00% < floor 90%/.test(f)));
  assert.ok(result.failures.some((f) => /funcs 20\.00% < floor 90%/.test(f)));
});

test("an axis with NO configured floor is never a failure", () => {
  const area = { id: "ts", floors: { line: 40, branch: 40 } };
  const result = evaluateArea(area, ["src/a.ts"], cov([["src/a.ts", poor]]));

  assert.deepEqual(result.failures, [], "funcs at 20% must not fail when no funcs floor is set");
  assert.equal(result.actual.funcs, 20);
});

test("an area at exactly its floor passes", () => {
  const area = { id: "js", floors: { line: 50 } };
  const result = evaluateArea(area, ["src/a.js"], cov([["src/a.js", poor]]));
  assert.deepEqual(result.failures, []);
});

// --- output ------------------------------------------------------------------------------------

test("the rendered area names every unmeasured file, every run", () => {
  const area = { id: "ts", floors: { line: 70 }, knownUnmeasured: ["src/b.ts", "src/c.ts"] };
  const result = evaluateArea(area, ["src/a.ts", "src/b.ts", "src/c.ts"], cov([["src/a.ts", perfect]]));
  const text = formatArea(result, area);

  assert.match(text, /OK {2}\s+ts/);
  assert.match(text, /UNMEASURED \(2, known gap/);
  assert.match(text, /- src\/b\.ts/);
  assert.match(text, /- src\/c\.ts/);
  assert.match(text, /1 measured of 3 on disk/, "the disk denominator must be visible");
});

test("an axis with no floor is rendered as such rather than as a silent pass", () => {
  const area = { id: "ts", floors: { line: 70 } };
  const text = formatArea(evaluateArea(area, ["src/a.ts"], cov([["src/a.ts", perfect]])), area);
  assert.match(text, /funcs.*no floor/);
});

// --- runner split: package.json's test script and TEST_PASSES must agree -------------------------

const SCRIPT = 'node --test "src/**/*.test.js" "src/*.test.ts" && node --import tsx --test "src/renderer/**/*.test.ts"';
const AGREEING_PASSES = [
  { id: "node", nodeArgs: [], globs: ["src/*.test.ts", "src/**/*.test.js"] },
  { id: "tsx", nodeArgs: ["--import", "tsx"], globs: ["src/renderer/**/*.test.ts"] },
];

test("a chained node --test script parses into one pass per command, quotes stripped", () => {
  assert.deepEqual(parseNodeTestScript(SCRIPT), [
    { nodeArgs: [], globs: ["src/**/*.test.js", "src/*.test.ts"] },
    { nodeArgs: ["--import", "tsx"], globs: ["src/renderer/**/*.test.ts"] },
  ]);
});

test("the same globs under the same runners report no drift, whatever the glob order", () => {
  assert.deepEqual(runnerSplitDrift(AGREEING_PASSES, parseNodeTestScript(SCRIPT)), []);
});

test("a glob moved from bare node to tsx is drift on both runners, by name", () => {
  // The deliberately mismatched copy. It holds the same globs overall, so a comparison of all globs
  // regardless of runner would pass it.
  const moved = [
    { id: "node", nodeArgs: [], globs: ["src/**/*.test.js"] },
    { id: "tsx", nodeArgs: ["--import", "tsx"], globs: ["src/renderer/**/*.test.ts", "src/*.test.ts"] },
  ];
  assert.deepEqual(runnerSplitDrift(moved, parseNodeTestScript(SCRIPT)), [
    'package.json runs src/*.test.ts under "node"; TEST_PASSES does not',
    'TEST_PASSES runs src/*.test.ts under "node --import tsx"; package.json does not',
  ]);
});

test("a glob only one side runs is drift, whichever side it is on", () => {
  // Two passes on one runner must merge, not replace each other: a replaced set would also report
  // src/renderer/**/*.test.ts here.
  const extra = [...AGREEING_PASSES, { id: "tsx2", nodeArgs: ["--import", "tsx"], globs: ["src/contracts/**/*.test.ts"] }];
  assert.deepEqual(runnerSplitDrift(extra, parseNodeTestScript(SCRIPT)), [
    'TEST_PASSES runs src/contracts/**/*.test.ts under "node --import tsx"; package.json does not',
  ]);
  assert.deepEqual(runnerSplitDrift([AGREEING_PASSES[0]!], parseNodeTestScript(SCRIPT)), [
    'package.json runs src/renderer/**/*.test.ts under "node --import tsx"; TEST_PASSES does not',
  ]);
});

test("a command the guard cannot read throws instead of comparing as zero globs", () => {
  assert.throws(() => parseNodeTestScript('node --test "src/**/*.test.js" && vitest run'), {
    message: 'not a "node [args] --test <globs>" command: vitest run',
  });
  assert.throws(() => parseNodeTestScript("node src/main.js"), {
    message: 'not a "node [args] --test <globs>" command: node src/main.js',
  });
});
