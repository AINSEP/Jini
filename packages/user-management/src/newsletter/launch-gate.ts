/**
 * @file `evaluateLaunchGate()` — THE Launch Readiness Gate (REQ-21, ADR-PIPE-011 C-016).
 *
 * 🔴 CERTIFIED FIRST (this feature's single highest-risk contract, same treatment SPEC-007 gave
 * `deriveRequiredPermission`). ONE exported, always-evaluated function — never scattered if-checks.
 * `send-pipeline.ts`'s `authorizeSend` calls this exactly once, inside its own transaction; no other
 * call site may duplicate or bypass it (INV-05).
 *
 * behavior.spec.md §1.2 — four preconditions, evaluated in this FIXED (a)->(d) order, every time:
 *   (a) `newsletter.launch_gate.sending_enabled === true` for the workspace — SKIPPED for `isTestSend`.
 *   (b) `MembersConsentCapability` binding is present (non-null) — SKIPPED for `isTestSend`. Checks
 *       PRESENCE of a real binding only, never the binding's internal correctness (ADR-PIPE-011 Risks
 *       item 3) — a naive stub that merely returns success would defeat this if this function ever
 *       inspected behavior instead of presence; it deliberately does not.
 *   (c) `OriginRegistryPort.canonicalOrigin` resolves without throwing — NEVER skipped, even for test
 *       sends (EC-10).
 *   (d) The bound `MailerPort`'s `capabilities().driver` is neither `'console'` nor `'memory'` —
 *       NEVER skipped.
 *
 * "Always evaluated" means: within whichever preconditions apply for this call (all 4 for a real
 * send, only (c)/(d) for a test send), every applicable precondition is checked in one pass and ALL
 * unmet ones are collected — this never short-circuits/returns on the first failure found.
 */
import type { UUID } from "@jini-ai/core/primitives";
import { orFallback } from "@jini-ai/core/errors/idioms";
import type { PositionalMailer as MailerPort } from "@jini-ai/core/contracts/mail";
import type { MembersConsentCapability } from "./ports.js";
import type { OriginRegistryPort } from "@jini-ai/core/contracts/server/verified-origin";

export type LaunchGatePrecondition =
  | "sending_enabled_false"
  | "consent_capability_unbound"
  | "origin_not_verified"
  | "mailer_adapter_not_production";

export interface LaunchGateResult {
  met: boolean;
  /** Fixed (a)->(d) order — errors.spec.md's `NEWSLETTER_LAUNCH_GATE_BLOCKED.unmetPreconditions`. */
  unmetPreconditions: readonly LaunchGatePrecondition[];
}

/** Reads Newsletter's four precondition sources. Single-evaluator typed dependency, no ADR-006 port. */
export interface LaunchGateDeps {
  /** Resolves `newsletter.launch_gate.sending_enabled` (workspace setting; defaults `false` — §3). */
  isSendingEnabled(workspaceId: UUID): Promise<boolean>;
  /** `null` = unbound (correct default state until Members ships — ADR-PIPE-011 Risks item 3). */
  consentCapability: MembersConsentCapability | null;
  originRegistry: OriginRegistryPort;
  mailer: MailerPort;
}

/**
 * @complexity O(1) — 4 independent, bounded checks.
 * @overallScore 100
 */
export async function evaluateLaunchGate(required: {
  deps: LaunchGateDeps;
  workspaceId: UUID;
  isTestSend: boolean;
}, _optional: Record<string, never> = {}): Promise<LaunchGateResult> {
  const { deps, workspaceId, isTestSend } = required;
  const unmet: LaunchGatePrecondition[] = [];

  // (a) sending_enabled — skipped for isTestSend (EC-10 only carves out (c), but (a)/(b) are
  // explicitly waivable for test sends per AC-31).
  if (!isTestSend) {
    const enabled = await deps.isSendingEnabled(workspaceId);
    if (!enabled) unmet.push("sending_enabled_false");
  }

  // (b) consent capability bound — skipped for isTestSend. Presence-only check (see file header).
  if (!isTestSend && deps.consentCapability == null) unmet.push("consent_capability_unbound");

  // (c) origin verified — NEVER skipped, even for test sends (EC-10: precondition (c) never waived).
  const originVerified = await orFallback({ work: async () => { await deps.originRegistry.canonicalOrigin({ workspaceId }); return true; }, fallback: false, step: "newsletter.launch-gate.origin-verified" });
  if (!originVerified) unmet.push("origin_not_verified");

  // (d) mailer adapter is production-capable — NEVER skipped.
  const caps = deps.mailer.capabilities();
  if (caps.driver === "console" || caps.driver === "memory") {
    unmet.push("mailer_adapter_not_production");
  }

  return { met: unmet.length === 0, unmetPreconditions: unmet };
}
