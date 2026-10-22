/**
 * @file `validateWidgetEmbedMutation` — the shared `widgetEmbed` guardrail validator
 * (SPEC-043 REQ-19/20, INV-04; ADR-047 Debate Fold-In Amendment 5/6).
 *
 * Purpose:
 * A pure decision function, no I/O. This is the ONE validator both the live-editor mutation path
 * (ADR-016 §1 CopilotKit frontend action, via the existing change-set review layer) and the
 * server-side/AI mutation path (`embed-service.ts`'s `insertWidgetEmbed` et al., Amendment 6) must
 * call — enforcement lives here, not duplicated at each call site, so the two paths can never
 * silently diverge (the exact gap Amendment 6 exists to close).
 *
 * Architectural role:
 * TDD-certified implementation (SPEC-043 / implementation outline C-008). Signature and JSDoc are
 * design-frozen; `validateWidgetEmbedMutation()` is a pure decision function — no I/O — rejecting a
 * mutation that would place a `widgetEmbed` inside a widget's own body (REQ-19/INV-04) or exceed
 * `maxEmbedsPerDocument` (REQ-20). Verified against `__tests__/unit/embed-validation.unit.test.ts`.
 */
import { WIDGET_CONTENT_TYPE } from "./types.js";
import type { WidgetEmbedNode } from "./types.js";

export interface ValidateWidgetEmbedMutationInput {
  /** The content type of the entry the mutation would apply to (e.g. `page`, `post`, `widget`). */
  readonly hostEntryType: string;
  /** Every `widgetEmbed` node the resulting `bodyJson` would contain after the mutation applies. */
  readonly resultingEmbeds: readonly WidgetEmbedNode[];
  /** Configured per-document maximum (feature.spec.md REQ-20 — policy-bounded, not hardcoded). */
  readonly maxEmbedsPerDocument: number;
}

export type ValidateWidgetEmbedMutationResult =
  | { readonly valid: true }
  | { readonly valid: false; readonly reason: "recursion" | "count-exceeded" };

/**
 * Rejects a `widgetEmbed` mutation that would (a) place any `widgetEmbed` node
 * inside a `widget`-type entry's own `bodyJson` (REQ-19, INV-04 — no
 * widget-in-widget recursion, regardless of nesting depth), or (b) exceed
 * `maxEmbedsPerDocument` (REQ-20).
 */
export function validateWidgetEmbedMutation(
  input: ValidateWidgetEmbedMutationInput, _optional: Record<string, never> = {}
): ValidateWidgetEmbedMutationResult {
  // REQ-19/INV-04: a widget instance's own bodyJson must never carry a widgetEmbed node at rest,
  // regardless of nesting depth — the caller passes the flattened resultingEmbeds list, so depth
  // is already erased; only "host is a widget, and at least one embed would result" matters.
  if (input.hostEntryType === WIDGET_CONTENT_TYPE && input.resultingEmbeds.length > 0) {
    return { valid: false, reason: "recursion" };
  }

  // REQ-20: a configured, policy-bounded per-document embed-count clamp.
  if (input.resultingEmbeds.length > input.maxEmbedsPerDocument) {
    return { valid: false, reason: "count-exceeded" };
  }

  return { valid: true };
}
