/**
 * @file `unsubscribe.ts` — `processUnsubscribe` (ADR-PIPE-011 C-015, REQ-14/15/30/32, INV-04/INV-09).
 *
 * `[internal-invariant]`: the fail-closed unsubscribe-token check — this feature's SECOND-highest-risk
 * contract after the Launch Gate. Verifies the `KeyringPort`-derived token against
 * `consentRevisionIdAtSubscribe` (INV-04: a token must never verify once `consentRevisionId` has
 * advanced past its mint-time value — e.g. a stale token from before a re-subscribe under a new
 * consent grant). Idempotent on a repeat of an already-processed token (EC-03) — but that narrow
 * carve-out is scoped to "this exact token, already at its own resulting terminal state," never a
 * general bypass of INV-04 (three separate tests keep the two concerns from being conflated, see
 * `__tests__/unsubscribe.test.ts`). Links are built ONLY from `OriginRegistryPort.canonicalOrigin`
 * (REQ-30/INV-09) — never a raw inbound `Host` header.
 */
import { timingSafeEqual } from "node:crypto";

import type { UUID } from "@jini-ai/core/primitives";
import type { KeyringPort } from "@jini-ai/core/contracts/vault";
import type { OriginRegistryPort, VerifiedOrigin } from "@jini-ai/core/contracts/server/verified-origin";
import { NewsletterUnsubscribeTokenInvalidError } from "./errors.js";
import type { MembersConsentCapability, NewsletterSubscriptionRepoPort } from "./ports.js";
import type { SubscriptionRow } from "./types.js";

export interface UnsubscribeTokenClaims {
  workspaceId: UUID;
  subscriberId: UUID;
  listId: UUID;
  campaignId: UUID | null;
  /** The consent-revision id the token was minted against — compared to the subscription's CURRENT value (INV-04).
   *  `null` when the subscription recorded none (no consent capability bound); it must stay `null`
   *  rather than be coerced, or the comparison would reject the subscriber's own token. */
  consentRevisionId: string | null;
}

export interface UnsubscribeDeps {
  subscriptionRepo: NewsletterSubscriptionRepoPort;
  keyring: KeyringPort;
  originRegistry: OriginRegistryPort;
  consentCapability: MembersConsentCapability | null;
  clock: { nowIso(): string };
}

const derivationInfo = (claims: UnsubscribeTokenClaims): string =>
  `${claims.subscriberId}:${claims.listId}:${claims.consentRevisionId}:${claims.campaignId ?? ""}`;

/** Compose an absolute origin URL from a `VerifiedOrigin` — mirrors `redirects/phase-handler.ts`'s local `composeOriginUrl`. */
function composeOriginUrl(origin: VerifiedOrigin): string {
  const matchesSchemePort = (origin.scheme === "https" && origin.port === 443) || (origin.scheme === "http" && origin.port === 80);
  const isDefaultPort = origin.port === undefined || matchesSchemePort;
  const authority = isDefaultPort ? origin.host : `${origin.host}:${origin.port}`;
  return `${origin.scheme}://${authority}${origin.basePath ?? ""}`;
}

async function signature(keyring: KeyringPort, claims: UnsubscribeTokenClaims): Promise<string> {
  const secret = await keyring.derive({
    workspaceId: claims.workspaceId,
    purpose: "newsletter-unsubscribe",
    info: derivationInfo(claims),
  });
  return Buffer.from(secret).toString("hex");
}

/** Build a signed, origin-anchored unsubscribe link (REQ-30/INV-09 — never a raw `Host` header). */
export async function buildUnsubscribeLink(required: {
  deps: UnsubscribeDeps;
  claims: UnsubscribeTokenClaims;
}, _optional: Record<string, never> = {}): Promise<string> {
  const { deps, claims } = required;
  const sig = await signature(deps.keyring, claims);
  const token = `${Buffer.from(JSON.stringify(claims)).toString("base64url")}.${sig}`;
  const origin = await deps.originRegistry.canonicalOrigin({ workspaceId: claims.workspaceId });
  return `${composeOriginUrl(origin)}/newsletter/unsubscribe?token=${token}`;
}

/** Decodes the claims half of a token whose two-part shape `processUnsubscribe` already checked. */
function decodeClaims({ encoded }: { encoded: string }, _options = {}): UnsubscribeTokenClaims {
  try {
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as UnsubscribeTokenClaims;
  } catch {
    throw new NewsletterUnsubscribeTokenInvalidError({ message: "malformed unsubscribe token", reason: "signature_invalid" });
  }
}

/**
 * @complexity O(1).
 * @overallScore 100
 */
export async function processUnsubscribe(required: {
  deps: UnsubscribeDeps;
  input: { rawToken: string };
}, _optional: Record<string, never> = {}): Promise<{ outcome: "unsubscribed" | "already-unsubscribed" }> {
  const { deps, input } = required;
  const [encoded, providedSig] = input.rawToken.split(".");
  if (!encoded || !providedSig) {
    throw new NewsletterUnsubscribeTokenInvalidError({ message: "malformed unsubscribe token", reason: "signature_invalid" });
  }
  const claims = decodeClaims({ encoded });

  const expectedSig = await signature(deps.keyring, claims);
  if (!timingSafeEqualHex({ a: expectedSig, b: providedSig })) {
    throw new NewsletterUnsubscribeTokenInvalidError({ message: "unsubscribe token signature is invalid", reason: "signature_invalid" });
  }

  const subscription = await deps.subscriptionRepo.findBySubscriberAndList({
    workspaceId: claims.workspaceId,
    listId: claims.listId,
    subscriberId: claims.subscriberId,
  });
  if (!subscription) {
    throw new NewsletterUnsubscribeTokenInvalidError({ message: "subscription was not found", reason: "not_found" });
  }

  // INV-04: fail-closed the moment the current consent revision has advanced past this token's
  // mint-time value (e.g. a re-subscribe under a new consent grant since this token was issued).
  if (subscription.consentRevisionIdAtSubscribe !== claims.consentRevisionId) {
    throw new NewsletterUnsubscribeTokenInvalidError({
      message: "unsubscribe token was minted against a stale consent revision",
      reason: "consent_revision_mismatch",
    });
  }

  // EC-03: a repeat of an already-processed token (same still-matching revision) is idempotent
  // success — narrowly scoped to "this exact token, already at its own resulting terminal state,"
  // never a general bypass of the INV-04 check above (which already ran and passed).
  if (subscription.status === "unsubscribed") {
    return { outcome: "already-unsubscribed" };
  }

  if (deps.consentCapability) {
    await deps.consentCapability.revoke({ workspaceId: claims.workspaceId, subscriberId: claims.subscriberId });
  }

  const now = deps.clock.nowIso();
  const updated: SubscriptionRow = { ...subscription, status: "unsubscribed", unsubscribedAt: now, updatedAt: now };
  await deps.subscriptionRepo.save(updated);
  return { outcome: "unsubscribed" };
}

/** Constant-time hex comparison (defense in depth against signature timing attacks). */
function timingSafeEqualHex({ a, b }: { a: string; b: string }, _options = {}): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}
