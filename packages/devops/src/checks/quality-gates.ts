/**
 * @file The rules that keep the host desktop app's quality gates from going quiet. Pure functions only —
 * no spawning, no filesystem — so the whole policy is testable under plain `node --test`. The CLI
 * that actually runs the gates is `scripts/check-gates.ts`.
 *
 * **The defect this exists for.** A 2026-09-12 survey of this repo's existing harness found 11 of
 * 22 `check:*` npm scripts invoked from nowhere at all, and one gate
 * (`development/scripts/check-area-coverage-floor.ts`) fully written, documented, and shipped with
 * its required config file never created — so it had never run once and nothing said so. The
 * host admin app's complexity ratchet was 11 violations behind for the same reason: it exists, it is
 * correct, and no CI step or local runner calls it.
 *
 * None of that was a decision anybody made. It is what happens when "this gate is off" is
 * representable as *absence* — a line nobody added, a file nobody created, a script nobody calls.
 * The whole design here is to make "off" a positive, loud, dated assertion instead:
 *
 * 1. {@link formatSummary} prints EVERY gate on every run, including the disabled ones. "Off"
 *    appears in the output of every run rather than in a diff nobody reads.
 * 2. {@link validateManifest} makes `enabled: false` without a reason and a date a hard failure OF
 *    THE RUNNER. Turning a gate off costs a sentence; turning it off invisibly is impossible.
 * 3. {@link detectGateDrift} fails when a gate script exists on disk that the manifest does not
 *    list. This is the one that `check-area-coverage-floor.ts` could not have survived.
 * 4. {@link validateManifest} also ages disablements out: a gate off longer than `maxDisabledDays`
 *    fails until someone re-confirms the date. Debt is allowed; INVISIBLE debt is not.
 *
 * Note the asymmetry in what counts as failure here: a *disabled* gate never fails the run (that is
 * the point of being able to turn one off), but a disabled gate that is undocumented, undated, or
 * stale DOES. The thing being enforced is not "all gates are on" — it is "no gate is off by
 * accident".
 */

/** One entry of `quality-gates.json`'s `gates`, as parsed and NOT yet validated: every field is
 *  optional because {@link validateManifest} is what reports a missing one. */
export interface GateEntry {
  id?: string;
  run?: string;
  enabled?: boolean;
  disabledReason?: string;
  disabledOn?: string;
}

/** The parsed `quality-gates.json`. `gates` is `unknown` until {@link validateManifest} has checked
 *  that it is an array at all. */
export interface GateManifest {
  gates?: unknown;
  maxDisabledDays?: number;
}

/** A gate command's exit status: `null` when it was killed by a signal or never spawned. */
export type GateExitCode = number | null;

/**
 * Narrows `value` into `GateEntry[]`, replacing the blind `gates as GateEntry[]` cast this file and
 * `scripts/check-gates.ts` used to do at their JSON-parsing boundary. Non-array input is left to each
 * caller's own "no gates array" problem reporting (returns `[]`, same as the old cast's `?? []`
 * fallback) — but a `null` or non-object array ELEMENT is valid JSON that used to pass that cast
 * silently and then crash deep inside property access ({@link gateProblems}'s `gate.id`,
 * {@link detectGateDrift}'s `gate.run`) as an unhelpful "Cannot read properties of null". That is a
 * genuinely malformed gate entry, so it throws a clear error naming the index and value instead.
 *
 * @param required.value typically `manifest.gates`, fresh out of `JSON.parse` and not yet trustworthy.
 * @returns `value` narrowed to `GateEntry[]`, or `[]` when `value` is not an array at all.
 * @throws {Error} naming the array index and JSON value of the first `null`/non-object element.
 * @complexity O(n) in entries.
 */
export function asGateEntryArray({ value }: { value: unknown }, _options = {}): GateEntry[] {
  if (!Array.isArray(value)) return [];
  value.forEach((entry, index) => {
    if (entry === null || typeof entry !== "object") {
      throw new Error(`quality-gates.json: gates[${index}] must be an object; found ${JSON.stringify(entry)}.`);
    }
  });
  return value as GateEntry[];
}

/** How long a gate may stay disabled before the runner demands the date be re-confirmed. */
const DEFAULT_MAX_DISABLED_DAYS = 30;

const MS_PER_DAY = 86_400_000;

/**
 * Whole days between two ISO `YYYY-MM-DD` dates. Deliberately date-only arithmetic rather than
 * `Date.now()` deltas: a disablement recorded "today" must read as 0 days regardless of the clock
 * time either side, or a gate disabled at 23:00 would age a day at midnight.
 *
 * @param required.fromIso the `disabledOn` date.
 * @param required.toIso today, as `YYYY-MM-DD`.
 * @returns whole days elapsed, or `null` if either date is unparseable.
 * @complexity O(1).
 */
function daysBetween({ fromIso, toIso }: { fromIso: string; toIso: string }, _options = {}): number | null {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.round((to - from) / MS_PER_DAY);
}

/**
 * Problems with ONE disabled gate's paperwork. Split out of {@link validateManifest} so that
 * function stays under this repo's own complexity ceiling of 9 — the same ceiling this harness
 * enforces on everything else, which it would be absurd to exempt itself from.
 *
 * @complexity O(1).
 */
function disabledGateProblems({ gate, today, maxDisabledDays }: { gate: GateEntry; today: string; maxDisabledDays: number }, _options = {}): string[] {
  const problems: string[] = [];
  const where = `gate "${gate.id}"`;
  if (!gate.disabledReason) {
    problems.push(`${where} is disabled with no "disabledReason". A gate may be turned off, but not silently.`);
  }
  if (!gate.disabledOn) {
    problems.push(`${where} is disabled with no "disabledOn" date, so nothing can tell how long it has been off.`);
    return problems;
  }
  const age = daysBetween({ fromIso: gate.disabledOn, toIso: today });
  if (age === null) {
    problems.push(`${where} has an unparseable "disabledOn" (${gate.disabledOn}); expected YYYY-MM-DD.`);
    return problems;
  }
  if (age > maxDisabledDays) {
    problems.push(
      `${where} has been disabled ${age} days (since ${gate.disabledOn}, limit ${maxDisabledDays}). ` +
        `Re-enable it, or re-confirm the decision by updating "disabledOn" and "disabledReason".`
    );
  }
  return problems;
}

/** Problems with ONE gate entry: shape, uniqueness, and (when off) its paperwork. Split out so
 *  {@link validateManifest} stays under the 9/9 ceiling this harness enforces on everything else —
 *  which it would be absurd to exempt itself from.
 *  @complexity O(1). */
function gateProblems({ gate, seen, today, maxDisabledDays }: { gate: GateEntry; seen: Set<string>; today: string; maxDisabledDays: number }, _options = {}): string[] {
  if (!gate.id || !gate.run) {
    return [`every gate needs an "id" and a "run"; found ${JSON.stringify(gate)}.`];
  }
  const problems = seen.has(gate.id) ? [`duplicate gate id "${gate.id}".`] : [];
  seen.add(gate.id);
  if (gate.enabled === false) problems.push(...disabledGateProblems({ gate, today, maxDisabledDays }));
  return problems;
}

/**
 * Every reason this manifest is not a legitimate description of the harness. An empty array means
 * the manifest itself is sound — it says nothing about whether the gates pass.
 *
 * @param required.manifest the parsed `quality-gates.json`.
 * @param required.today `YYYY-MM-DD`, injected rather than read from the clock so the ratchet is testable.
 * @returns human-readable problems, one per line, ready to print.
 * @complexity O(n) in gates.
 */
export function validateManifest({ manifest, today }: { manifest: GateManifest | null | undefined; today: string }, _options = {}): string[] {
  if (!manifest || !Array.isArray(manifest.gates)) return ['quality-gates.json has no "gates" array.'];
  const gates = manifest.gates;
  if (gates.length === 0) return ['quality-gates.json lists zero gates — the harness would pass by measuring nothing.'];

  // An array of gates means the manifest was present.
  const maxDisabledDays = manifest.maxDisabledDays ?? DEFAULT_MAX_DISABLED_DAYS;
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const gate of asGateEntryArray({ value: gates })) problems.push(...gateProblems({ gate, seen, today, maxDisabledDays }));
  return problems;
}

/**
 * Gate scripts present on disk that no manifest entry runs — the check that makes a written-but-
 * unwired gate impossible to leave lying around. Matching is by substring of the `run` command
 * rather than by exact path, because a `run` legitimately carries flags and a wrapper
 * (`node scripts/check-coverage.ts --areas ...`).
 *
 * @param required.gates the manifest's gate list (disabled ones count as registered — being off is a
 *   decision, being absent is not).
 * @param required.scriptNames basenames of the gate scripts found on disk, e.g. `["check-coverage.ts"]`.
 * @returns the basenames nothing references.
 * @complexity O(gates x scripts); both are single digits here.
 */
export function detectGateDrift({ gates, scriptNames }: { gates: readonly GateEntry[] | null | undefined; scriptNames: readonly string[] }, _options = {}): string[] {
  const commands = asGateEntryArray({ value: gates }).map((gate) => String(gate.run ?? ""));
  return scriptNames.filter((name) => !commands.some((command) => command.includes(name)));
}

/** One line per gate, in manifest order. `PASS`/`FAIL` for what ran, `DISABLED` for what did not —
 *  the disabled ones carry their reason and date so the summary is self-explaining.
 *  @complexity O(1). */
function summaryLine({ gate, outcome }: { gate: GateEntry; outcome: GateExitCode | undefined }, _options = {}): string {
  if (gate.enabled === false) {
    return `  DISABLED  ${gate.id}  — ${gate.disabledReason ?? "(no reason given)"} [since ${gate.disabledOn ?? "?"}]`;
  }
  return `  ${outcome === 0 ? "PASS    " : "FAIL    "}  ${gate.id}`;
}

/**
 * The whole run, rendered. Every gate appears — that is property 1 and the reason this function
 * takes the full manifest rather than only the results.
 *
 * @param gates the manifest's gate list.
 * @param outcomes `Map<gateId, exitCode>` for the gates that actually ran. Keyed by `string |
 *   undefined` because `gates` is unvalidated: a gate with no `id` looks up `undefined`, finds no
 *   outcome, and counts as a failure.
 * @returns the printable summary block.
 * @complexity O(n) in gates.
 */
export function formatSummary({ gates, outcomes }: { gates: readonly GateEntry[]; outcomes: ReadonlyMap<string | undefined, GateExitCode> }, _options = {}): string {
  const lines = ["", "=".repeat(66), "DESKTOP GATE SUMMARY", "=".repeat(66)];
  let passed = 0;
  let failed = 0;
  let disabled = 0;

  for (const gate of gates) {
    if (gate.enabled === false) {
      disabled += 1;
    } else if (outcomes.get(gate.id) === 0) {
      passed += 1;
    } else {
      failed += 1;
    }
    lines.push(summaryLine({ gate, outcome: outcomes.get(gate.id) }));
  }

  lines.push("-".repeat(66));
  lines.push(`  ${gates.length} gates: ${passed} pass, ${failed} fail, ${disabled} DISABLED`);
  return lines.join("\n");
}

/**
 * True when a gate's result should fail the run. A gate that never produced a numeric exit code —
 * killed by a signal, or a command that could not be spawned at all — is a FAILURE, never a pass.
 * That asymmetry is deliberate: this repo has already shipped a packaged app off a step that
 * "succeeded" without doing anything, and an absent exit code is the same shape of evidence.
 *
 * @complexity O(1).
 */
export function isFailure({ exitCode }: { exitCode: GateExitCode | undefined }, _options = {}): boolean {
  return exitCode !== 0;
}

export { DEFAULT_MAX_DISABLED_DAYS, daysBetween };
