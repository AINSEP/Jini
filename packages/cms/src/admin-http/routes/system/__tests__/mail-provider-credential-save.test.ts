import { describe, expect, it } from "vitest";
import { ok, type RouteInputContext } from "@jini-ai/core/contracts/server";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";
import { mailProviderCredentialSaveRoute, type MailProviderCredentialSaveRouteDeps } from "../mail-providers.js";

/** @file `PUT …/system/mail-providers/:providerId/credential`: authorize first, only the owner's human
 * session may replace a shared key, non-string parts are refused, and no secret is ever echoed. */

const signal = new AbortController().signal;
const OWNER = "owner-1";
class StoreRefusal extends Error {}
type Saved = { providerId: string; input: unknown; allowSharedKeyReplacement: boolean };

function deps(over: Partial<MailProviderCredentialSaveRouteDeps> & { kind?: unknown; saved?: Saved[]; ownerReads?: string[] } = {}): MailProviderCredentialSaveRouteDeps {
  const saved = over.saved ?? [];
  return {
    workspaceId: "ws-1",
    classifyMailProviderError: ({ error }) => error instanceof StoreRefusal ? { kind: "store", code: "VALIDATION" } : undefined,
    requestCredentialKind: () => over.kind,
    ownerPrincipalId: async () => { over.ownerReads?.push("read"); return OWNER; },
    saveMailProviderCredential: async (args) => { saved.push(args as Saved); return { id: args.providerId, credential: { saved: true } }; },
    ...over,
  };
}
async function call(d: MailProviderCredentialSaveRouteDeps, { body, principal = OWNER, authorize = async () => {} }: { body?: unknown; principal?: string; authorize?: (args: { permission: string; entityType?: string }) => Promise<void> } = {}) {
  const raw: RouteInputContext = { body, query: {}, params: { workspaceId: "ws-1", providerId: "fakemail" }, headers: {} };
  const parsed = mailProviderCredentialSaveRoute.parse(raw) as { ok: true; value: unknown };
  return (mailProviderCredentialSaveRoute.handle as (r: unknown, o: unknown) => Promise<unknown>)({ input: parsed.value, deps: d, raw, context: { id: principal }, authorize }, { signal });
}
async function refusal(promise: Promise<unknown>): Promise<RouteRefusalError> {
  const error = await promise.then(() => undefined, (e: unknown) => e);
  expect(error).toBeInstanceOf(RouteRefusalError);
  return error as RouteRefusalError;
}

describe("mailProviderCredentialSaveRoute", () => {
  it("pins method and path", () => {
    expect(mailProviderCredentialSaveRoute.method).toBe("put");
    expect(mailProviderCredentialSaveRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/system/mail-providers/:providerId/credential");
  });

  it("SECURITY: a missing permission stops before the owner lookup, the body or the save", async () => {
    const saved: Saved[] = [], ownerReads: string[] = [], asked: unknown[] = [];
    const denied = new RouteRefusalError({ status: 403, body: { error: "denied" } });
    await expect(call(deps({ kind: "session", saved, ownerReads }), { body: { token: 5 }, authorize: async (args) => { asked.push(args); throw denied; } })).rejects.toBe(denied);
    expect(asked).toEqual([{ permission: "custom-credentials.write", entityType: "mail" }]);
    expect(saved).toEqual([]);
    expect(ownerReads).toEqual([]);
  });

  it("saves the string parts and lets only the owner's human session replace a shared key", async () => {
    const saved: Saved[] = [];
    expect(await call(deps({ kind: "session", saved }), { body: { token: "k", username: "u", baseUrl: "https://m", extra: 1 } }))
      .toEqual(ok({ value: { provider: { id: "fakemail", credential: { saved: true } } } }));
    expect(saved).toEqual([{ providerId: "fakemail", input: { token: "k", username: "u", baseUrl: "https://m" }, allowSharedKeyReplacement: true }]);
  });

  it("SECURITY: the owner through any other credential kind, or another principal's session, may not replace a shared key", async () => {
    const saved: Saved[] = [], ownerReads: string[] = [];
    await call(deps({ kind: "api-key", saved, ownerReads }), { body: { token: "k" } });
    await call(deps({ kind: undefined, saved, ownerReads }), { body: { token: "k" } });
    await call(deps({ kind: "session", saved }), { body: { token: "k" }, principal: "editor-2" });
    expect(saved.map((s) => s.allowSharedKeyReplacement)).toEqual([false, false, false]);
    // The owner id is read only for a session, as the hand-written `&&` did.
    expect(ownerReads).toEqual([]);
  });

  it("refuses a non-string part with the input refusal and saves nothing; a non-object body is an empty input", async () => {
    const saved: Saved[] = [];
    const refused = await refusal(call(deps({ kind: "session", saved }), { body: { token: "k", username: 7 } }));
    expect(refused.response).toEqual({ status: 400, body: { error: "username must be a string.", code: "MAIL_PROVIDER_INPUT" } });
    expect(saved).toEqual([]);
    for (const body of [undefined, null, ["k"], "k"]) await call(deps({ kind: "session", saved }), { body });
    expect(saved.map((s) => s.input)).toEqual([{}, {}, {}, {}]);
  });

  it("SECURITY: a store refusal answers its code only, never the error text carrying the secret", async () => {
    const d = deps({ kind: "session", saveMailProviderCredential: async () => { throw new StoreRefusal("token sk-live-SECRET rejected"); } });
    const refused = await refusal(call(d, { body: { token: "sk-live-SECRET" } }));
    expect(refused.response).toEqual({ status: 400, body: { error: "VALIDATION", code: "VALIDATION" } });
    expect(JSON.stringify(refused.response)).not.toContain("SECRET");
  });

  it("leaves an unexpected failure to the host's error port", async () => {
    const boom = new Error("vault down");
    await expect(call(deps({ kind: "session", saveMailProviderCredential: async () => { throw boom; } }), { body: { token: "k" } })).rejects.toBe(boom);
  });
});
