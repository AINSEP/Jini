import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "vitest";

import {
  applyBaseline as apply, checkCoverageIntegrity as checkIntegrity, classifyBlock as classify,
  isPureReExportBarrelSource as pureBarrel, parseArgs as parse, parseBaseline as baseline,
  parseLcovBlocks as blocks, serializeBaseline as serialize,
} from '../index.js';
import type { BlockVerdict, LcovBlock } from '../index.js';
const fixtureRoot = '/fixture';
const fixtureClassifier = ({ file }: { file: string }): boolean => /^(src\/|packages\/[^/]+\/src\/|apps\/[^/]+\/src\/|services\/[^/]+\/src\/)/.test(file);
function isFirstPartySourcePath(file: string) { return fixtureClassifier({ file }); }
function applyBaseline(contaminated: readonly BlockVerdict[], baselineSet: ReadonlySet<string>) { return apply({ contaminated, baselineSet }); }
function checkCoverageIntegrity(lcovText: string, readSource?: (file: string) => string | undefined) {
  return checkIntegrity({ lcovText, repoRoot: fixtureRoot, isFirstParty: fixtureClassifier }, { readSource: readSource ? ({ file }) => readSource(file) : undefined });
}
function classifyBlock(block: LcovBlock, sourceText?: string) { return classify({ block, repoRoot: fixtureRoot, isFirstParty: fixtureClassifier }, { sourceText }); }
function isPureReExportBarrelSource(sourceText: string) { return pureBarrel({ sourceText }); }
function parseArgs(argv: readonly string[]) { return parse({ argv }); }
function parseBaseline(baselineJson: string) { return baseline({ baselineJson }); }
function parseLcovBlocks(lcovText: string) { return blocks({ lcovText }); }
function serializeBaseline(paths: readonly string[], comment?: readonly string[]) { return serialize({ paths }, { comment }); }
const sourceSnapshots: Record<string, string> = {
  "services/web/src/platform/export/index.ts": "export { createArchive } from \"./archive.js\";\nexport type {\n  ArchiveOptions,\n  ArchiveResult,\n} from \"./archive.js\";\n",
  "services/web/src/features/content-types/index.ts": "/** Public {types} contract. */\nexport { types } from \"@example/cms\";\nexport type { ContentType } from \"@example/cms\";\n",
  "services/web/src/platform/export/route-manifest.ts": "export function routeManifest() { return []; }\n"
};
function readSourceSnapshot(file: string): string {
  const source = sourceSnapshots[file];
  if (source === undefined) throw new Error(`missing source snapshot: ${file}`);
  return source;
}

/**
 * @file Direct coverage for `development/scripts/check-coverage-integrity.ts`.
 *
 * The real-data cases below are the REVISED acceptance criterion from the 2026-08-21 dispatch, after
 * the team lead's correction: all six real runs (`clean-run{1,2,4,5,6}-*` and `corrupt-run3-*`) show
 * CONTAMINATED for `src/media/provider-credential-store.ts` -- per
 * `ADS-memory/reports/2026-08-21-coverage-dual-instantiation-root-cause.md` (rounds 7/9 for the true
 * clean baseline `FNF:20 FNH:20`, rounds 8/11/12 for the counterexample proving `LH:`/`LF:` alone
 * cannot detect this), every one of those fixtures actually reports `FNF:43 FNH:29` -- contaminated,
 * not clean, regardless of what its `LH:`/`LF:` say. Only run 3 is additionally SEVERE (the wrapper
 * image also won the DA line-hit merge). The fixture file NAMES still say "clean-run1" etc. -- kept
 * as-is because they are literally the same bytes originally copied from the team lead's `run1.lcov`
 * (real, not invented) and renaming them would misrepresent provenance; their classification changed meaning, not the counters. Source paths in the two barrel fixtures
 * are normalized to the generic services/web fixture root; numeric evidence is preserved. `warn-run5-embeds-marker` is a second real, DIFFERENT
 * file from the same run5 -- CONTAMINATED but not SEVERE, a genuine partial-match case found by
 * scanning the full real lcov corpus, not invented.
 */

const FIXTURES_DIR = path.join(import.meta.dirname, "fixtures", "coverage-integrity");

function readFixture(name: string): string {
  return readFileSync(path.join(FIXTURES_DIR, name), "utf8");
}

// ---------------------------------------------------------------------------------------------
// Real-data acceptance criterion: all 6 runs report CONTAMINATED; run 3 additionally SEVERE.
// ---------------------------------------------------------------------------------------------

test("real fixture: run3's src/media/provider-credential-store.ts block is CONTAMINATED and SEVERE, with the exact expected reason", () => {
  const { contaminated, evaluated, skipped } = checkCoverageIntegrity(
    readFixture("corrupt-run3-provider-credential-store.lcov.info")
  );
  assert.equal(evaluated, 1);
  assert.equal(skipped, 0);
  assert.equal(contaminated.length, 1);
  assert.equal(contaminated[0]!.file, "src/media/provider-credential-store.ts");
  assert.equal(contaminated[0]!.severe, true);
  assert.equal(
    contaminated[0]!.reason,
    "3 esbuild CJS-wrapper helper record(s) [__copyProps, __export, __toCommonJS] present in this " +
      "block's FNDA records -- two coverage images (real ESM + CJS wrapper) were merged here. FNF:43 " +
      "FNH:29 function coverage for this run is untrustworthy. SEVERE: additionally, every one of " +
      "this block's 3 distinct DA hit-count value(s) [0, 32, 128] matches a wrapper helper's own " +
      "FNDA hit-count [32, 128] (or 0) -- the wrapper image also won the line-hit merge, so line " +
      "coverage for this run is untrustworthy too, regardless of what LH:/LF: report"
  );
});

for (const run of [1, 2, 4, 5, 6]) {
  test(`real fixture: run${run}'s src/media/provider-credential-store.ts block is CONTAMINATED but NOT severe (FNF:43 FNH:29 despite LH:357 LF:357 looking clean)`, () => {
    const { contaminated, evaluated, skipped } = checkCoverageIntegrity(
      readFixture(`clean-run${run}-provider-credential-store.lcov.info`)
    );
    assert.equal(evaluated, 1);
    assert.equal(skipped, 0);
    assert.equal(contaminated.length, 1);
    assert.equal(contaminated[0]!.file, "src/media/provider-credential-store.ts");
    assert.equal(contaminated[0]!.severe, false);
    assert.equal(
      contaminated[0]!.reason,
      "3 esbuild CJS-wrapper helper record(s) [__copyProps, __export, __toCommonJS] present in this " +
        "block's FNDA records -- two coverage images (real ESM + CJS wrapper) were merged here. FNF:43 " +
        "FNH:29 function coverage for this run is untrustworthy."
    );
  });
}

test("real fixture: run5's src/core/embeds/marker.ts block is CONTAMINATED but not severe -- a different, real partial-match file", () => {
  // `warn-run5-embeds-marker.lcov.info` is real, frozen historical lcov data (see this file's own
  // header comment: renaming/repointing these fixtures would misrepresent provenance), predating the
  // 2026-08-27 `src/contracts/` move (ba3a61b4) and the later services/web restructure. Its `SF:` line
  // still literally reads `src/core/embeds/marker.ts` -- ba3a61b4's mechanical import-rewrite swept
  // this ASSERTION STRING along with real import specifiers, even though it names a frozen fixture's
  // byte-for-byte content, not a live path. check-coverage-integrity.ts's `file` field is a verbatim
  // pass-through of the lcov `SF:` line (check-coverage-integrity.ts:342, `sfMatch[1].trim()` -- no
  // resolution against the real source tree), so this must match the fixture's own text, not today's
  // real file location.
  const { contaminated } = checkCoverageIntegrity(readFixture("warn-run5-embeds-marker.lcov.info"));
  assert.equal(contaminated.length, 1);
  assert.equal(contaminated[0]!.file, "src/core/embeds/marker.ts");
  assert.equal(contaminated[0]!.severe, false);
});

// ---------------------------------------------------------------------------------------------
// Non-first-party paths are skipped, not evaluated.
// ---------------------------------------------------------------------------------------------

test("classifyBlock: a node_modules path is skipped with the exact expected reason, regardless of content", () => {
  const block: LcovBlock = {
    file: "node_modules/esbuild/lib/main.js",
    fnda: [
      { name: "__export", hits: 128 },
      { name: "__copyProps", hits: 128 },
      { name: "__toCommonJS", hits: 32 },
    ],
    da: Array.from({ length: 100 }, () => 32),
  };
  const verdict = classifyBlock(block);
  assert.equal(verdict.status, "skip");
  assert.equal(verdict.severe, false);
  assert.equal(verdict.file, "node_modules/esbuild/lib/main.js");
  assert.equal(verdict.reason, "not a first-party source path");
});

test("classifyBlock: apps/admin/dist (build output, not apps/*/src/) is skipped -- the glob is src only", () => {
  const block: LcovBlock = { file: "apps/admin/dist/index.js", fnda: [], da: [] };
  assert.equal(classifyBlock(block).status, "skip");
});

test("isFirstPartySourcePath: true for src/**, packages/*/src/**, apps/*/src/**", () => {
  assert.equal(isFirstPartySourcePath("src/media/provider-credential-store.ts"), true);
  assert.equal(isFirstPartySourcePath("packages/jini-admin/src/index.ts"), true);
  assert.equal(isFirstPartySourcePath("apps/admin/src/main.tsx"), true);
});

test("isFirstPartySourcePath: false for node_modules, dist output, and development/ tooling", () => {
  assert.equal(isFirstPartySourcePath("node_modules/esbuild/lib/main.js"), false);
  assert.equal(isFirstPartySourcePath("apps/admin/dist/index.js"), false);
  assert.equal(isFirstPartySourcePath("development/scripts/check-architecture.ts"), false);
  assert.equal(isFirstPartySourcePath("packages/jini-admin/dist/index.js"), false);
});

// ---------------------------------------------------------------------------------------------
// CONTAMINATED has no size floor: wrapper-name presence alone is the whole signal, at any block
// size. Only the SEVERE escalation is floor-gated.
// ---------------------------------------------------------------------------------------------

test("classifyBlock: a tiny block with a wrapper FNDA record is CONTAMINATED even though it is far below the SEVERE floor", () => {
  const block: LcovBlock = {
    file: "src/tiny/reexport.ts",
    fnda: [{ name: "__toCommonJS", hits: 32 }],
    da: [32, 32, 32, 32, 32], // 5 DA records, well under MIN_DA_RECORDS_FOR_SEVERE_HEURISTIC
  };
  const verdict = classifyBlock(block);
  assert.equal(verdict.status, "contaminated");
  assert.equal(
    verdict.severe,
    false,
    "would satisfy the SEVERE full-subset condition if not for the floor -- must not escalate on 5 records"
  );
  assert.equal(
    verdict.reason,
    "1 esbuild CJS-wrapper helper record(s) [__toCommonJS] present in this block's FNDA records -- " +
      "two coverage images (real ESM + CJS wrapper) were merged here. function coverage for this run " +
      "is untrustworthy."
  );
});

test("classifyBlock: a block above the SEVERE floor with wrapper FNDA records but DA values unrelated to them is CONTAMINATED but not severe", () => {
  // Mirrors the real db/schema.sqlite.ts false-positive risk documented in check-coverage-integrity.ts's
  // header for the REJECTED bare-threshold design: wrapper helpers ARE present (as they are for a
  // majority of first-party files in this repo right now), but the file's own DA values (1..40,
  // cycling) share nothing with the wrapper's hit-counts (128, 500), so SEVERE must not fire.
  const block: LcovBlock = {
    file: "src/plain/healthy.ts",
    fnda: [
      { name: "__export", hits: 128 },
      { name: "__toCommonJS", hits: 500 },
    ],
    da: Array.from({ length: 200 }, (_, i) => (i % 40) + 1),
  };
  const verdict = classifyBlock(block);
  assert.equal(verdict.status, "contaminated");
  assert.equal(verdict.severe, false);
});

test("classifyBlock: an all-zero DA block above the floor with wrapper records present is CONTAMINATED but not severe (untested, not proof of a DA merge)", () => {
  const block: LcovBlock = {
    file: "src/tiny/untested.ts",
    fnda: [{ name: "__toCommonJS", hits: 32 }],
    da: Array.from({ length: 40 }, () => 0),
  };
  const verdict = classifyBlock(block);
  assert.equal(verdict.status, "contaminated");
  assert.equal(verdict.severe, false);
});

test("classifyBlock: a block with no wrapper FNDA records at all is OK, regardless of size or DA shape", () => {
  const block: LcovBlock = {
    file: "src/plain/no-wrapper.ts",
    fnda: [{ name: "someRealFunction", hits: 4 }],
    da: Array.from({ length: 40 }, (_, i) => i % 5),
  };
  const verdict = classifyBlock(block);
  assert.equal(verdict.status, "ok");
  assert.equal(verdict.severe, false);
  assert.equal(verdict.reason, "no esbuild CJS-wrapper FNDA records in this block");
});

// ---------------------------------------------------------------------------------------------
// Pure re-export barrels (2026-09-05): a file whose source is entirely `export ... from "...";`
// statements is `skip`, never `contaminated` or `ok` -- see this file's header ("Pure re-export
// barrels are also skipped") for why wrapper-name presence there is structurally guaranteed and
// carries no contamination signal. Real, not invented: both source files below and their fixture
// lcov blocks (`fixtures/coverage-integrity/real-*-barrel.lcov.info`) were captured 2026-09-05 from
// this repo's actual `services/web/src/platform/export/index.ts` and
// `services/web/src/features/content-types/index.ts`, and both were independently verified
// CONTAMINATED (the second one additionally SEVERE) by a live `check-coverage-integrity.ts` run
// against a real `npm run test:cov` lcov before this exclusion existed.
// ---------------------------------------------------------------------------------------------

test("isPureReExportBarrelSource: true for the generalized platform/export/index.ts barrel (mixed export/export-type-from, multi-line named list)", () => {
  assert.equal(isPureReExportBarrelSource(readSourceSnapshot("services/web/src/platform/export/index.ts")), true);
});

test("isPureReExportBarrelSource: true for the generalized features/content-types/index.ts barrel (re-exports from an npm package, JSDoc header with braces)", () => {
  assert.equal(isPureReExportBarrelSource(readSourceSnapshot("services/web/src/features/content-types/index.ts")), true);
});

test("isPureReExportBarrelSource: false for a generalized logic-bearing file in the same directory as a barrel", () => {
  // route-manifest.ts sits right next to index.ts in platform/export/ and is what the barrel
  // re-exports from -- it has real function bodies and must never be classified as a barrel itself.
  assert.equal(
    isPureReExportBarrelSource(readSourceSnapshot("services/web/src/platform/export/route-manifest.ts")),
    false
  );
});

test("isPureReExportBarrelSource: false for a partial barrel (a real declaration alongside a re-export)", () => {
  const partial = `export const VERSION = 1;\nexport { thing } from "./thing.js";\n`;
  assert.equal(isPureReExportBarrelSource(partial), false);
});

test("isPureReExportBarrelSource: false for an empty or comment-only file (nothing to export)", () => {
  assert.equal(isPureReExportBarrelSource(""), false);
  assert.equal(isPureReExportBarrelSource("/** just a file doc comment, no exports */\n"), false);
});

test("isPureReExportBarrelSource: true for export * and export * as ns forms", () => {
  assert.equal(isPureReExportBarrelSource(`export * from "./a.js";\nexport * as ns from "./b.js";\n`), true);
});

test("classifyBlock: the real platform/export/index.ts block is skip (not contaminated) once its source is supplied", () => {
  const [block] = parseLcovBlocks(readFixture("real-platform-export-barrel.lcov.info"));
  assert.ok(block);
  const withoutSource = classifyBlock(block);
  assert.equal(withoutSource.status, "contaminated", "sanity check: without the source, it reads as contaminated");

  const withSource = classifyBlock(block, readSourceSnapshot("services/web/src/platform/export/index.ts"));
  assert.equal(withSource.status, "skip");
  assert.equal(withSource.severe, false);
  assert.match(withSource.reason, /pure re-export barrel/);
});

test("classifyBlock: the real content-types/index.ts block would have been SEVERE, and is skip once its source is supplied", () => {
  const [block] = parseLcovBlocks(readFixture("real-content-types-barrel.lcov.info"));
  assert.ok(block);
  const withoutSource = classifyBlock(block);
  assert.equal(withoutSource.status, "contaminated");
  assert.equal(withoutSource.severe, true, "sanity check: this real block satisfies the SEVERE full-subset condition too");

  const withSource = classifyBlock(block, readSourceSnapshot("services/web/src/features/content-types/index.ts"));
  assert.equal(withSource.status, "skip");
});

test("checkCoverageIntegrity: with a readSource callback, the real barrel fixture reports 0 contaminated and counts it as skipped", () => {
  const lcov = readFixture("real-platform-export-barrel.lcov.info");
  const report = checkCoverageIntegrity(lcov, (file) => readSourceSnapshot(file));
  assert.deepEqual(report.contaminated, []);
  assert.equal(report.skipped, 1);
  assert.equal(report.evaluated, 0);
});

test("checkCoverageIntegrity: omitting readSource entirely leaves the same real fixture CONTAMINATED (backward compatible default)", () => {
  const lcov = readFixture("real-platform-export-barrel.lcov.info");
  const report = checkCoverageIntegrity(lcov);
  assert.equal(report.contaminated.length, 1);
  assert.equal(report.contaminated[0]!.file, "services/web/src/platform/export/index.ts");
});

test("checkCoverageIntegrity: a readSource that returns undefined (file not found) falls back to normal classification, never silently skipping", () => {
  const lcov = readFixture("real-platform-export-barrel.lcov.info");
  const report = checkCoverageIntegrity(lcov, () => undefined);
  assert.equal(report.contaminated.length, 1, "a missing source must never be treated as a barrel");
});

// ---------------------------------------------------------------------------------------------
// parseLcovBlocks: basic structural parsing, including the FNF:/FNH: summary fields.
// ---------------------------------------------------------------------------------------------

test("parseLcovBlocks: extracts SF path, FNDA name/hits pairs, DA hit-counts, and FNF/FNH from one block", () => {
  const lcov = [
    "SF:src/example.ts",
    "FN:1,foo",
    "FN:8,__export",
    "FNDA:5,foo",
    "FNDA:128,__export",
    "FNF:2",
    "FNH:2",
    "DA:1,5",
    "DA:2,5",
    "DA:8,128",
    "end_of_record",
    "",
  ].join("\n");
  const blocks = parseLcovBlocks(lcov);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]!.file, "src/example.ts");
  assert.deepEqual(blocks[0]!.fnda, [
    { name: "foo", hits: 5 },
    { name: "__export", hits: 128 },
  ]);
  assert.deepEqual(blocks[0]!.da, [5, 5, 128]);
  assert.equal(blocks[0]!.fnf, 2);
  assert.equal(blocks[0]!.fnh, 2);
});

test("parseLcovBlocks: fnf/fnh are undefined when the block omits FNF:/FNH: lines", () => {
  const lcov = ["SF:src/example.ts", "DA:1,5", "end_of_record", ""].join("\n");
  const blocks = parseLcovBlocks(lcov);
  assert.equal(blocks[0]!.fnf, undefined);
  assert.equal(blocks[0]!.fnh, undefined);
});

test("parseLcovBlocks: parses multiple SF blocks in one lcov file independently", () => {
  const lcov = ["SF:src/a.ts", "DA:1,1", "end_of_record", "SF:src/b.ts", "DA:1,2", "end_of_record", ""].join("\n");
  const blocks = parseLcovBlocks(lcov);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0]!.file, "src/a.ts");
  assert.equal(blocks[1]!.file, "src/b.ts");
});

test("parseLcovBlocks: text with no SF: line produces no block, rather than throwing", () => {
  assert.deepEqual(parseLcovBlocks("not an lcov file\njust text\n"), []);
});

// ---------------------------------------------------------------------------------------------
// checkCoverageIntegrity: aggregate counts.
// ---------------------------------------------------------------------------------------------

test("checkCoverageIntegrity: evaluated/skipped counts split first-party from non-first-party blocks", () => {
  const lcov = [
    "SF:src/a.ts",
    ...Array.from({ length: 40 }, (_, i) => `DA:${i + 1},${i % 5}`),
    "end_of_record",
    "SF:node_modules/lib/x.js",
    "DA:1,9",
    "end_of_record",
    "",
  ].join("\n");
  const report = checkCoverageIntegrity(lcov);
  assert.equal(report.evaluated, 1);
  assert.equal(report.skipped, 1);
  assert.deepEqual(report.contaminated, []);
});

test("checkCoverageIntegrity: contaminated[] includes both severe and non-severe blocks together", () => {
  const lcov = [
    "SF:src/a-severe.ts",
    "FNDA:32,__toCommonJS",
    ...Array.from({ length: 35 }, () => "DA:1,32"),
    "end_of_record",
    "SF:src/b-contaminated-only.ts",
    "FNDA:32,__toCommonJS",
    ...Array.from({ length: 35 }, (_, i) => `DA:${i + 1},${i}`),
    "end_of_record",
    "",
  ].join("\n");
  const report = checkCoverageIntegrity(lcov);
  assert.equal(report.contaminated.length, 2);
  const severeFiles = report.contaminated.filter((v) => v.severe).map((v) => v.file);
  const nonSevereFiles = report.contaminated.filter((v) => !v.severe).map((v) => v.file);
  assert.deepEqual(severeFiles, ["src/a-severe.ts"]);
  assert.deepEqual(nonSevereFiles, ["src/b-contaminated-only.ts"]);
});

// ---------------------------------------------------------------------------------------------
// The --baseline ratchet, per the team lead's second correction: CONTAMINATED alone must not fail
// every run forever (63/93 first-party blocks on today's tree, per the acceptance-criterion runs
// above -- a gate that always fails gets ignored). A known path is reported but does not fail; SEVERE
// always fails, baseline or not.
// ---------------------------------------------------------------------------------------------

function contaminatedVerdict(file: string, severe: boolean): BlockVerdict {
  return { file, status: "contaminated", severe, reason: `stub reason for ${file}` };
}

test("applyBaseline: a non-severe contaminated block whose path IS in the baseline does not fail", () => {
  const [gated] = applyBaseline([contaminatedVerdict("src/known.ts", false)], new Set(["src/known.ts"]));
  assert.ok(gated);
  assert.equal(gated.baselined, true);
  assert.equal(gated.fails, false);
});

test("applyBaseline: a non-severe contaminated block whose path is NOT in the baseline fails (new contamination)", () => {
  const [gated] = applyBaseline([contaminatedVerdict("src/new.ts", false)], new Set(["src/other.ts"]));
  assert.ok(gated);
  assert.equal(gated.baselined, false);
  assert.equal(gated.fails, true);
});

test("applyBaseline: a SEVERE block fails even when its path IS in the baseline -- no baseline escape", () => {
  const [gated] = applyBaseline([contaminatedVerdict("src/severe.ts", true)], new Set(["src/severe.ts"]));
  assert.ok(gated);
  assert.equal(gated.baselined, true, "membership fact is still recorded accurately");
  assert.equal(gated.fails, true, "but SEVERE always fails regardless of membership");
});

test("applyBaseline: an empty baseline set fails every contaminated (non-severe) block -- the no-flag default", () => {
  const gated = applyBaseline(
    [contaminatedVerdict("src/a.ts", false), contaminatedVerdict("src/b.ts", false)],
    new Set()
  );
  assert.deepEqual(
    gated.map((v) => v.fails),
    [true, true]
  );
});

test("real fixture acceptance criterion: baselining src/media/provider-credential-store.ts's path makes run1/2/4/5/6 pass and leaves run3 failing on SEVERE", () => {
  const baselineSet = new Set(["src/media/provider-credential-store.ts"]);
  for (const run of [1, 2, 4, 5, 6]) {
    const { contaminated } = checkCoverageIntegrity(readFixture(`clean-run${run}-provider-credential-store.lcov.info`));
    const gated = applyBaseline(contaminated, baselineSet);
    assert.deepEqual(
      gated.map((v) => v.fails),
      [false],
      `run${run} should be fully baselined away (non-severe, path known)`
    );
  }
  const { contaminated: run3Contaminated } = checkCoverageIntegrity(
    readFixture("corrupt-run3-provider-credential-store.lcov.info")
  );
  const run3Gated = applyBaseline(run3Contaminated, baselineSet);
  assert.deepEqual(run3Gated.map((v) => v.fails), [true], "run3 stays failing -- SEVERE is never baseline-suppressible");
});

test("parseBaseline: extracts the knownContaminated set from real baseline JSON shape", () => {
  const json = JSON.stringify({ _comment: ["some note"], knownContaminated: ["src/a.ts", "src/b.ts"] });
  const set = parseBaseline(json);
  assert.deepEqual([...set].sort(), ["src/a.ts", "src/b.ts"]);
});

test("parseBaseline: a missing knownContaminated field reads as an empty set, not a throw", () => {
  assert.deepEqual(parseBaseline(JSON.stringify({ _comment: ["x"] })), new Set());
});

test("serializeBaseline: dedupes and alphabetically sorts paths for a stable, reviewable diff", () => {
  const json = serializeBaseline(["src/z.ts", "src/a.ts", "src/a.ts", "src/m.ts"], ["note"]);
  const parsed = JSON.parse(json) as { _comment: string[]; knownContaminated: string[] };
  assert.deepEqual(parsed.knownContaminated, ["src/a.ts", "src/m.ts", "src/z.ts"]);
  assert.deepEqual(parsed._comment, ["note"]);
});

test("serializeBaseline: round-trips through parseBaseline", () => {
  const json = serializeBaseline(["src/b.ts", "src/a.ts"]);
  assert.deepEqual([...parseBaseline(json)].sort(), ["src/a.ts", "src/b.ts"]);
});

test("parseArgs: lcovArg, --baseline <path>, and --update-baseline all parsed together", () => {
  const parsed = parseArgs(["development/coverage/lcov.info", "--baseline", "development/scripts/x.json", "--update-baseline"]);
  assert.deepEqual(parsed, {
    lcovArg: "development/coverage/lcov.info",
    baselinePath: "development/scripts/x.json",
    updateBaseline: true,
  });
});

test("parseArgs: --baseline's value is not mistaken for the positional lcovArg", () => {
  const parsed = parseArgs(["--baseline", "development/scripts/x.json", "development/coverage/lcov.info"]);
  assert.equal(parsed.baselinePath, "development/scripts/x.json");
  assert.equal(parsed.lcovArg, "development/coverage/lcov.info");
});

test("parseArgs: no arguments at all yields all-undefined/false, not a throw", () => {
  assert.deepEqual(parseArgs([]), { lcovArg: undefined, baselinePath: undefined, updateBaseline: false });
});

test("parseArgs: a second positional argument is ignored, matching this repo's other check-*.ts scripts' permissive argv handling", () => {
  const parsed = parseArgs(["first.lcov", "second.lcov"]);
  assert.equal(parsed.lcovArg, "first.lcov");
});

test("real committed baseline: development/scripts/coverage-integrity-baseline.json is valid and baselines run1 (its own source) away entirely", () => {
  const baselineJson = readFileSync(
    path.join(import.meta.dirname, "fixtures", "baseline.json"),
    "utf8"
  );
  const baselineSet = parseBaseline(baselineJson);
  assert.ok(baselineSet.size > 0, "the committed baseline must not be empty");

  const { contaminated } = checkCoverageIntegrity(readFixture("clean-run1-provider-credential-store.lcov.info"));
  const gated = applyBaseline(contaminated, baselineSet);
  assert.deepEqual(
    gated.map((v) => v.fails),
    [false],
    "run1 is the baseline's own capture source -- every path it reports must already be known"
  );
});
