import { describe, expect, it } from "vitest";
import { OriginNotVerifiedError } from "@jini-ai/core/contracts/server/verified-origin";
import type { MailerSendOptions, OutboundEmail, PositionalMailer } from "@jini-ai/core/contracts/mail";
import { requestPasswordReset, requestSignInLink } from "../member-challenge-request.js";
import { membersWriteService } from "../write-service.js";
import type { MembersMailTransport, MembersWriteServiceDeps } from "../ports.js";
import { MemberSignInUnavailableError } from "../types.js";
import {
  InMemoryMagicLinkTokenRepo, InMemoryMemberRepo, InMemoryMemberSessionRepo, InMemoryMemberSubscriptionRepo, InMemoryMemberTierRepo,
} from "../repo.memory.js";

type Sent = { message: OutboundEmail; options: MailerSendOptions };

function harness(overrides: { delivering?: boolean; transport?: MembersMailTransport | null; originError?: Error } = {}) {
  const sent: Sent[] = [];
  const senderCalls: unknown[] = [];
  const renderCalls: unknown[] = [];
  let next = 0;
  const mailer: PositionalMailer = {
    capabilities: () => ({ driver: "test", supportsIdempotencyKey: true, supportsWebhookFeedback: false, maxBatchSize: 1 }) as ReturnType<PositionalMailer["capabilities"]>,
    send: async (message, options) => { sent.push({ message, options }); return { ok: true, providerMessageId: "msg-1", acceptedAt: "2026-01-01T00:00:00.000Z" }; },
    sendBatch: async () => [],
  };
  const transport: MembersMailTransport = {
    isDeliveryAvailable: (candidate) => candidate === mailer && overrides.delivering !== false,
    senderIdentityFor: (required, optional) => {
      senderCalls.push({ required, optional });
      return { resolve: async () => ({ email: "hello@site.example", name: "Site" }) };
    },
    renderEmailForSend: ({ html, values }) => {
      renderCalls.push({ html, values });
      return { subject: "Your sign-in link", html: `<p>${values.link}</p>`, text: `${values.link} ${values.code}` };
    },
  };
  const deps: MembersWriteServiceDeps = {
    clock: { nowMs: () => Date.parse("2026-01-01T00:00:00.000Z") } as unknown as MembersWriteServiceDeps["clock"],
    ids: { newId: () => `id-${++next}` } as MembersWriteServiceDeps["ids"],
    members: new InMemoryMemberRepo(),
    tiers: new InMemoryMemberTierRepo(),
    subscriptions: new InMemoryMemberSubscriptionRepo(),
    sessions: new InMemoryMemberSessionRepo(),
    magicLinks: new InMemoryMagicLinkTokenRepo(),
    passwordHasher: { hash: async ({ password }) => `hashed:${password}`, verify: async () => false },
    principals: { save: async () => undefined } as unknown as MembersWriteServiceDeps["principals"],
    mailer,
    origin: { canonicalOrigin: async () => {
      if (overrides.originError) throw overrides.originError;
      return { scheme: "https", host: "site.example" };
    } } as unknown as MembersWriteServiceDeps["origin"],
    senderIdentity: { resolve: async () => ({ email: "configured@site.example" }) },
    mailTransport: overrides.transport === null ? undefined : (overrides.transport ?? transport),
  };
  return { deps, sent, senderCalls, renderCalls, mailer };
}

describe("member challenge request over the injected mail transport", () => {
  it("refuses site-wide before any lookup when the composition binds no mail transport", async () => {
    const h = harness({ transport: null });
    await expect(requestSignInLink({ deps: h.deps, input: { workspaceId: "ws", email: "a@b.example" } }))
      .rejects.toThrow(new MemberSignInUnavailableError("Member sign-in is unavailable: email is not set up for this site."));
    expect(h.sent).toHaveLength(0);
  });

  it("refuses when the transport reports delivery unavailable, sending nothing", async () => {
    const h = harness({ delivering: false });
    await expect(requestSignInLink({ deps: h.deps, input: { workspaceId: "ws", email: "a@b.example" } }))
      .rejects.toBeInstanceOf(MemberSignInUnavailableError);
    expect(h.sent).toHaveLength(0);
    expect(h.renderCalls).toHaveLength(0);
  });

  it("renders through the transport and sends from the resolved sender identity", async () => {
    const h = harness();
    const result = await requestSignInLink({ deps: h.deps, input: { workspaceId: "ws", email: "a@b.example", redirectPath: "/members" } });
    expect(result.delivered).toBe(true);
    expect(h.senderCalls).toEqual([{ required: { mailer: h.mailer }, optional: { senderIdentity: h.deps.senderIdentity } }]);
    expect(h.renderCalls).toHaveLength(1);
    expect(h.sent).toHaveLength(1);
    const [{ message, options }] = h.sent;
    expect(message.from).toEqual({ email: "hello@site.example", name: "Site" });
    expect(message.to).toEqual({ email: "a@b.example" });
    expect(message.subject).toBe("Your sign-in link");
    expect(message.html).toMatch(/^<p>https:\/\/site\.example\/signin#magic=[^&]+&redirect=%2Fmembers<\/p>$/);
    expect(options).toMatchObject({ workspaceId: "ws", purpose: "transactional", lane: "interactive", sourceContext: { module: "members" } });
    expect(options.idempotencyKey).toMatch(/^members:signin:[0-9a-f]+$/);
  });

  it("keeps the unverified-origin refusal and carries the origin error as its cause", async () => {
    const originError = new OriginNotVerifiedError({ message: "no origin" });
    const h = harness({ originError });
    const refusal = await requestSignInLink({ deps: h.deps, input: { workspaceId: "ws", email: "a@b.example" } }).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(MemberSignInUnavailableError);
    expect((refusal as Error).message).toBe("Member sign-in is unavailable: the site address is not set up.");
    expect((refusal as Error).cause).toBe(originError);
    expect(h.sent).toHaveLength(0);
  });

  it("accepts a reset for an unknown address without sending", async () => {
    const h = harness();
    await expect(requestPasswordReset({ deps: h.deps, input: { workspaceId: "ws", email: "nobody@b.example" } })).resolves.toEqual({ accepted: true });
    expect(h.sent).toHaveLength(0);
  });

  it("groups the challenge request into the write service", () => {
    expect(membersWriteService.requestSignInLink).toBe(requestSignInLink);
  });
});
