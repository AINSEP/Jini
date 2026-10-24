/** Unknown and absent lanes require a durable notification path in production.
 * Local mode and explicit interactive sends proceed without that gate.
 */

import type { MailerPort, MailerSendOptions, MailerSendResult, DeliveryReadinessPolicy } from "./ports.js";
type RuntimeMode = "production" | "local";

export interface WrapMailerWithPurposeGateOptions {
  inner: MailerPort;
  
  mode: RuntimeMode;
  
  readiness: DeliveryReadinessPolicy;
}

type MailerLane = "interactive" | "notification";

// Allowlist the one interactive value: undefined, unknown values and type-bypassing casts
// belong to the restrictive notification lane, so a new lane cannot accidentally bypass readiness.
function resolveLane(options: Pick<MailerSendOptions, "lane">): MailerLane {
  return options.lane === "interactive" ? "interactive" : "notification";
}

function refusalError(capabilityName: string): Error {
  return new Error(
    `MAILER_SEND_REFUSED_NO_DURABLE_PATH: notification-lane mailer send refused for capability "${capabilityName}" — no durable outbox path registered`
  );
}

function validateMode(mode: RuntimeMode): void {
  if (mode !== "production" && mode !== "local") {
    throw new TypeError('mailer mode must be "production" or "local"');
  }
}

export interface PurposeGateRequired {
  mode: RuntimeMode;
  readiness: DeliveryReadinessPolicy;
  options: Pick<MailerSendOptions, "lane" | "sourceContext">;
}

/**
 * Ask the delivery gate without delivering: unknown/absent lanes require durable readiness.
 * Invalid modes throw TypeError; readiness errors propagate so callers can report unknown.
 * @complexity O(1), with at most one call to the supplied readiness predicate.
 */
export function isPurposeGateOpen(required: PurposeGateRequired): boolean {
  const { mode, readiness, options } = required;
  validateMode(mode);
  if (mode === "local") return true;
  if (resolveLane(options) !== "notification") return true;
  return readiness.isReady({ capabilityName: options.sourceContext?.module ?? "unknown" });
}

// Decorate the existing port rather than inventing a second delivery contract. The caller resolves
// mode once at composition; never re-read the environment per send and change policy mid-process.
/** Validates the mode at wrap time and gates notification sends/batches before delivery.
 * Unknown modes throw TypeError; only explicit local mode bypasses durable readiness.
 * @complexity O(1) policy work per send/batch, before delegating delivery.
 * @example wrapMailerWithPurposeGate({ inner, mode: "production", readiness })
 */
export function wrapMailerWithPurposeGate(options: WrapMailerWithPurposeGateOptions): MailerPort {
  const { inner, mode, readiness } = options;
  // Validate at composition: typos must never silently disable durable delivery.
  validateMode(mode);

  function checkGate(sendOptions: MailerSendOptions): void {
    if (!isPurposeGateOpen({ mode, readiness, options: sendOptions })) {
      throw refusalError(sendOptions.sourceContext?.module ?? "unknown");
    }
  }

  return {
    capabilities: (required) => inner.capabilities(required),
    async send({ message, ...required }, optional = {}): Promise<MailerSendResult> {
      const sendOptions = { ...required, ...optional };
      checkGate(sendOptions);
      return inner.send({ message, ...required }, optional);
    },
    async sendBatch(
      { messages, ...required },
      optional = {}
    ): Promise<readonly MailerSendResult[]> {
      const sendOptions = { ...required, ...optional };
      checkGate(sendOptions);
      return inner.sendBatch({ messages, ...required }, optional);
    },
  };
}
