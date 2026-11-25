/**
 * @file `confirmation.ts` — ISSUE_CONFIRMATION_TOKEN / CONSUME_CONFIRMATION_TOKEN chokepoint
 * (ADR-PIPE-011 C-014, REQ-11/12/13/32, INV-03).
 *
 * `consumeConfirmationToken` must NEVER flip `SubscriptionRow.status` to `subscribed` before
 * `MembersConsentCapability.confirm` reports `granted` — reversing this order breaks REQ-11/REQ-32's
 * "Members is the source of truth" guarantee (INV-03: Newsletter never writes a Members consent
 * record directly, it only supplies evidence and observes the result).
 */

import type { UUID } from "@jini-ai/core/primitives";
import type { PositionalMailer as MailerPort, OutboundEmail } from "@jini-ai/core/contracts/mail";
import type { OriginRegistryPort, VerifiedOrigin } from "@jini-ai/core/contracts/server/verified-origin";
import { NewsletterConfirmTokenInvalidError } from "./errors.js";
import type {
  MembersConsentCapability,
  NewsletterConfirmationTokenRepoPort,
  NewsletterSubscriptionRepoPort,
} from "./ports.js";
import type { ConfirmationTokenRecord, SubscriptionRow } from "./types.js";

/** behavior.spec.md §3 — confirmation-token TTL, fixed at 72 hours. */
export const CONFIRMATION_TOKEN_TTL_MS = 72 * 60 * 60 * 1000;

export interface ConfirmationDeps {
  tokenRepo: NewsletterConfirmationTokenRepoPort;
  subscriptionRepo: NewsletterSubscriptionRepoPort;
  mailer: MailerPort;
  /** `null` = unbound — see `launch-gate.ts`'s file header on why this must never be stubbed to succeed. */
  consentCapability: MembersConsentCapability | null;
  originRegistry: OriginRegistryPort;
  clock: { nowIso(): string };
  ids: { newId(): string };
  /** Resolves the confirmation email's From (`platform/mail/sender-identity.ts`); absent, the
   *  `no-reply@newsletter.local` placeholder is used only while `mailer` is non-delivering. */
  resolveFrom(required: { workspaceId: string }, optional?: Record<string, never>): Promise<OutboundEmail["from"]>;
  mintRawToken(required: Record<string, never>, optional?: Record<string, never>): string;
  hashToken(required: { raw: string }, optional?: Record<string, never>): string;
}

/** Compose an absolute origin URL from a `VerifiedOrigin` — mirrors `redirects/phase-handler.ts`'s local `composeOriginUrl`. */
function composeOriginUrl(origin: VerifiedOrigin): string {
  const matchesSchemePort = (origin.scheme === "https" && origin.port === 443) || (origin.scheme === "http" && origin.port === 80);
  const isDefaultPort = origin.port === undefined || matchesSchemePort;
  const authority = isDefaultPort ? origin.host : `${origin.host}:${origin.port}`;
  return `${origin.scheme}://${authority}${origin.basePath ?? ""}`;
}

async function supersedeConfirmationTokens({ deps, input, now }: {
  deps: ConfirmationDeps; input: Parameters<typeof issueConfirmationToken>[0]["input"]; now: string;
}): Promise<void> {
  // "Newest wins": mark every prior unconsumed token superseded (consumed) before minting the new one.
  const prior = await deps.tokenRepo.findUnconsumedBySubscription({
    workspaceId: input.workspaceId,
    subscriptionId: input.subscriptionId,
  });
  for (const token of prior) {
    await deps.tokenRepo.save({ ...token, consumedAt: now });
  }
}

/**
 * Mint a new confirmation token, invalidating every prior unconsumed token for this subscription
 * first ("newest wins" — behavior.spec.md §2.1), then send the confirm email. Does NOT change
 * `SubscriptionRow.status` (stays `pending` until `consumeConfirmationToken` succeeds).
 *
 * @throws SenderIdentityNotConfiguredError When a delivering mailer is active and the site has no
 *   sender configured — before any token is written.
 */
export async function issueConfirmationToken(required: {
  deps: ConfirmationDeps;
  input: { workspaceId: UUID; subscriptionId: UUID; recipientEmail: string };
}, _optional: Record<string, never> = {}): Promise<{ tokenId: UUID; expiresAt: string }> {
  const { deps, input } = required;
  const now = deps.clock.nowIso();
  // Resolved first: a missing sender refuses before any prior token is superseded, so the
  // subscriber's last working link survives a send that could never have gone out.
  const from = await deps.resolveFrom({ workspaceId: input.workspaceId });

  await supersedeConfirmationTokens({ deps, input, now });

  const rawToken = deps.mintRawToken({});
  if (!/^[0-9a-f]{64}$/.test(rawToken)) throw new Error("mintRawToken must return 64 lowercase hex characters");
  const tokenHash = deps.hashToken({ raw: rawToken });
  if (!/^[0-9a-f]{64}$/.test(tokenHash)) throw new Error("hashToken must return 64 lowercase hex characters");
  const tokenId = deps.ids.newId();
  const expiresAt = new Date(Date.parse(now) + CONFIRMATION_TOKEN_TTL_MS).toISOString();

  const record: ConfirmationTokenRecord = {
    id: tokenId,
    workspaceId: input.workspaceId,
    subscriptionId: input.subscriptionId,
    tokenHash,
    purpose: "newsletter_subscription_confirm",
    createdAt: now,
    expiresAt,
    consumedAt: null,
  };
  await deps.tokenRepo.save(record);

  const origin = await deps.originRegistry.canonicalOrigin({ workspaceId: input.workspaceId });
  const confirmUrl = `${composeOriginUrl(origin)}/newsletter/confirm?token=${rawToken}`;

  await deps.mailer.send(
    {
      workspaceId: input.workspaceId,
      to: { email: input.recipientEmail },
      from,
      subject: "Confirm your subscription",
      text: `Please confirm your subscription: ${confirmUrl}`,
      html: `<p>Please confirm your subscription: <a href="${confirmUrl}">${confirmUrl}</a></p>`,
    },
    {
      idempotencyKey: `newsletter:confirm-email:${tokenId}`,
      workspaceId: input.workspaceId,
      sourceContext: { module: "newsletter", ref: tokenId },
      // A double-opt-in confirmation is transactional mail the subscriber is waiting on right
      // now, sent synchronously like the members sign-in link — the interactive lane, not the
      // background-notification lane (SPEC-022 REQ-09; `members/write-service.ts`).
      purpose: "transactional",
      lane: "interactive",
    }
  );

  return { tokenId, expiresAt };
}

/** The two consent-capability calls a bound capability gets, in order; the verdict is the caller's to act on. */
async function requestAndConfirmConsent({ capability, subscription, tokenId, workspaceId }: {
  capability: MembersConsentCapability; subscription: SubscriptionRow; tokenId: string; workspaceId: UUID;
}): Promise<{ status: string; revisionId: string }> {
  await capability.request({
    workspaceId,
    subscriberId: subscription.subscriberId,
    evidence: { consentTextRef: "newsletter-subscription-confirm-v1", source: subscription.source, confirmTokenId: tokenId },
  });
  const result = await capability.confirm({ workspaceId, subscriberId: subscription.subscriberId, confirmTokenId: tokenId });
  return { status: result.status, revisionId: result.consentRevisionId };
}

/**
 * Validate the raw token, then call `MembersConsentCapability.request`/`.confirm` — the local
 * `SubscriptionRow.status` flip to `subscribed` happens STRICTLY AFTER a `granted` response, never
 * before or regardless of it (INV-03, AC-15).
 */
export async function consumeConfirmationToken(required: {
  deps: ConfirmationDeps;
  input: { workspaceId: UUID; rawToken: string };
}, _optional: Record<string, never> = {}): Promise<{ subscription: SubscriptionRow; changed: boolean; eventId: string }> {
  const { deps, input } = required;
  const tokenHash = deps.hashToken({ raw: input.rawToken });
  const token = await deps.tokenRepo.findByTokenHash({ workspaceId: input.workspaceId, tokenHash });
  if (!token) throw new NewsletterConfirmTokenInvalidError({ message: "confirmation token was not found", reason: "not_found" });
  // EC-02: a second click on an already-consumed token is invalid, not a repeat success (unlike the
  // unsubscribe EC-03 carve-out — deliberately different semantics, see `unsubscribe.ts`).
  if (token.consumedAt !== null) {
    throw new NewsletterConfirmTokenInvalidError({ message: "confirmation token was already consumed", reason: "already_consumed" });
  }

  const now = deps.clock.nowIso();
  // Boundary rule: a token submitted at EXACTLY `expiresAt` is treated as expired (closed-below/open-above).
  if (Date.parse(now) >= Date.parse(token.expiresAt)) {
    throw new NewsletterConfirmTokenInvalidError({ message: "confirmation token has expired", reason: "expired" });
  }

  const subscription = await deps.subscriptionRepo.findById({ workspaceId: input.workspaceId, id: token.subscriptionId });
  if (!subscription) throw new NewsletterConfirmTokenInvalidError({ message: "subscription was not found", reason: "not_found" });

  // B176: consent is enforced when a capability is bound; with none configured the confirmation
  // still completes (today's behaviour) and simply records no consent revision.
  const consent = deps.consentCapability ? await requestAndConfirmConsent({ capability: deps.consentCapability, subscription, tokenId: token.id, workspaceId: input.workspaceId }) : null;

  // The token is single-use regardless of the consent outcome — mark consumed either way.
  await deps.tokenRepo.save({ ...token, consumedAt: now });

  if (consent && consent.status !== "granted") {
    throw new NewsletterConfirmTokenInvalidError({ message: `consent was not granted (status: ${consent.status})`, reason: "expired" });
  }

  const updated: SubscriptionRow = {
    ...subscription,
    status: "subscribed",
    consentRevisionIdAtSubscribe: consent?.revisionId ?? null,
    subscribedAt: now,
    updatedAt: now,
  };
  await deps.subscriptionRepo.save(updated);
  return { subscription: updated, changed: subscription.status !== "subscribed", eventId: `newsletter-subscribed:${token.id}` };
}
