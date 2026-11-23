/**
 * @file Direct tests for `quality-gates.ts` — the policy that keeps a gate from going quiet.
 *
 * These assert the FOUR anti-silence properties named in that file's header, because each one
 * corresponds to a way this repo's existing harness actually rotted, not to a hypothetical:
 *
 *  1. every gate is printed, including disabled ones
 *  2. disabling requires a reason and a date
 *  3. a gate script on disk that nothing runs is a hard failure
 *  4. a disablement ages out and must be re-confirmed
 *
 * No spawning and no filesystem here — `check-gates.ts` owns those, and its own end-to-end
 * exit-code behaviour is covered by `check-gates-exit-code.test.ts`.
 */
import { test } from "vitest";
import assert from "node:assert/strict";

import { validateManifest, detectGateDrift, formatSummary, isFailure, daysBetween } from "../quality-gates.js";
import type { GateEntry, GateManifest } from "../quality-gates.js";

const TODAY = "2026-09-12";

function manifest(gates: GateEntry[], extra: GateManifest = {}): GateManifest {
  return { gates, ...extra };
}

// --- property 2: disabling requires paperwork ---------------------------------------------------

test("a manifest whose gates are all enabled has no problems", () => {
  const problems = validateManifest({ manifest: manifest([{ id: "tests", run: "npm test" }]), today: TODAY });
  assert.deepEqual(problems, []);
});

test("a disabled gate with a reason and a fresh date is accepted — turning a gate off is allowed", () => {
  const problems = validateManifest(
    { manifest: manifest([{ id: "coverage", run: "node scripts/check-coverage.ts", enabled: false, disabledReason: "baseline pending", disabledOn: "2026-09-10" }]), today: TODAY }
  );
  assert.deepEqual(problems, []);
});

test("a disabled gate with NO reason is a hard failure", () => {
  const problems = validateManifest(
    { manifest: manifest([{ id: "coverage", run: "x", enabled: false, disabledOn: "2026-09-10" }]), today: TODAY }
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0]!,/disabledReason/);
  assert.match(problems[0]!,/not silently/);
});

test("a disabled gate with NO date is a hard failure, and the age check does not also fire", () => {
  const problems = validateManifest(
    { manifest: manifest([{ id: "coverage", run: "x", enabled: false, disabledReason: "because" }]), today: TODAY }
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0]!,/disabledOn/);
});

test("an unparseable disabledOn is reported as such, not silently treated as fresh", () => {
  const problems = validateManifest(
    { manifest: manifest([{ id: "c", run: "x", enabled: false, disabledReason: "r", disabledOn: "last tuesday" }]), today: TODAY }
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0]!,/unparseable/);
  assert.match(problems[0]!,/YYYY-MM-DD/);
});

// --- property 4: the disablement ratchet --------------------------------------------------------

test("a gate disabled longer than the limit fails until the decision is re-confirmed", () => {
  const problems = validateManifest(
    { manifest: manifest([{ id: "c", run: "x", enabled: false, disabledReason: "r", disabledOn: "2026-01-01" }]), today: TODAY }
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0]!,/disabled 254 days/);
  assert.match(problems[0]!,/re-confirm/);
});

test("the disablement limit is configurable per manifest", () => {
  const gates = [{ id: "c", run: "x", enabled: false, disabledReason: "r", disabledOn: "2026-09-01" }];
  assert.deepEqual(validateManifest({ manifest: manifest(gates), today: TODAY }), [], "11 days is inside the default 30");
  const problems = validateManifest({ manifest: manifest(gates, { maxDisabledDays: 5 }), today: TODAY });
  assert.equal(problems.length, 1);
  assert.match(problems[0]!,/disabled 11 days/);
});

test("daysBetween is date-only, so a disablement recorded today reads as zero days", () => {
  assert.equal(daysBetween({ fromIso: "2026-09-12", toIso: "2026-09-12" }), 0);
  assert.equal(daysBetween({ fromIso: "2026-09-11", toIso: "2026-09-12" }), 1);
  assert.equal(daysBetween({ fromIso: "nonsense", toIso: "2026-09-12" }), null);
});

// --- manifest sanity: a harness that measures nothing must not pass ------------------------------

test("an empty gate list is a failure, not a vacuous pass", () => {
  const problems = validateManifest({ manifest: manifest([]), today: TODAY });
  assert.equal(problems.length, 1);
  assert.match(problems[0]!,/zero gates/);
  assert.match(problems[0]!,/measuring nothing/);
});

test("a manifest with no gates array at all is a failure", () => {
  assert.match(validateManifest({ manifest: {}, today: TODAY })[0]!, /no "gates" array/);
});

test("a gate missing id or run is reported", () => {
  const problems = validateManifest({ manifest: manifest([{ id: "no-run" }]), today: TODAY });
  assert.equal(problems.length, 1);
  assert.match(problems[0]!,/needs an "id" and a "run"/);
});

test("duplicate gate ids are reported — two entries silently collapsing to one is the failure mode", () => {
  const problems = validateManifest({ manifest: manifest([{ id: "a", run: "x" }, { id: "a", run: "y" }]), today: TODAY });
  assert.equal(problems.length, 1);
  assert.match(problems[0]!,/duplicate gate id "a"/);
});

test("a null gate entry throws a clear, index-naming error instead of an unhandled TypeError", () => {
  // `manifest.gates` is `unknown` straight out of JSON.parse — a `null` array element (valid JSON)
  // used to pass the old `gates as GateEntry[]` cast silently and then crash inside `gateProblems`
  // as an unclear "Cannot read properties of null (reading 'id')".
  assert.throws(
    () => validateManifest({ manifest: manifest([null as unknown as GateEntry]), today: TODAY }),
    /gates\[0\] must be an object/
  );
});

test("a non-object gate entry (e.g. a bare string) throws the same clear, index-naming error", () => {
  assert.throws(
    () => validateManifest({ manifest: manifest(["oops" as unknown as GateEntry]), today: TODAY }),
    /gates\[0\] must be an object/
  );
});

// --- property 3: manifest-vs-disk drift ---------------------------------------------------------

test("a gate script on disk that no manifest entry runs is detected", () => {
  const drift = detectGateDrift(
    { gates: [{ id: "coverage", run: "node scripts/check-coverage.ts" }], scriptNames: ["check-coverage.ts", "check-complexity.ts"] }
  );
  assert.deepEqual(drift, ["check-complexity.ts"], "the unwired script must be named");
});

test("a DISABLED gate still counts as registered — off is a decision, absent is not", () => {
  const drift = detectGateDrift(
    { gates: [{ id: "coverage", run: "node scripts/check-coverage.ts", enabled: false }], scriptNames: ["check-coverage.ts"] }
  );
  assert.deepEqual(drift, []);
});

test("a run command carrying flags still matches its script", () => {
  const drift = detectGateDrift(
    { gates: [{ id: "c", run: "node scripts/check-coverage.ts --areas js,ts" }], scriptNames: ["check-coverage.ts"] }
  );
  assert.deepEqual(drift, []);
});

test("drift detection over an empty manifest names every script, rather than passing", () => {
  assert.deepEqual(detectGateDrift({ gates: [], scriptNames: ["check-a.mjs", "check-b.mjs"] }), ["check-a.mjs", "check-b.mjs"]);
});

test("drift detection also rejects a null gate entry with a clear error, not a raw property-access crash", () => {
  // `detectGateDrift` reads `gate.run` directly with no defensive check, so a `null` element used to
  // throw "Cannot read properties of null (reading 'run')" from inside `.map()` — this is actually
  // the FIRST crash `check-gates.ts`'s main() hit, since it calls this before `validateManifest`.
  assert.throws(
    () => detectGateDrift({ gates: [null as unknown as GateEntry], scriptNames: ["check-x.ts"] }),
    /gates\[0\] must be an object/
  );
});

test("drift detection over a missing gates array, or an entry with no run command, still names every unrun script", () => {
  // A manifest with no `gates` array at all is reported by validateManifest; drift must not pass it.
  assert.deepEqual(detectGateDrift({ gates: null, scriptNames: ["check-a.mjs"] }), ["check-a.mjs"]);
  assert.deepEqual(detectGateDrift({ gates: undefined, scriptNames: ["check-a.mjs"] }), ["check-a.mjs"]);
  assert.deepEqual(detectGateDrift({ gates: [{ id: "half-written" }], scriptNames: ["check-a.mjs"] }), ["check-a.mjs"]);
});

// --- property 1: every gate is printed, every run -----------------------------------------------

test("the summary lists disabled gates with their reason and date, not just the ones that ran", () => {
  const gates = [
    { id: "tests", run: "npm test" },
    { id: "coverage", run: "x", enabled: false, disabledReason: "baseline pending", disabledOn: "2026-09-10" },
  ];
  const summary = formatSummary({ gates, outcomes: new Map([["tests", 0]]) });

  assert.match(summary, /PASS {4}\s+tests/);
  assert.match(summary, /DISABLED {2}coverage/);
  assert.match(summary, /baseline pending/, "the reason must be visible without opening the manifest");
  assert.match(summary, /since 2026-09-10/);
  assert.match(summary, /2 gates: 1 pass, 0 fail, 1 DISABLED/);
});

test("a disabled gate with no reason or date says so instead of printing undefined", () => {
  const summary = formatSummary({ gates: [{ id: "coverage", run: "x", enabled: false }], outcomes: new Map() });
  assert.match(summary, /DISABLED {2}coverage {2}— \(no reason given\) \[since \?\]/);
  assert.doesNotMatch(summary, /undefined/);
});

test("a failing gate is counted and labelled FAIL", () => {
  const summary = formatSummary({ gates: [{ id: "tests", run: "npm test" }], outcomes: new Map([["tests", 1]]) });
  assert.match(summary, /FAIL {4}\s+tests/);
  assert.match(summary, /1 gates: 0 pass, 1 fail, 0 DISABLED/);
});

test("an enabled gate with NO recorded outcome counts as a failure, never a pass", () => {
  // A gate whose command could not be spawned leaves no entry in the outcome map. Reading that as
  // a pass is exactly how a step that did nothing reports success.
  const summary = formatSummary({ gates: [{ id: "ghost", run: "nope" }], outcomes: new Map() });
  assert.match(summary, /FAIL/);
  assert.match(summary, /0 pass, 1 fail/);
});

// --- exit-code discipline -----------------------------------------------------------------------

test("isFailure treats a null exit code (killed by signal, or never spawned) as a failure", () => {
  assert.equal(isFailure({ exitCode: 0 }), false);
  assert.equal(isFailure({ exitCode: 1 }), true);
  assert.equal(isFailure({ exitCode: 2 }), true, "ESLint's exit 2 is a crash, not a pass");
  assert.equal(isFailure({ exitCode: null }), true);
  assert.equal(isFailure({ exitCode: undefined }), true);
});
