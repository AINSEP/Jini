import { nowIso as clockNowIso } from "@jini-ai/core/primitives";
import { OriginNotVerifiedError } from "@jini-ai/core/contracts/server/verified-origin";
import { randomInt } from "node:crypto";
import type { MailerSendOptions, OutboundEmail } from "@jini-ai/core/contracts/mail";
import { newChallengeSecrets, hashChallengeCode } from "../server/auth-challenge.js";
import { renderMemberAuthMail } from "./auth-mail.js";
import { MemberSignInUnavailableError } from "./types.js";
import type { MembersMailTransport, MembersWriteServiceDeps } from "./ports.js";
import { memberPasswordHasher, memberSessionTokens } from "./member-credentials.js";
import { saveMemberChallenge } from "./member-challenge.js";
import { assertValidEmail } from "./member-validation.js";

/** Placeholder From for a non-delivering mailer; real providers get the site's configured sender. */
const MEMBERS_FALLBACK_SENDER = { email: "no-reply@members.local", name: "Members" } as const;

/**
 * Builds an absolute link from trusted origin evidence, never request headers.
 * Missing/unverified evidence refuses sign-in for every address before repository writes.
 * @throws MemberSignInUnavailableError when the site origin is not configured.
 * @complexity O(1) — one canonical-origin read.
 */
async function resolveSignInLinkPath(required: {
  deps: MembersWriteServiceDeps;
  workspaceId: string;
  relativePath: string;
}, _options: Record<string, never> = {}): Promise<string> {
  const { deps, workspaceId, relativePath } = required;
  if (!deps.origin) throw new MemberSignInUnavailableError("Member sign-in is unavailable: the site address is not set up.");
  try {
    const origin = await deps.origin.canonicalOrigin({ workspaceId });
    const portSuffix = origin.port ? `:${origin.port}` : "";
    const basePath = origin.basePath ?? "";
    return `${origin.scheme}://${origin.host}${portSuffix}${basePath}${relativePath}`;
  } catch (err) {
    if (!(err instanceof OriginNotVerifiedError)) throw err;
    throw new MemberSignInUnavailableError("Member sign-in is unavailable: the site address is not set up.", { cause: err });
  }
}

/**
 * Checks site-wide mail readiness before any address lookup. Sender resolution settles lazy
 * configuration first; transactional readiness is independent of the bulk lane.
 * @throws MemberSignInUnavailableError for an unconfigured/non-delivering transactional lane.
 * @complexity O(1) status read and capabilities check; no per-address I/O.
 */
async function requireSignInMail(required: { deps: MembersWriteServiceDeps; transport: MembersMailTransport }, _options: Record<string, never> = {}): Promise<void> {
  const { deps, transport } = required;
  const status = await deps.mailStatus?.();
  const transactional = status?.lanes.find(lane => lane.lane === "transactional");
  if ((status && transactional?.state !== "ready") || !transport.isDeliveryAvailable(deps.mailer)) {
    throw new MemberSignInUnavailableError("Member sign-in is unavailable: email is not set up for this site.");
  }
}

/**
 * The host binds its mail transport into the deps; without one no challenge mail can be sent, so
 * every address gets the same site-wide refusal before any lookup.
 * @throws MemberSignInUnavailableError when the composition supplied no mail transport.
 * @complexity O(1).
 */
function requireMailTransport(required: { deps: MembersWriteServiceDeps }, _options: Record<string, never> = {}): MembersMailTransport {
  const transport = required.deps.mailTransport;
  if (!transport) throw new MemberSignInUnavailableError("Member sign-in is unavailable: email is not set up for this site.");
  return transport;
}

/**
 * Only local absolute paths survive; controls/backslashes can change browser URL parsing, and an
 * encoded slash/backslash becomes `//host` if any later hop decodes the path before redirecting.
 */
function safeRedirectPath(_required = {}, { path }: { path?: string } = {}): string | undefined {
  return path && /^\/(?!\/)/.test(path) && !/[\\\x00-\x1f\x7f]|%(2f|5c)/i.test(path) ? path : undefined;
}

/** Fragment-only secrets prevent accidental consumption and disclosure through GET request logs. */
function challengeLinkPath(required: {
  purpose: "signin" | "password_reset"; token: string; redirectPath?: string;
}, _options = {}): string {
  const { purpose, token, redirectPath } = required;
  if (purpose === "password_reset") return `/reset-password#token=${token}`;
  const redirect = safeRedirectPath({}, { path: redirectPath });
  const redirectSuffix = redirect ? `&redirect=${encodeURIComponent(redirect)}` : "";
  return `/signin#magic=${token}${redirectSuffix}`;
}

/**
 * Issue sign-in or link-only reset through the same mail/readiness and challenge lifecycle.
 * Ineligible addresses receive a fresh, unstored handle; requests never create members.
 * Preparation checks site setup; deliver() owns all per-address work.
 * Secrets enter only the rendered send payload, never a profile, repo row or idempotency key.
 * @throws MemberSignInUnavailableError for site-wide setup; validation/adapter errors propagate.
 * @complexity O(1) reads/writes and one bounded password hash for sign-in codes.
 */
export async function prepareMemberChallenge(required: {
  deps: MembersWriteServiceDeps;
  input: { workspaceId: string; email: string; redirectPath?: string };
  purpose: "signin" | "password_reset";
}, _options = {}): Promise<{ challengeId: string; deliver: () => Promise<{ delivered: boolean; challengeId: string }> }> {
  const { deps, input, purpose } = required;
  const email = assertValidEmail({ email: input.email });
  const nowIso = clockNowIso({ clock: deps.clock });
  const transport = requireMailTransport({ deps });
  // Resolved before the member lookup: a missing sender must fail the same way for every address,
  // so the error itself never tells a caller which emails are registered, and no token is minted
  // for a link that could not be sent.
  const from = await transport.senderIdentityFor({ mailer: deps.mailer }, { senderIdentity: deps.senderIdentity })
    .resolve({ workspaceId: input.workspaceId, fallback: MEMBERS_FALLBACK_SENDER });
  await requireSignInMail({ deps, transport });
  const secrets = newChallengeSecrets({ tokens: memberSessionTokens, randomInt: ({ min, max }) => randomInt(min, max) });
  const relativePath = challengeLinkPath({ purpose, token: secrets.token, redirectPath: input.redirectPath });
  // ADR-040 owns origin evidence. Resolve before the address lookup so a setup error cannot
  // distinguish an existing/disabled address, and never store a token for a relative link.
  const link = await resolveSignInLinkPath({ deps, workspaceId: input.workspaceId, relativePath });
  const challengeId = deps.ids.newId();
  // Public HTTP can acknowledge setup now; every address-dependent effect stays in deliver().
  return { challengeId, deliver: async () => {
    // Hash before the lookup: ineligible addresses return early, and the Argon2 cost must not tell.
    const codeHash = purpose === "signin"
      ? await hashChallengeCode({ code: secrets.code, hasher: memberPasswordHasher({ deps }) }) : null;
    const member = await deps.members.findByEmail({ workspaceId: input.workspaceId, email });
    if (member?.status === "disabled" || member?.status === "trash") return { delivered: false, challengeId };
    if (purpose === "password_reset" && !member) return { delivered: false, challengeId };
    await saveMemberChallenge({ deps, member, email, purpose, challengeId, nowIso,
      tokenHash: secrets.tokenHash, codeHash, workspaceId: input.workspaceId });
    const message: OutboundEmail = { workspaceId: input.workspaceId, to: { email }, from,
      ...renderMemberAuthMail({ purpose, link, code: secrets.code, renderEmailForSend: transport.renderEmailForSend }) };
    const sendOptions: MailerSendOptions = {
      // Reuse the sign_in activity/capture-redaction prefix for reset mail too.
      idempotencyKey: `members:signin:${purpose === "password_reset" ? "reset:" : ""}${secrets.tokenHash}`,
      workspaceId: input.workspaceId, sourceContext: { module: "members" }, purpose: "transactional",
      // Interactive auth mail proceeds without a durable outbox (SPEC-022 REQ-09).
      lane: "interactive",
    };
    const result = await deps.mailer.send(message, sendOptions);
    return { delivered: result.ok && !result.providerMessageId.startsWith("captured:"), challengeId };
  } };
}

/** Existing callers retain the awaited delivery contract; public HTTP uses the same prepared owner. */
export async function requestMemberChallenge(required: Parameters<typeof prepareMemberChallenge>[0], _options = {}): Promise<{ delivered: boolean; challengeId: string }> {
  const prepared = await prepareMemberChallenge(required);
  return prepared.deliver();
}

/** Request a link and six-digit code sharing one single-use challenge; O(1) adapter calls. */
export async function requestSignInLink(required: {
  deps: MembersWriteServiceDeps;
  input: { workspaceId: string; email: string; redirectPath?: string };
}, _options = {}): Promise<{ delivered: boolean; challengeId: string }> {
  return requestMemberChallenge({ ...required, purpose: "signin" });
}

/**
 * Request a link-only reset for an existing eligible member; never reveal per-address outcomes.
 * Reuses the sign-in mail setup checks and interactive lane. No member is created.
 * @throws MemberSignInUnavailableError for site-wide mail/origin setup errors.
 * @complexity O(1) adapter calls.
 */
export async function requestPasswordReset(required: {
  deps: MembersWriteServiceDeps; input: { workspaceId: string; email: string };
}, _options = {}): Promise<{ accepted: true }> {
  await requestMemberChallenge({ ...required, purpose: "password_reset" });
  return { accepted: true };
}
