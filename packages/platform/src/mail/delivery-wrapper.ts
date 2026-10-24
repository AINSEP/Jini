/**
 * Per-provider wrapper around the existing delivery policy. Test mode is read for every recipient;
 * limiter and observation-warning state live for the lifetime of the wrapper factory.
 * The purpose gate still wraps the whole mailer at composition; this policy sits inside it.
 */
import { createMailDeliveryPolicy, type MailResendPolicy, type MailTestMode } from "./policy.js";
import type { MailCapturePort, MailerPort, MailSendLedgerPort, MailSuppressionRepoPort } from "./ports.js";
import type { MailProviderModule } from "./provider.js";
import { createMailLaneLimiter, type MailLaneLimiter } from "./rate-limit.js";
import type { MailerSendOptions, MailerSendResult, MailTestModeSetting, OutboundEmail } from "./types.js";

export interface MailPolicyWrapperDeps {
  ledger: MailSendLedgerPort;
  suppression: MailSuppressionRepoPort;
  /** Fresh host settings read; a mode change applies to the next recipient. */
  readTestMode: () => Promise<MailTestModeSetting>;
  /** The host owns purpose/module-specific resend decisions. */
  resendPolicy: (required: { options: MailerSendOptions }) => MailResendPolicy;
  observe?: (required: { message: OutboundEmail; options: MailerSendOptions; providerId: string; mode: MailTestModeSetting; result: MailerSendResult }) => Promise<void>;
}

export interface MailPolicyWrapperOptions {
  /** Capture without a sink refuses rather than sending. */
  capture?: MailCapturePort;
  /** Limiter clock in ms; defaults to Date.now. */
  now?: () => number;
  /** Fixed observation-failure diagnostic; logger faults cannot affect delivery. */
  warn?: (line: string) => void;
}

export interface MailPolicyWrapperInput {
  providerId: string;
  provider: MailProviderModule;
  mailer: MailerPort;
}

type DeliveryInput = { message: OutboundEmail; options: MailerSendOptions };
type Observation = Parameters<NonNullable<MailPolicyWrapperDeps["observe"]>>[0];

const CAPTURE_UNAVAILABLE: MailerSendResult = { ok: false, retryable: false, errorCode: "MAIL_TEST_CAPTURE_UNAVAILABLE", message: "mail test mode is set to capture, but no capture store is available; nothing was sent" };

/** Maps settings to policy test mode; null means capture was requested without a sink. */
function toTestMode(required: { setting: MailTestModeSetting; capture?: MailCapturePort }): MailTestMode | undefined | null {
  const { setting, capture } = required;
  if (setting.mode === "redirect") return { kind: "redirect", to: { email: setting.to } };
  if (setting.mode === "capture") return capture ? { kind: "capture", sink: capture } : null;
  return undefined;
}

/** Preserve serialization order and null-provider approvals: these bytes are caller-owned. */
function approvalChanged(required: DeliveryInput & { providerId: string; mailer: MailerPort; setting: MailTestModeSetting }): boolean {
  const { message, options, providerId, mailer, setting } = required;
  const approval = options.mailTestApproval;
  const actual = { providerId, driver: mailer.capabilities({}).driver, from: message.from, mode: setting.mode, effectiveRecipient: setting.mode === "redirect" ? setting.to : message.to.email };
  return !!approval && JSON.stringify({ ...actual, providerId: approval.providerId === null ? null : providerId }) !== JSON.stringify(approval);
}

/** Delivery has already happened: activity storage and diagnostics must never alter its result. */
function createResultObserver(required: MailPolicyWrapperDeps, optional: MailPolicyWrapperOptions) {
  let observationWarned = false;
  return async function observeResult(event: Observation): Promise<void> {
    try { await required.observe?.(event); } catch {
      if (observationWarned) return;
      observationWarned = true;
      try { (optional.warn ?? console.warn)("[mail] activity observation failed"); } catch { /* Diagnostics cannot reject a send. */ }
    }
  };
}

/** One token bucket per provider id, shared across all mailers from this factory. */
function createLimiterLookup(optional: MailPolicyWrapperOptions) {
  const limiters = new Map<string, MailLaneLimiter>();
  return function limiterFor({ provider, providerId }: Pick<MailPolicyWrapperInput, "provider" | "providerId">): MailLaneLimiter | undefined {
    const limit = provider.capabilities.rateLimit;
    if (!limit) return undefined;
    const existing = limiters.get(providerId);
    if (existing) return existing;
    const created = createMailLaneLimiter({ limit }, optional.now ? { now: optional.now } : {});
    limiters.set(providerId, created);
    return created;
  };
}

/** Convert the host's complete options to the existing mail port without changing delivery policy. */
function sendToMailer(required: DeliveryInput & { mailer: MailerPort }): Promise<MailerSendResult> {
  const { idempotencyKey, workspaceId, sourceContext, ...optional } = required.options;
  return required.mailer.send({ message: required.message, idempotencyKey, workspaceId, sourceContext }, optional);
}

interface WrapperState {
  deps: MailPolicyWrapperDeps;
  optional: MailPolicyWrapperOptions;
  limiterFor: ReturnType<typeof createLimiterLookup>;
  observeResult: ReturnType<typeof createResultObserver>;
}

/** Read → approve → capture check → policy → observe. Rejections propagate before observation. */
function createRecipientDelivery(required: MailPolicyWrapperInput & WrapperState) {
  const { providerId, mailer, deps, optional, limiterFor, observeResult } = required;
  return async function deliverOne({ message, options }: DeliveryInput): Promise<MailerSendResult> {
    const setting = await deps.readTestMode();
    if (approvalChanged({ message, options, providerId, mailer, setting })) {
      return { ok: false, retryable: false, errorCode: "MAIL_TEST_APPROVAL_CHANGED", message: "Mail configuration changed. Prepare a new approval; nothing was sent." };
    }
    const testMode = toTestMode({ setting, ...(optional.capture ? { capture: optional.capture } : {}) });
    if (testMode === null) return CAPTURE_UNAVAILABLE;
    const limiter = limiterFor(required);
    const policy = createMailDeliveryPolicy(
      { providerId, ledger: deps.ledger, suppression: deps.suppression, supportsAttachments: mailer.capabilities({}).supportsAttachments },
      { ...(limiter ? { limiter } : {}), ...(testMode ? { testMode } : {}), resendPolicy: () => deps.resendPolicy({ options }) },
    );
    const result = await policy.deliver({ message, options, send: (call) => sendToMailer({ message: call.message, options, mailer }) });
    await observeResult({ message, options, providerId, mode: setting, result });
    return result;
  };
}

/** Build a provider mailer; batches retain ordered, per-recipient policy results and indexed keys. */
function wrapProviderMailer(required: MailPolicyWrapperInput & WrapperState): MailerPort {
  const deliverOne = createRecipientDelivery(required);
  return {
    capabilities: () => required.mailer.capabilities({}),
    send: ({ message, ...delivery }, optional = {}) => deliverOne({ message, options: { ...delivery, ...optional } }),
    async sendBatch({ messages, ...delivery }, optional = {}) {
      const options = { ...delivery, ...optional };
      // Per-recipient ledger rows need per-recipient dispatch. A shared key makes messages 2..n
      // look like retries of 1. Await each recipient so partial results and effects stay ordered.
      const results: MailerSendResult[] = [];
      for (const [index, message] of messages.entries()) results.push(await deliverOne({ message, options: { ...options, idempotencyKey: `${options.idempotencyKey}:${index}` } }));
      return results;
    },
  };
}

/**
 * Build the wrapper applied to each resolved provider. Settings/policy failures propagate;
 * observer and diagnostic failures preserve the exact policy result.
 * @complexity One settings read plus policy round-trips per recipient; batches run sequentially.
 */
export function createMailPolicyWrapper(required: MailPolicyWrapperDeps, optional: MailPolicyWrapperOptions = {}): (required: MailPolicyWrapperInput, optional?: Record<string, never>) => MailerPort {
  const state: WrapperState = { deps: required, optional, limiterFor: createLimiterLookup(optional), observeResult: createResultObserver(required, optional) };
  return function wrap(input: MailPolicyWrapperInput, _optional: Record<string, never> = {}): MailerPort {
    return wrapProviderMailer({ ...input, ...state });
  };
}
