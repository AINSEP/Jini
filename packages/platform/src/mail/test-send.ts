/**
 * @file The ONE test-send operation behind `mail_send_test` and
 * `POST /api/admin/v1/workspaces/:workspaceId/system/mail-test-send` (email design, phase 3:
 * "shared callable test operation + HTTP adapter; optional chosen recipient").
 *
 * The message goes through the site's normal mailer, so suppression, test mode, the provider's own
 * rate limit and the send ledger all still apply; this file adds only what a deliberate,
 * person-triggered test needs on top: a validated recipient (the operator's own address by
 * default), Jini token accounting plus a duplicate-click guard, and a truthful outcome. A result says
 * what is KNOWN at send time (accepted by the provider, captured locally, redirected by test mode,
 * or failed); it never says "delivered", because only later provider feedback could.
 */
import { createMailLaneLimiter } from "./rate-limit.js";
import { ToolInputError } from "@jini-ai/core";
import type { UserRepoPort } from "@jini-ai/core/contracts/site/user-management";
import type { MailTestModeSetting } from "@jini-ai/core/contracts/mail";
import { isMailDeliveryAvailable } from "./delivery-availability.js";
import { fromPositionalMailer } from "./plugin-abi.js";
import { createMailSenderIdentityResolver, type MailSenderIdentityPort } from "./sender-identity.js";
import type { PositionalMailer as MailerPort, MailTestApproval } from "@jini-ai/core/contracts/mail";

/** Placeholder From for a non-delivering mailer; a real provider gets the site's configured sender. */
const TEST_FALLBACK_SENDER = { email: "no-reply@mail.local", name: "Site" } as const;

/** A local limiter refusal: `duplicate` is a second click inside the guard window. */
export type MailTestSendRefusal = { ok: false; reason: "duplicate" | "rate_limited"; retryAfterMs: number };

/** Deliberate test sends per site; separate from (and in front of) the provider's own bucket. */
export interface MailTestSendLimiter {
  tryTake(required: { principalId: string; to: string }): { ok: true } | MailTestSendRefusal;
}

/** Ports the operation reads; the field names match `RouteDeps`, so a route can pass its deps through. */
export interface MailTestSendDeps {
  workspaceId: string;
  mailer: MailerPort;
  /** Await current transactional resolution before freezing synchronous capabilities. */
  mailLaneReady?: (required: { lane: "transactional" | "bulk" }) => Promise<boolean>;
  /** The operator's account, for the default recipient. */
  userRepo?: Pick<UserRepoPort, "findByPrincipalId">;
  /** The site's system-mail From (`platform/mail/sender-identity.ts`). */
  mailSenderIdentity?: MailSenderIdentityPort;
  /** Host copy: the placeholder From for a non-delivering mailer, whose `name` also fills a configured
   *  sender's missing name. Absent: `no-reply@mail.local` named "Site". */
  mailTestFallbackSender?: { email: string; name: string };
  /** Shared by the route and the tool (one per site, `deps.ts`); absent (hermetic roots), only the
   *  provider's own limits apply. */
  mailTestSendLimiter?: MailTestSendLimiter;
  /** Fresh `core.mail.testMode`, so a redirect is reported as one. Absent: treated as off. */
  mailTestMode?: () => Promise<MailTestModeSetting>;
  mailTestProvider?: () => Promise<string | null>;
  /** Site-owned request results, shared by HTTP and tools; no token is taken on replay. */
  mailTestRequests?: Map<string, Promise<MailTestSendResult>>;
}

/** Where the message is meant to go, frozen before any approval card or send. */
export interface MailTestSendPlan {
  to: string;
  /** True when the caller chose the recipient; false for the operator's own address. */
  chosen: boolean;
  approval: MailTestApproval;
  driver: string;
  /** Set when test mode will rewrite the recipient. */
  redirectTo?: string;
  /** True when test mode keeps the message locally instead of sending it. */
  capture?: boolean;
}

interface Common { to: string; from: string; driver: string; at: string }
export type MailTestSendResult =
  /** The provider accepted the message for delivery; delivery itself is not yet known. */
  | Common & { outcome: "accepted"; providerMessageId: string }
  /** Nothing left this machine: kept by test-mode capture or printed by the local console driver. */
  | Common & { outcome: "captured"; where: "capture" | "console"; providerMessageId: string }
  /** Test mode sent it to another address instead of `to`. */
  | Common & { outcome: "redirected"; redirectedTo: string; providerMessageId: string }
  /** Refused or failed; the code and message are the mailer's caller-safe ones. */
  | Common & { outcome: "failed" | "unknown"; errorCode: string; message: string; retryable: boolean; retryAfterMs?: number };

/** The host's placeholder From, else the neutral one. @complexity O(1). */
function fallbackSenderOf({ deps }: { deps: MailTestSendDeps }, _optional: Record<string, never> = {}): { email: string; name: string } {
  return deps.mailTestFallbackSender ?? TEST_FALLBACK_SENDER;
}

const MAX_ADDRESS = 254;
// One mailbox, no display name, no list: anything else is refused rather than guessed at.
const ADDRESS = /^[^\s@<>()[\]",;:\\]+@[^\s@<>()[\]",;:\\]+$/;

/**
 * A chosen recipient, or a caller error. Only one plain address is accepted.
 * @complexity O(address length).
 */
export function readTestRecipient(required: { value: unknown }, _options: Record<string, never> = {}): string | undefined {
  if (required.value === undefined) return undefined;
  const value = typeof required.value === "string" ? required.value.trim() : "";
  const domain = value.slice(value.indexOf("@") + 1);
  // Keep the plain-mailbox grammar while finding the domain dot without regex backtracking.
  const hasDomainDot = domain.lastIndexOf(".", domain.length - 2) > 0;
  if (value.length === 0 || value.length > MAX_ADDRESS || !ADDRESS.test(value) || !hasDomainDot) {
    throw new ToolInputError({ message: "to must be one email address, such as owner@example.com. Nothing was sent." });
  }
  return value;
}

/**
 * The signed-in operator's own address: the account email, else a username that is an address.
 * @throws {ToolInputError} When the account has no address and no recipient was chosen.
 */
async function operatorAddress({ deps, principalId }: { deps: MailTestSendDeps; principalId: string }, _options: Record<string, never> = {}): Promise<string> {
  const user = await deps.userRepo?.findByPrincipalId({ workspaceId: deps.workspaceId, principalId });
  const address = [user?.email, user?.username].find((value) => typeof value === "string" && value.includes("@"));
  if (!address) throw new ToolInputError({ message: "Your account has no email address, so there is nowhere to send a test by default. Enter a recipient, or add an address to your user profile. Nothing was sent." });
  return address;
}

/**
 * Resolve the recipient and say where the message will really go. Sends nothing.
 * @param required.principalId - The operator; their account address is the default recipient.
 * @param required.to - An already validated chosen recipient ({@link readTestRecipient}).
 * @complexity One user lookup and one settings read.
 * @example await planMailTestSend({ deps, principalId, to: "ops@example.com" })
 */
export async function planMailTestSend(required: { principalId: string; to?: string ; deps: MailTestSendDeps }, _options: Record<string, never> = {}): Promise<MailTestSendPlan> {
  const { deps } = required;
  await deps.mailLaneReady?.({ lane: "transactional" });
  const to = required.to ?? await operatorAddress({ deps: deps, principalId: required.principalId });
  const mode = deps.mailTestMode ? await deps.mailTestMode() : { mode: "off" as const };
  const identity = deps.mailSenderIdentity ?? createMailSenderIdentityResolver({ readDriver: () => deps.mailer.capabilities().driver });
  const from = await identity.resolve({ workspaceId: deps.workspaceId, fallback: fallbackSenderOf({ deps }) });
  const providerId = deps.mailTestProvider ? await deps.mailTestProvider() : null;
  return {
    to, chosen: required.to !== undefined, driver: deps.mailer.capabilities().driver,
    approval: { providerId, driver: deps.mailer.capabilities().driver, from, mode: mode.mode, effectiveRecipient: mode.mode === "redirect" ? mode.to : to },
    ...(mode.mode === "redirect" ? { redirectTo: mode.to } : {}), ...(mode.mode === "capture" ? { capture: true } : {}),
  };
}

const REFUSALS: Readonly<Record<MailTestSendRefusal["reason"], { errorCode: string; message: string }>> = {
  duplicate: { errorCode: "MAIL_TEST_DUPLICATE", message: "A test email to this address was just sent; wait a moment before sending another." },
  rate_limited: { errorCode: "MAIL_TEST_RATE_LIMITED", message: "Too many test emails were sent recently; try again later." },
};

/** What the mailer's answer means for this plan, most local explanation first. */
function outcomeOf({ plan, providerMessageId, mailer }: { plan: MailTestSendPlan; providerMessageId: string; mailer: MailerPort }, _options: Record<string, never> = {}): MailTestSendResult["outcome"] | "console" {
  if (providerMessageId.startsWith("captured:")) return "captured";
  if (!isMailDeliveryAvailable({ mailer: fromPositionalMailer({ mailer }) })) return "console";
  return plan.redirectTo === undefined ? "accepted" : "redirected";
}

function successResult({ common, plan, providerMessageId, mailer }: { common: Common; plan: MailTestSendPlan; providerMessageId: string; mailer: MailerPort }, _options: Record<string, never> = {}): MailTestSendResult {
  const outcome = outcomeOf({ plan: plan, providerMessageId: providerMessageId, mailer: mailer });
  if (outcome === "captured" || outcome === "console") return { ...common, outcome: "captured", where: outcome === "console" ? "console" : "capture", providerMessageId };
  if (outcome === "redirected") {
    if (plan.redirectTo === undefined) throw new Error("Redirected test mail has no recipient");
    return { ...common, outcome, redirectedTo: plan.redirectTo, providerMessageId };
  }
  return { ...common, outcome: "accepted", providerMessageId };
}

/**
 * Send one test email as planned and report what is known. Refusals (local limiter, suppression,
 * provider) come back as `outcome: "failed"` with their own code, never as a throw.
 * @param required.plan - From {@link planMailTestSend}; re-validated permissions are the caller's job.
 * @param required.ref - Stable id of this request (tool execution id or the route's request id): the
 *   idempotency key, so a retried request replays the ledger's answer instead of sending twice.
 * @param optional.now - Clock for the result timestamp; defaults to `Date.now`.
 * @complexity One limiter take and at most one delivery.
 * @example await runMailTestSend({ deps, principalId, plan, ref: ctx.executionId })
 */
export async function runMailTestSend(
  required: { deps: MailTestSendDeps; principalId: string; plan: MailTestSendPlan; ref: string },
  optional: { now?: () => number } = {},
): Promise<MailTestSendResult> {
  const { deps } = required;
  const key = `${required.principalId}:${required.ref}`;
  const existing = deps.mailTestRequests?.get(key);
  if (existing) return existing;
  const pending = performMailTestSend(required, optional);
  if (deps.mailTestRequests && deps.mailTestRequests.size >= 4096) {
    const oldest = deps.mailTestRequests.keys().next();
    if (oldest.done) throw new Error("Test mail request cache has no oldest entry");
    deps.mailTestRequests.delete(oldest.value);
  }
  deps.mailTestRequests?.set(key, pending);
  // A failed dependency read has not dispatched a message and may be retried.
  pending.catch(() => { if (deps.mailTestRequests?.get(key) === pending) deps.mailTestRequests.delete(key); });
  return pending;
}

/** Validate the frozen approval before any limiter take or dispatch. */
async function performMailTestSend(
  required: { deps: MailTestSendDeps; principalId: string; plan: MailTestSendPlan; ref: string },
  optional: { now?: () => number } = {},
): Promise<MailTestSendResult> {
  const { deps, plan } = required;
  const fresh = await planMailTestSend({ ...{ principalId: required.principalId, to: plan.to }, deps: deps });
  if (JSON.stringify(fresh.approval) !== JSON.stringify(plan.approval)) {
    throw new ToolInputError({ message: "Mail configuration changed since approval. Prepare a new test-send approval; nothing was sent." });
  }
  const at = () => new Date((optional.now ?? Date.now)()).toISOString();
  const from = fresh.approval.from;
  const base = { to: plan.to, from: from.email, driver: plan.driver };
  const taken = deps.mailTestSendLimiter?.tryTake({ principalId: required.principalId, to: plan.to.toLowerCase() }) ?? { ok: true as const };
  if (!taken.ok) return { ...base, at: at(), outcome: "failed", ...REFUSALS[taken.reason], retryable: true, retryAfterMs: taken.retryAfterMs };
  const result = await deps.mailer.send(
    { workspaceId: deps.workspaceId, to: { email: plan.to }, from, subject: "Test email from your site", text: "This is a test email sent at your request. If you can read it, your site can deliver email." },
    // The operator is waiting on this message: transactional, interactive lane.
    { mailTestApproval: plan.approval, idempotencyKey: `mail:test:${required.principalId}:${required.ref}`, workspaceId: deps.workspaceId, sourceContext: { module: "mail", ref: required.ref }, purpose: "transactional", lane: "interactive" },
  );
  const common = { ...base, at: at() };
  if (result.ok) return successResult({ common: common, plan: plan, providerMessageId: result.providerMessageId, mailer: deps.mailer });
  return { ...common, outcome: result.unknown ? "unknown" : "failed", errorCode: result.errorCode, message: testSendFailureMessage({ errorCode: result.errorCode }), retryable: result.unknown ? false : result.retryable, ...(result.retryAfterMs === undefined ? {} : { retryAfterMs: result.retryAfterMs }) };
}

/** Only locally owned codes get specific copy; provider/SMTP text is never caller-safe. */
const SAFE_SEND_FAILURES: Readonly<Record<string, string>> = {
  MAIL_TEST_DUPLICATE: REFUSALS.duplicate.message,
  MAIL_TEST_RATE_LIMITED: REFUSALS.rate_limited.message,
  MAIL_TEST_CAPTURE_UNAVAILABLE: "Capture mode is unavailable. Nothing was sent.",
  MAIL_TEST_APPROVAL_CHANGED: "Mail configuration changed. Prepare a new approval; nothing was sent.",
  MAIL_RECIPIENT_SUPPRESSED: "The recipient is on the do-not-send list. Nothing was sent.",
  MAIL_RATE_LIMITED: "The mail delivery rate limit was reached. Try again later.",
  MAIL_UNCONFIGURED: "No mail provider is configured. Nothing was sent.",
  MAIL_PROVIDER_UNAVAILABLE: "The configured mail provider is unavailable. Check its configuration.",
};

/** Fixed copy by code, without reading the provider's message. @complexity O(1). */
function testSendFailureMessage({ errorCode }: { errorCode: string }, _optional: Record<string, never> = {}): string {
  const safe = Object.hasOwn(SAFE_SEND_FAILURES, errorCode) ? SAFE_SEND_FAILURES[errorCode] : undefined;
  return safe ?? `The provider refused the message (code ${errorCode}).`;
}

/** Defaults: 5 deliberate tests in a burst, one more every 12 minutes; a second click within 15 s is a duplicate. */
export const TEST_SEND_BURST = 5;
export const TEST_SEND_REFILL_MS = 12 * 60_000;
export const TEST_SEND_DUPLICATE_MS = 15_000;

/**
 * One site-wide token bucket plus a per-(operator, recipient) duplicate-click guard, in memory.
 * In memory is enough here: it protects inboxes and the provider quota from repeated clicks, and
 * the send ledger's idempotency key already covers a replayed request.
 * @param optional.now - Clock in ms; defaults to `Date.now`.
 * @complexity O(1) amortized per take; the duplicate map keeps only entries inside the window.
 * @example createMailTestSendLimiter({}, { now: () => 0 }).tryTake({ principalId: "p", to: "a@b.co" })
 */
export function createMailTestSendLimiter(
  _required: Record<string, never> = {},
  optional: { now?: () => number; burst?: number; refillMs?: number; duplicateMs?: number } = {},
): MailTestSendLimiter {
  const now = optional.now ?? Date.now;
  const burst = optional.burst ?? TEST_SEND_BURST;
  const refillMs = optional.refillMs ?? TEST_SEND_REFILL_MS;
  const duplicateMs = optional.duplicateMs ?? TEST_SEND_DUPLICATE_MS;
  const bucket = createMailLaneLimiter({ limit: { burst, perSecond: 1000 / refillMs } }, { now, reservedForTransactional: 0 });
  const lastByKey = new Map<string, number>();
  return {
    tryTake: ({ principalId, to }) => {
      const at = now();
      for (const [key, last] of lastByKey) if (at - last >= duplicateMs) lastByKey.delete(key);
      const key = `${principalId}\u0000${to}`;
      const last = lastByKey.get(key);
      if (last !== undefined) return { ok: false, reason: "duplicate", retryAfterMs: duplicateMs - (at - last) };
      const taken = bucket.tryTake({ lane: "transactional" });
      if (!taken.ok) return { ...taken, reason: "rate_limited" };
      lastByKey.set(key, at);
      return { ok: true };
    },
  };
}
