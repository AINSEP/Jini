/**
 * @file Asks Jini's purpose gate (`wrapMailerWithPurposeGate`, SPEC-022 C-005 / U-001) whether it
 * would let a send through, without sending: the probe calls the gate's own predicate. The Email
 * page's use readiness reads the real gate instead of restating its rules, so the two cannot drift.
 *
 * It is given the same `mode` and `durableOutboxReady` the composition root hands the live mailer's
 * gate (`server/runtime/composition/deps.ts`); this file never decides readiness itself.
 */
import { isPurposeGateOpen } from "./purpose-scoped-mailer.js";
import type { RuntimeMode } from "@jini-ai/core/contracts/site/core-runtime-mode";

export type MailPurposeGateProbe = (required: { capabilityName: string; lane: "interactive" | "notification" }) => Promise<boolean>;

/**
 * @returns `true` when the gate would pass a send for that capability and lane, `false` when it refuses.
 * @throws Anything else the gate throws (an unexpected failure is the caller's `unknown`, not a refusal).
 * @complexity O(1); no I/O.
 * @example await createMailPurposeGateProbe({ mode: "production", durableOutboxReady: () => false })({ capabilityName: "forms", lane: "notification" })
 */
export function createMailPurposeGateProbe(required: { mode: RuntimeMode; durableOutboxReady: (required: { capabilityName: string }) => boolean }): MailPurposeGateProbe {
  // Validate at composition, as the previous gate wrapper did; no readiness read in local mode.
  isPurposeGateOpen({ mode: required.mode, readiness: { isReady: () => false }, options: { lane: "interactive", sourceContext: { module: "unknown" } } });
  return async ({ capabilityName, lane }) => isPurposeGateOpen({ mode: required.mode,
    readiness: { isReady: ({ capabilityName }) => required.durableOutboxReady({ capabilityName }) }, options: { lane, sourceContext: { module: capabilityName } } });
}
