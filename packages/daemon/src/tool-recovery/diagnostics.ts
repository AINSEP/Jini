
/**
 * @file The general tool-failure contract (2026-09-01): what ANY tool attaches to a failed outcome
 * so a caller — human, agent, or an automated retry loop — has something to reason about instead of a
 * bare status code with nothing behind it.
 *
 * ## Why this exists
 *
 * Hand-writing a bespoke recovery path per failure mode does not scale — there will always be more
 * flaws, gaps, and provider quirks than anyone can anticipate and special-case individually. The
 * leverage is not a smarter model reading a smarter error message; it is a SHARED SHAPE every tool's
 * failure can be poured into, so one generic loop — read the failure, ask the human through a
 * surface, apply the answer, retry once — can handle a failure mode nobody wrote code for, using the
 * identical mechanism that already handles one somebody did.
 *
 * ## The four things a diagnostic carries
 *
 * 1. **What failed.** Deliberately NOT modeled in this shared contract — it is always domain-specific,
 *    and forcing every failure mode into one generic "what failed" string or object would either
 *    flatten real structure that needs to stay queryable (a concrete diagnostic's own fact fields —
 *    see {@link AuthFailureDiagnostic}'s `schemeSent`/`usernameStored` in `features/custom-credentials/
 *    credentialed-request.ts` for the worked example) or force a restructuring this file has no
 *    business demanding of every domain that wants to adopt it. A concrete diagnostic type carries
 *    its own facts as its own additional fields, declared alongside the two this contract does own.
 * 2. **The best hypothesis why** — folded into {@link ToolFailureDiagnostic.hint}.
 * 3. **What input or state would change the outcome** — also folded into `hint`, not a separate field;
 *    see that property's own doc for why the two live together.
 * 4. **Whether a registered tool can supply it** — {@link ToolFailureDiagnostic.remedyToolId}.
 *
 * ## Built from one worked example, not designed from zero
 *
 * `AuthFailureDiagnostic` is this contract's first instance, extracted AFTER it shipped and proved
 * itself against a real incident — not designed up front from a guess at what failures might someday
 * look like. See that type's own file header, "Authentication-failure diagnostics", for the incident
 * and for the exact honesty contract every one of its fields is held to. This file generalizes its
 * SHAPE, not its content: the fields that type adds (`schemeSent`, `usernameStored`) and the exact
 * wording of its `hint` are unchanged by this extraction.
 *
 * ## The honesty contract every field is held to
 *
 * - **Silence is the default, not an afterthought.** Both fields below are optional, and absent
 *   together far more often than present: a diagnostic type should fill them in for the ONE narrow
 *   shape it can honestly speak to, and stay silent for every other shape — including shapes that
 *   look superficially similar. Repeating advice that has already been tried and failed, or guessing
 *   at a cause this diagnostic cannot actually tell apart from some other one, is a false lead, not
 *   merely an unhelpful one.
 * - **Never a claim.** `hint`, when present, is hedged ("may"/"might"/"could") — a hypothesis for a
 *   human or agent to try, never an assertion of the real cause.
 * - **Additive, never a replacement.** A diagnostic rides ALONGSIDE the tool's own real failure output
 *   (a provider's response body, a thrown error's message) — it never suppresses or reinterprets it.
 * - **`hint` and `remedyToolId` travel as a pair, never `remedyToolId` alone.** A tool id with nothing
 *   explaining why it might help is a suggestion with no argument behind it, not a diagnostic. The
 *   reverse is fine: `hint` with no `remedyToolId` simply means no registered tool can supply the fix
 *   yet — the hypothesis is still worth surfacing to a human who can act on it by hand.
 *
 * ## The one-cycle guard
 *
 * `remedyToolId` is a POINTER — a tool id, nothing else. It carries no callback, no arguments, and no
 * instruction to invoke it automatically. That is deliberate: the consuming loop (ask the human → apply
 * the answer through the named tool → retry ONCE) owns the decision of whether and how to act on it,
 * and owns the guard against a second cycle. A diagnostic that carried more than an id — an executable
 * action, say — would let that guard slip into this file instead of staying where the actual retry
 * happens, turning a bug in this contract into a genuine loop instead of a single bounded retry.
 *
 * ## Architectural role
 *
 * `contracts/core`, domain-agnostic — it names no post, page, credential, or other domain concept, so
 * a failure mode in any feature can adopt it without this file growing a dependency on that feature.
 */

/**
 * A tool-failure diagnostic's shared, domain-agnostic half. A concrete diagnostic type extends this
 * with whatever structured facts its own failure mode requires (facet 1, "what failed" — see this
 * file's header) as additional fields alongside the two declared here.
 */
export interface ToolFailureDiagnostic {
  readonly setupToolId?: string;
  readonly prefill?: Readonly<Record<string, string | number | boolean | null>>;
  /**
   * The best hypothesis for why the call failed, together with what input or state would change the
   * outcome if that hypothesis is right (facets 2 and 3 of this file's header) — one hedged sentence,
   * never a bare claim. Omitted entirely — not filled with a guess — whenever the failure could have
   * more than one honest explanation from here. See this file's header, "The honesty contract every
   * field is held to".
   *
   * Folded into one field rather than split into separate `hypothesis`/`remedy` fields: every diagnosis
   * this contract has actually had to express so far is a single hedged sentence that names both in
   * the same breath ("X may be why — saving Y may fix it"), and splitting a hedge into two structured
   * fields would invite treating the "remedy" half as more certain than the hedge it depends on.
   */
  readonly hint?: string;

  /**
   * The id of an already-registered tool that could supply the fix `hint` describes, when one exists
   * (facet 4 of this file's header) — a pointer only, never a callback; see this file's header, "The
   * one-cycle guard". Present only alongside `hint` — never on its own.
   */
  readonly remedyToolId?: string;
}

/**
 * Every diagnostic a tool has issued, by identity. Membership is the proof that a `{hint,
 * remedyToolId}` object came from tool code reporting a failure, not from data the tool merely
 * returned: stored content (a post's `bodyJson`, a widget's props) is plain JSON and can carry the
 * same two fields, and the recovery loop turns them into a dialog that runs `remedyToolId`. A parsed
 * or stored object can never be a member. Weak, so an issued diagnostic is collected with its result.
 */
const issuedDiagnostics = new WeakSet<object>();

/**
 * Marks `diagnostic` as issued by the calling tool for a real failure, so the recovery loop
 * (`assistant/tool-failure-recovery.ts`) may act on it. Returns the same object. Call it where the
 * diagnostic is built, and return that object itself: a copy (spread, JSON round trip) is not issued.
 *
 * @complexity O(1).
 */
export function issueToolFailureDiagnostic<T extends ToolFailureDiagnostic>({ diagnostic }: { diagnostic: T }, _optional = {}): T {
  issuedDiagnostics.add(diagnostic);
  return diagnostic;
}

/**
 * True only for an object {@link issueToolFailureDiagnostic} marked.
 *
 * @complexity O(1).
 */
export function isIssuedToolFailureDiagnostic({ value }: { value: unknown }, _optional = {}): boolean {
  return typeof value === "object" && value !== null && issuedDiagnostics.has(value);
}

/** Only card metadata travels through recovery; secret values belong to the parked card. */
export function issueCredentialSetup(
  required: { setupToolId: string; prefill: Readonly<Record<string, string | number | boolean | null>>; assertCredentialFreeField: (required: { value: string; field: string }, optional: Record<string, never>) => void; containsSecret: (required: { text: string }) => boolean },
  _optional = {},
): ToolFailureDiagnostic & { setupToolId: string; prefill: typeof required.prefill; hint: string; remedyToolId: string } {
  for (const [key, value] of Object.entries(required.prefill)) {
    if (/token|secret|password|authorization|env|headers|body|key/i.test(key)) throw new Error("Credential setup accepts only non-secret metadata.");
    if (typeof value === "string") {
      required.assertCredentialFreeField({ value, field: key }, {});
      if (required.containsSecret({ text: value })) throw new Error("Credential setup accepts only non-secret metadata.");
    }
  }
  return issueToolFailureDiagnostic({ diagnostic: { setupToolId: required.setupToolId, prefill: required.prefill, remedyToolId: required.setupToolId,
    hint: "A missing or rejected credential may be fixed by saving it through the secure card." } }, {});
}
