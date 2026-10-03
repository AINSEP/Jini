/**
 * @module rule-body
 *
 * Parses a `rule`-type note body written in the labeled-line convention
 * (`Assertion: … / Check: … / Verified by: …`, or `Rationale: …` in place of
 * `Verified by:`) back into the structured fields a verify pipeline can
 * consume — in particular the `check` text `verify.ts`'s
 * `ActiveRuleForVerify.check` expects a host to supply. Ported from the
 * `memory-capability-barrel` branch's `memory/rules/rules.ts`
 * `parseRuleBody` (see `archived provenance ledger`'s "Barrel branch reconciliation"
 * section) — a standalone, zero-product-noun text parser with no coupling
 * to that file's annotation/LLM distillation machinery, which was not
 * ported (see `archived provenance ledger`).
 *
 * Tolerant by design: a body with no recognized labels falls back to
 * treating its first line as the assertion, since a user may type a rule's
 * body as plain prose instead of following the labeled convention.
 */

/** The structured fields {@link parseRuleBody} extracts from a rule body. */
export interface ParsedRuleBody {
  /** The rule's core claim — what must hold. Falls back to the body's first line when no `Assertion:` line is found. */
  assertion: string;
  /** The checkable rubric line. Falls back to {@link ParsedRuleBody.assertion} when no `Check:` line is found. */
  check: string;
  /** Provenance/justification, from a `Verified by:` or `Rationale:` line. Empty string when neither is present. */
  rationale: string;
}

const LABELED_LINE_RE = /^([A-Za-z][A-Za-z ]*?):\s*(.*)$/;

/**
 * Parse a rule note body's `Assertion:`/`Check:`/`Verified by:`/`Rationale:`
 * labeled lines into `{ assertion, check, rationale }`. Each label is taken
 * from at most one line (the first non-empty match wins); unrecognized
 * labels are ignored rather than rejected, so a body that mixes the
 * convention with free-form notes still parses.
 *
 * @param body - The raw markdown body of a rule note entry.
 * @returns The parsed fields — `check` defaults to `assertion` when no
 *   `Check:` line is present, and `assertion` defaults to the body's first
 *   line when no `Assertion:` line is present.
 */
export function parseRuleBody({ body }: { body: string }): ParsedRuleBody {
  let assertion = '';
  let check = '';
  let rationale = '';

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = LABELED_LINE_RE.exec(line);
    if (match === null) continue;
    // Group 1 requires at least one `[A-Za-z]` char and group 2 is `(.*)`
    // (zero-or-more, matches even ''), so a successful match always
    // populates both — these assertions are TS-required, not a real
    // runtime possibility (mirrors `entry-frontmatter.ts`'s same pattern).
    const label = match[1]!.toLowerCase();
    const value = match[2]!.trim();
    if (value.length === 0) continue;
    if (label === 'assertion' && assertion.length === 0) {
      assertion = value;
    } else if (label === 'check' && check.length === 0) {
      check = value;
    } else if ((label === 'verified by' || label === 'rationale') && rationale.length === 0) {
      rationale = value;
    }
  }

  if (assertion.length === 0) {
    // `String.prototype.split` always returns a non-empty array (at least
    // one element, `''` at the empty extreme), so index 0 is always
    // defined here — the assertion is TS-required, not reachable-undefined.
    assertion = body.trim().split(/\r?\n/)[0]!.trim();
  }

  return { assertion, check: check.length > 0 ? check : assertion, rationale };
}
