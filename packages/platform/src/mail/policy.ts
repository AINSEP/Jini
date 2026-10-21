/**
 * @file Delivery policy in front of any mail provider: one place that refuses, dedups, rate-limits,
 * and records outcomes, so no provider adapter has to re-implement (or forget) these rules.
 *
 * Order per recipient: attachments → bulk unsubscribe headers → suppression → test mode → rate
 * limit → ledger reserve → send → ledger mark. Refusals before the reserve leave no ledger row, so a
 * corrected retry under the same idempotency key is not mistaken for a duplicate.
 */
import { createHash } from "node:crypto";
import type { MailCapturePort, MailDeliveryLane, MailerPort, MailSendLedgerPort, MailSuppressionRepoPort } from "./ports.js";
import type { MailLaneLimiter } from "./rate-limit.js";
import type { EmailAddress, MailerBatchRequired, MailerOptional, MailerSendOptions, MailerSendResult, MailerSendRequired, OutboundEmail } from "./types.js";

/**
 * The one throttling code of the mail contract: the local token bucket's refusal and a provider's own
 * throttling (e.g. an HTTP 429, which adapters normalize to it) are the same retryable back-pressure,
 * with `retryAfterMs` as the hint. Callers defer such a recipient instead of recording a failure.
 */
export const MAIL_RATE_LIMITED = "MAIL_RATE_LIMITED";

/** Whether a send result is the typed rate-limited refusal. @complexity O(1). */
export function isMailRateLimited({ result }: { result: MailerSendResult }): boolean {
  return !result.ok && result.errorCode === MAIL_RATE_LIMITED;
}

/** `never`: login links — the user asks again; `on_unknown`: confirmations may be re-sent once unknown. */
export type MailResendPolicy = "never" | "on_unknown";

export type MailTestMode =
  | { kind: "redirect"; to: EmailAddress }
  | { kind: "capture"; sink: MailCapturePort };

export interface MailDeliveryPolicyDeps {
  providerId: string;
  ledger: MailSendLedgerPort;
  suppression: MailSuppressionRepoPort;
  supportsAttachments: boolean;
}

export interface MailDeliveryPolicyOptions {
  limiter?: MailLaneLimiter;
  testMode?: MailTestMode;
  /** Per-purpose resend policy; unlisted purposes use `on_unknown`. */
  resendPolicy?: (required: { purpose: MailerSendOptions["purpose"] }) => MailResendPolicy;
  /** ISO clock for synthesized results (dedup replays, captures). */
  nowIso?: () => string;
}

export interface MailDeliveryPolicy {
  /** Applies the policy to one message; `send` is the provider call (any host call shape). */
  deliver(required: {
    message: OutboundEmail; options: MailerSendOptions;
    send: (required: { message: OutboundEmail }) => Promise<MailerSendResult>;
  }): Promise<MailerSendResult>;
}

/** Bulk lane only for `purpose: "bulk"`; everything else (incl. `feature:*`) is transactional. */
export function laneForPurpose({ purpose }: { purpose: MailerSendOptions["purpose"] }): MailDeliveryLane {
  return purpose === "bulk" ? "bulk" : "transactional";
}

/** RFC 8058 one-click needs both headers; header names are case-insensitive. */
export function hasOneClickUnsubscribe({ headers }: { headers: OutboundEmail["headers"] }): boolean {
  const names = new Set(Object.keys(headers ?? {}).map((name) => name.toLowerCase()));
  return names.has("list-unsubscribe") && names.has("list-unsubscribe-post");
}

/** Stable per-recipient payload hash: a reused key with different content is a caller bug. */
export function mailPayloadHash({ message }: { message: OutboundEmail }): string {
  const { subject, html, text, headers, from, attachments } = message;
  const canonical = JSON.stringify([from.email, subject, html ?? null, text ?? null, Object.entries(headers ?? {}).sort(), attachments?.map((a) => a.filename) ?? []]);
  return createHash("sha256").update(canonical).digest("hex");
}

function refuse(errorCode: string, message: string, extra: { retryable?: boolean; retryAfterMs?: number; unknown?: boolean } = {}): MailerSendResult {
  return { ok: false, retryable: extra.retryable ?? false, errorCode, message, ...(extra.retryAfterMs === undefined ? {} : { retryAfterMs: extra.retryAfterMs }), ...(extra.unknown ? { unknown: true } : {}) };
}

/** Pre-dispatch refusals that never touch the ledger. @complexity O(headers). */
async function preflight(
  required: { message: OutboundEmail; options: MailerSendOptions; lane: MailDeliveryLane; deps: MailDeliveryPolicyDeps },
): Promise<MailerSendResult | null> {
  const { message, options, lane, deps } = required;
  if ((message.attachments?.length ?? 0) > 0 && !deps.supportsAttachments) {
    return refuse("MAIL_ATTACHMENTS_UNSUPPORTED", `provider ${deps.providerId} cannot send attachments`);
  }
  if (lane === "bulk" && !hasOneClickUnsubscribe({ headers: message.headers })) {
    return refuse("MAIL_BULK_UNSUBSCRIBE_REQUIRED", "bulk mail needs List-Unsubscribe and List-Unsubscribe-Post (RFC 8058) headers");
  }
  const normalizedAddress = message.to.email.trim().toLowerCase();
  if (await deps.suppression.isSuppressed({ workspaceId: options.workspaceId, normalizedAddress, lane })) {
    return refuse("MAIL_RECIPIENT_SUPPRESSED", `recipient is suppressed for ${lane} mail`);
  }
  return null;
}

/**
 * Maps an existing ledger row to the result a duplicate delivery returns. A resendable `unknown` row
 * never gets here: the ledger reclaims it atomically in `reserve` (`reclaimUnknown`), so only the
 * one caller that won that claim re-sends.
 */
function existingResult(
  required: { existing: { outcome: "reserved" | "sent" | "unknown"; payloadHash: string; providerMessageId?: string }; payloadHash: string; nowIso: () => string },
): MailerSendResult {
  const { existing, payloadHash } = required;
  if (existing.payloadHash !== payloadHash) return refuse("MAIL_IDEMPOTENCY_CONFLICT", "idempotency key reused with a different message");
  if (existing.outcome === "sent") return { ok: true, providerMessageId: existing.providerMessageId ?? "", acceptedAt: required.nowIso() };
  // `reserved` = another worker is sending now, or a crash mid-send: the outcome is unknown.
  return refuse("MAIL_OUTCOME_UNKNOWN", "an earlier attempt with this key has an unknown outcome", { unknown: true });
}

/** Provider call → ledger outcome; a throw is unknown (the provider may have accepted it). */
async function dispatch(
  required: { message: OutboundEmail; send: (required: { message: OutboundEmail }) => Promise<MailerSendResult> },
): Promise<MailerSendResult> {
  try {
    return await required.send({ message: required.message });
  } catch (err) {
    return refuse("MAIL_OUTCOME_UNKNOWN", err instanceof Error ? err.message : String(err), { unknown: true });
  }
}

function outcomeOf(result: MailerSendResult): "sent" | "failed" | "unknown" {
  if (result.ok) return "sent";
  return result.unknown ? "unknown" : "failed";
}

/** Test mode: redirect rewrites the recipient; capture stores the message and sends nothing. */
async function applyTestMode(
  required: { message: OutboundEmail; options: MailerSendOptions; lane: MailDeliveryLane; nowIso: () => string },
  optional: { testMode?: MailTestMode } = {},
): Promise<{ message: OutboundEmail } | { result: MailerSendResult }> {
  const { message, options, lane } = required;
  const mode = optional.testMode;
  if (mode === undefined) return { message };
  if (mode.kind === "redirect") {
    return { message: { ...message, to: mode.to, headers: { ...message.headers, "X-Original-To": message.to.email } } };
  }
  const { id } = await mode.sink.capture({ message, lane, idempotencyKey: options.idempotencyKey });
  return { result: { ok: true, providerMessageId: `captured:${id}`, acceptedAt: required.nowIso() } };
}

/**
 * Builds the policy. @complexity O(1) ledger round-trips per recipient.
 * @example createMailDeliveryPolicy({ providerId: "smtp", ledger, suppression, supportsAttachments: true })
 */
export function createMailDeliveryPolicy(required: MailDeliveryPolicyDeps, optional: MailDeliveryPolicyOptions = {}): MailDeliveryPolicy {
  const resendPolicy = optional.resendPolicy ?? (() => "on_unknown" as const);
  const nowIso = optional.nowIso ?? (() => new Date().toISOString());
  return {
    async deliver({ message, options, send }) {
      const lane = laneForPurpose({ purpose: options.purpose });
      const refused = await preflight({ message, options, lane, deps: required });
      if (refused) return refused;
      const tested = await applyTestMode({ message, options, lane, nowIso }, optional.testMode ? { testMode: optional.testMode } : {});
      if ("result" in tested) return tested.result;
      const taken = optional.limiter?.tryTake({ lane }) ?? { ok: true as const };
      if (!taken.ok) return refuse(MAIL_RATE_LIMITED, `${lane} lane is rate limited`, { retryable: true, retryAfterMs: taken.retryAfterMs });
      const key = { workspaceId: options.workspaceId, idempotencyKey: options.idempotencyKey, recipient: message.to.email.trim().toLowerCase() };
      const payloadHash = mailPayloadHash({ message });
      const reclaimUnknown = resendPolicy({ purpose: options.purpose }) === "on_unknown";
      const reserved = await required.ledger.reserve({ ...key, payloadHash, lane, providerId: required.providerId }, { reclaimUnknown });
      if (reserved.status === "existing") return existingResult({ existing: reserved, payloadHash, nowIso });
      const result = await dispatch({ message: tested.message, send });
      await required.ledger.mark({ ...key, outcome: outcomeOf(result), ...(result.ok ? { providerMessageId: result.providerMessageId } : { errorCode: result.errorCode }) });
      return result;
    },
  };
}

/** Jini-shaped `MailerPort` decorator over the policy; batches go recipient by recipient. */
export function createPolicyMailer(required: { inner: MailerPort; policy: MailDeliveryPolicy }): MailerPort {
  const { inner, policy } = required;
  const sendOne = (input: MailerSendRequired, optional: MailerOptional): Promise<MailerSendResult> => {
    const { message, ...delivery } = input;
    return policy.deliver({ message, options: { ...delivery, ...optional }, send: (call) => inner.send({ ...delivery, message: call.message }, optional) });
  };
  return {
    capabilities: (empty) => inner.capabilities(empty),
    send: (input, optional = {}) => sendOne(input, optional),
    async sendBatch({ messages, ...delivery }: MailerBatchRequired, optional: MailerOptional = {}) {
      // Per-recipient ledger rows need per-recipient dispatch; a provider batch would share one outcome.
      const results: MailerSendResult[] = [];
      for (const message of messages) results.push(await sendOne({ ...delivery, message }, optional));
      return results;
    },
  };
}
