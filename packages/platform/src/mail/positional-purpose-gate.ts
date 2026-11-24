/** Host adapters for Jini mail and the SPEC-022 durable notification gate.
 * Jini preserves U-001: only explicit interactive sends bypass production readiness;
 * local mode proceeds, and the supplied mode is never re-read from the environment.
 */
import {
  wrapMailerWithPurposeGate as wrapJiniMailerWithPurposeGate,
} from "./purpose-scoped-mailer.js";
import type { PositionalMailer as MailerPort } from "./plugin-abi.js";
import type { RuntimeMode } from "@jini-ai/core/contracts/site/core-runtime-mode";

// Lane/readiness rationale: Jini/packages/platform/src/mail/purpose-scoped-mailer.ts (SPEC-022 C-005 / U-001).
export interface WrapPositionalMailerWithPurposeGateOptions {
  inner: MailerPort;
  mode: RuntimeMode;
  durableOutboxReady: (required: { capabilityName: string }) => boolean;
}

import { fromPositionalMailer as toJiniMailer, toPositionalMailer as toHostMailer } from "./plugin-abi.js";

/** Injects the host's durable-outbox readiness into Jini's fail-closed purpose gate.
 * @example wrapPositionalMailerWithPurposeGate({ inner, mode, durableOutboxReady })
 */
export function wrapPositionalMailerWithPurposeGate({ inner, mode, durableOutboxReady }: WrapPositionalMailerWithPurposeGateOptions): MailerPort {
  const mailer = wrapJiniMailerWithPurposeGate({
    inner: toJiniMailer({ mailer: inner }),
    mode,
    readiness: { isReady: ({ capabilityName }) => durableOutboxReady({ capabilityName }) },
  });
  return toHostMailer({ mailer });
}
