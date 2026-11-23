/**
 * @file A tool-failure diagnostic's shared, domain-agnostic shape. Types only.
 *
 * Additive copy of `ToolFailureDiagnostic` from `@jini-ai/daemon/tool-recovery`
 * (`tool-recovery/diagnostics.ts`). The issued-diagnostic registry and recovery helpers stay in the
 * daemon, which keeps its identical declaration and export until the paired cutover. "This file's
 * header" in the field docs below means that daemon module's header (the four facets, the honesty
 * contract and the one-cycle guard).
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
