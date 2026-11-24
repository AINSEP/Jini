import { orFallbackSync } from "@jini-ai/core/errors/idioms";
import { describe, expect, it } from "vitest";
import type { PositionalMailer } from "@jini-ai/core/contracts/mail";
import { requestLoginEmailProof, type MemberLoginLinkDeps } from "../link-service.js";
import { MemberLoginError } from "../../server/login-types.js";
import type { MembersMailTransport } from "../../members/ports.js";
import {
  InMemoryMagicLinkTokenRepo, InMemoryMemberExternalIdentityRepo, InMemoryMemberRepo, InMemoryMemberSessionRepo,
  InMemoryMemberSubscriptionRepo, InMemoryMemberTierRepo,
} from "../../members/repo.memory.js";

const mailFailure = new Error("smtp relay refused: AUTH user=owner@site.example pass=secret");

function harness() {
  const reports: { operation: string; error: unknown }[] = [];
  let next = 0;
  const mailer: PositionalMailer = {
    capabilities: () => ({ driver: "test", supportsIdempotencyKey: true, supportsWebhookFeedback: false, maxBatchSize: 1 }) as ReturnType<PositionalMailer["capabilities"]>,
    send: async () => { throw mailFailure; },
    sendBatch: async () => [],
  };
  const mailTransport: MembersMailTransport = {
    isDeliveryAvailable: candidate => candidate === mailer,
    senderIdentityFor: () => ({ resolve: async () => ({ email: "hello@site.example", name: "Site" }) }),
    renderEmailForSend: ({ values }) => ({ subject: "Your sign-in link", html: `<p>${values.link}</p>`, text: `${values.link} ${values.code}` }),
  };
  const deps: MemberLoginLinkDeps = {
    orFallbackSync,
    clock: { nowMs: () => Date.parse("2026-01-01T00:00:00.000Z") } as unknown as MemberLoginLinkDeps["clock"],
    ids: { newId: () => `id-${++next}` } as MemberLoginLinkDeps["ids"],
    members: new InMemoryMemberRepo(), tiers: new InMemoryMemberTierRepo(), subscriptions: new InMemoryMemberSubscriptionRepo(),
    sessions: new InMemoryMemberSessionRepo(), magicLinks: new InMemoryMagicLinkTokenRepo(), identities: new InMemoryMemberExternalIdentityRepo({}),
    passwordHasher: { hash: async ({ password }) => `hashed:${password}`, verify: async () => false },
    principals: { save: async () => undefined } as unknown as MemberLoginLinkDeps["principals"],
    mailer,
    origin: { canonicalOrigin: async () => ({ scheme: "https", host: "site.example" }) } as unknown as MemberLoginLinkDeps["origin"],
    senderIdentity: { resolve: async () => ({ email: "configured@site.example" }) },
    mailTransport,
    transaction: async run => run(),
    lockKey: async () => undefined,
    reportFailure: report => { reports.push(report); },
  };
  return { deps, reports };
}

describe("requestLoginEmailProof failure reporting", () => {
  it("throws the fixed LOGIN_UNAVAILABLE error with no cause when mail delivery fails", async () => {
    const { deps } = harness();
    const thrown = await requestLoginEmailProof({ deps, input: { workspaceId: "ws", email: "person@site.example" } }).then(() => null, (error: unknown) => error);
    expect(thrown).toBeInstanceOf(MemberLoginError);
    expect((thrown as MemberLoginError).code).toBe("LOGIN_UNAVAILABLE");
    expect((thrown as Error).cause).toBeUndefined();
    expect((thrown as Error).message).not.toContain("secret");
  });

  it("hands the original error to the host's private reporter", async () => {
    const { deps, reports } = harness();
    await expect(requestLoginEmailProof({ deps, input: { workspaceId: "ws", email: "person@site.example" } })).rejects.toBeInstanceOf(MemberLoginError);
    expect(reports).toEqual([{ operation: "member-login:request-email-proof", error: mailFailure }]);
  });
});
