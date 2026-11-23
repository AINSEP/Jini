import { ToolInputError } from "@jini-ai/core";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";
import { describe, expect, it } from "vitest";
import { mailTestSendRoute, type MailTestSendOutcome, type MailTestSendRouteDeps } from "../mail-test-send.js";
import { PRINCIPAL, raw, recordingAuthorize, refusalOf, signal } from "./mail-test-helpers.js";

const ACCEPTED: MailTestSendOutcome = { outcome: "accepted" };
const BODY_ERROR = "the request body must be a JSON object. Nothing was sent.";

type Sent = { principalId: string; to?: string; ref: string };

function makeDeps(overrides: Partial<MailTestSendRouteDeps> = {}): MailTestSendRouteDeps & { sent: Sent[] } {
  const sent: Sent[] = [];
  return {
    readTestRecipient: ({ value }) => (value === undefined ? undefined : String(value)),
    newRequestId: () => "generated-id",
    sendTestMail: async (required) => { sent.push(required); return ACCEPTED; },
    sent,
    ...overrides,
  };
}

const call = (deps: MailTestSendRouteDeps, input: { to?: unknown; requestId?: unknown } = {}, authorize = recordingAuthorize().authorize) =>
  mailTestSendRoute.handle({ input: { to: undefined, requestId: undefined, ...input }, deps, context: PRINCIPAL, authorize }, { signal });

describe("mailTestSendRoute", () => {
  it("keeps the method, path and status, with no body cap of its own", () => {
    expect([mailTestSendRoute.method, mailTestSendRoute.path]).toEqual(["post", "/api/admin/v1/workspaces/:workspaceId/system/mail-test-send"]);
    expect(mailTestSendRoute.successStatus).toBeUndefined();
    expect(mailTestSendRoute.maxBodyBytes).toBeUndefined();
  });

  it("parses the body's to and requestId untouched, and a missing body as no fields", () => {
    expect(mailTestSendRoute.parse(raw({ body: { to: "a@b.co", requestId: "abcdefgh", extra: 1 } }))).toEqual({ ok: true, value: { to: "a@b.co", requestId: "abcdefgh" } });
    expect(mailTestSendRoute.parse(raw({ body: undefined }))).toEqual({ ok: true, value: { to: undefined, requestId: undefined } });
    expect(mailTestSendRoute.parse(raw({ body: null }))).toEqual({ ok: true, value: { to: undefined, requestId: undefined } });
  });

  it.each([["an array", []], ["a string", "x"], ["a number", 3]])("refuses %s body with a 400 INVALID_INPUT before anything else", async (_label, body) => {
    expect(await refusalOf(() => mailTestSendRoute.parse(raw({ body })))).toEqual({ status: 400, body: { error: BODY_ERROR, code: "INVALID_INPUT" } });
  });

  it("authorizes admin.forms.manage on the mail entity type, with no entity id", async () => {
    const { authorize, calls } = recordingAuthorize();
    await call(makeDeps(), {}, authorize);
    expect(calls).toEqual([{ permission: "admin.forms.manage", entityType: "mail" }]);
  });

  it("sends nothing when authorization refuses", async () => {
    const deps = makeDeps();
    await expect(call(deps, {}, recordingAuthorize(["admin.forms.manage"]).authorize)).rejects.toThrow("denied");
    expect(deps.sent).toEqual([]);
  });

  it("answers sent:true for accepted and redirected, sent:false for the rest, always 200", async () => {
    const answer = async (outcome: MailTestSendOutcome) => (await call(makeDeps({ sendTestMail: async () => outcome }))) as { ok: true; value: { sent: boolean; result: unknown } };
    expect((await answer({ outcome: "accepted" })).value).toEqual({ sent: true, result: { outcome: "accepted" } });
    expect((await answer({ outcome: "redirected" })).value.sent).toBe(true);
    expect((await answer({ outcome: "captured" })).value.sent).toBe(false);
    expect((await answer({ outcome: "unknown", errorCode: "X" })).value.sent).toBe(false);
    expect((await answer({ outcome: "failed", errorCode: "PROVIDER_REJECTED" })).value).toEqual({ sent: false, result: { outcome: "failed", errorCode: "PROVIDER_REJECTED" } });
  });

  it.each(["MAIL_TEST_DUPLICATE", "MAIL_TEST_RATE_LIMITED"])("answers a local %s refusal with 429 and the same body", async (errorCode) => {
    const result = { outcome: "failed", errorCode };
    const error = await Promise.resolve(call(makeDeps({ sendTestMail: async () => result }))).then(() => undefined, (e: unknown) => e);
    expect(error).toBeInstanceOf(RouteRefusalError);
    expect((error as RouteRefusalError).response).toEqual({ status: 429, body: { sent: false, result } });
  });

  it("does not answer 429 for a local refusal code on a non-failed outcome", async () => {
    const outcome = { outcome: "accepted", errorCode: "MAIL_TEST_DUPLICATE" };
    expect(await call(makeDeps({ sendTestMail: async () => outcome }))).toEqual({ ok: true, value: { sent: true, result: outcome } });
  });

  it("sends as the principal with the ref admin:<principal>:<requestId>, and the chosen recipient only when given", async () => {
    const deps = makeDeps();
    await call(deps, { to: "ops@example.com", requestId: "abcdefgh" });
    await call(deps, { requestId: "abcdefgh" });
    expect(deps.sent).toEqual([
      { principalId: "principal-1", to: "ops@example.com", ref: "admin:principal-1:abcdefgh" },
      { principalId: "principal-1", ref: "admin:principal-1:abcdefgh" },
    ]);
    expect(Object.keys(deps.sent[1]!)).not.toContain("to");
  });

  it("uses the injected id generator when the click sent no requestId", async () => {
    const deps = makeDeps({ newRequestId: () => "from-the-host" });
    await call(deps);
    expect(deps.sent[0]?.ref).toBe("admin:principal-1:from-the-host");
  });

  it.each(["short", "x".repeat(65), "has space!", 12345, null])("refuses requestId %j with a 400 before authorizing", async (requestId) => {
    const { authorize, calls } = recordingAuthorize();
    const deps = makeDeps();
    expect(await refusalOf(() => call(deps, { requestId }, authorize))).toEqual({
      status: 400, body: { error: "requestId must be 8-64 letters, digits, '-' or '_'. Nothing was sent.", code: "INVALID_INPUT" },
    });
    expect(calls).toEqual([]);
    expect(deps.sent).toEqual([]);
  });

  it("accepts the 8 and 64 character requestId bounds", async () => {
    const deps = makeDeps();
    await call(deps, { requestId: "a_b-1234" });
    await call(deps, { requestId: "z".repeat(64) });
    expect(deps.sent).toHaveLength(2);
  });

  it("refuses a bad recipient with a 400 before authorizing, and reads it before the requestId", async () => {
    const { authorize, calls } = recordingAuthorize();
    const readTestRecipient = () => { throw new ToolInputError({ message: "to must be one email address. Nothing was sent." }); };
    const deps = makeDeps({ readTestRecipient });
    expect(await refusalOf(() => call(deps, { to: "nope", requestId: "bad" }, authorize))).toEqual({
      status: 400, body: { error: "to must be one email address. Nothing was sent.", code: "INVALID_INPUT" },
    });
    expect(calls).toEqual([]);
  });

  it("answers a caller error raised while sending as a 400 INVALID_INPUT", async () => {
    const deps = makeDeps({ sendTestMail: async () => { throw new ToolInputError({ message: "Your account has no email address." }); } });
    expect(await refusalOf(() => call(deps))).toEqual({ status: 400, body: { error: "Your account has no email address.", code: "INVALID_INPUT" } });
  });

  it("rethrows an unexpected fault unchanged for the host's 500", async () => {
    await expect(call(makeDeps({ sendTestMail: async () => { throw new Error("smtp exploded"); } }))).rejects.toThrow("smtp exploded");
  });

  it("fails closed without an authorizer or a principal", async () => {
    await expect(mailTestSendRoute.handle({ input: { to: undefined, requestId: undefined }, deps: makeDeps(), context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
    await expect(mailTestSendRoute.handle({ input: { to: undefined, requestId: undefined }, deps: makeDeps(), authorize: recordingAuthorize().authorize })).rejects.toThrow(/no authenticated principal/);
  });
});
