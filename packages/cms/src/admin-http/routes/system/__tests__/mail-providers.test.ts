import { describe, expect, it } from "vitest";
import {
  mailProviderActivateRoute, mailProviderCredentialPlanRoute, mailProviderRefusal, mailProvidersListRoute,
  type MailProviderFailure, type MailProviderActivateRouteDeps, type MailProviderCredentialPlanRouteDeps, type MailProvidersListRouteDeps,
} from "../mail-providers.js";
import { PRINCIPAL, raw, recordingAuthorize, refusalOf, signal, WORKSPACE_ID } from "./mail-test-helpers.js";

/** @file The mail-provider route specs: the configuration read, the credential plan and the re-checked switch. */

class OperationError extends Error { constructor(readonly code: string, message: string) { super(message); } }
class StoreError extends Error { constructor(readonly code: string) { super(`secret-${code}`); } }

/** The host classifier these fakes stand in for: its own error classes, as the spec's failures. */
function classify(error: unknown): MailProviderFailure | undefined {
  if (error instanceof OperationError) return { kind: "operation", code: error.code as never, message: error.message };
  if (error instanceof StoreError) return { kind: "store", code: error.code as never };
  return undefined;
}

type AllDeps = MailProvidersListRouteDeps & MailProviderCredentialPlanRouteDeps & MailProviderActivateRouteDeps;

function makeDeps(overrides: Partial<AllDeps> = {}): AllDeps & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    workspaceId: WORKSPACE_ID,
    classifyMailProviderError: classify,
    readMailProviderConfigurations: async () => { calls.push("read"); return { providers: [] }; },
    planMailProviderCredential: async (required) => { calls.push(["plan", required]); return { mode: "create" }; },
    activateMailProvider: async (required) => { calls.push(["activate", required]); return { activated: true }; },
    calls,
    ...overrides,
  };
}

const BASE = "/api/admin/v1/workspaces/:workspaceId/system/mail-providers";
const ROUTES = [
  [mailProvidersListRoute, "get", BASE, "admin.forms.manage"],
  [mailProviderCredentialPlanRoute, "get", `${BASE}/:providerId/credential`, "custom-credentials.write"],
  [mailProviderActivateRoute, "post", `${BASE}/:providerId/activate`, "settings.workspace.write"],
] as const;

async function run(index: number, deps: AllDeps, optional: { authorize?: ReturnType<typeof recordingAuthorize>["authorize"]; providerId?: string } = {}) {
  const route = ROUTES[index]![0] as typeof mailProviderActivateRoute;
  const parsed = route.parse(raw({ params: { providerId: optional.providerId ?? "fakemail" } }));
  if (!parsed.ok) throw new Error("parse refused");
  return route.handle({ input: parsed.value, deps, context: PRINCIPAL, authorize: optional.authorize ?? recordingAuthorize().authorize }, { signal });
}

describe("mail-provider route specs", () => {
  it.each(ROUTES.map((row, index) => [index, row[1], row[2]] as const))("route %i keeps %s %s, status 200 and no body cap", (index, method, path) => {
    const route = ROUTES[index]![0];
    expect([route.method, route.path, route.successStatus, route.maxBodyBytes]).toEqual([method, path, undefined, undefined]);
  });

  it("reads the provider id verbatim, a missing one as the String() of undefined", () => {
    expect(mailProviderCredentialPlanRoute.parse(raw({ params: { providerId: "fakemail" } }))).toEqual({ ok: true, value: { providerId: "fakemail" } });
    expect(mailProviderActivateRoute.parse(raw())).toEqual({ ok: true, value: { providerId: "undefined" } });
    expect(mailProvidersListRoute.parse(raw())).toEqual({ ok: true, value: {} });
  });

  it.each(ROUTES.map((row, index) => [index, row[3]] as const))("route %i asks %s on the mail entity type, with no entity id", async (index, permission) => {
    const recorder = recordingAuthorize();
    await run(index, makeDeps(), { authorize: recorder.authorize });
    expect(recorder.calls).toEqual([{ permission, entityType: "mail" }]);
  });

  it.each(ROUTES.map((row, index) => [index, row[3]] as const))("route %i touches no operation when %s is refused", async (index, permission) => {
    const deps = makeDeps();
    await expect(run(index, deps, { authorize: recordingAuthorize([permission]).authorize })).rejects.toThrow(`denied ${permission}`);
    expect(deps.calls).toEqual([]);
  });

  it("answers each operation's result unchanged, handing it the provider id and the acting principal", async () => {
    const deps = makeDeps();
    expect(await run(0, deps)).toEqual({ ok: true, value: { providers: [] } });
    expect(await run(1, deps, { providerId: "p1" })).toEqual({ ok: true, value: { mode: "create" } });
    expect(await run(2, deps, { providerId: "p2" })).toEqual({ ok: true, value: { activated: true } });
    expect(deps.calls).toEqual(["read", ["plan", { providerId: "p1" }], ["activate", { providerId: "p2", principalId: PRINCIPAL.id }]]);
  });

  it.each([
    ["MAIL_PROVIDER_CONTROL_UNAVAILABLE", 503], ["MAIL_PROVIDER_NOT_FOUND", 404], ["MAIL_PROVIDER_KEYLESS", 409],
    ["MAIL_PROVIDER_REFUSED", 409], ["MAIL_PROVIDER_INPUT", 400], ["MAIL_PROVIDER_CHANGED", 409],
  ] as const)("an operation refusal %s answers %i with its own message and code", async (code, status) => {
    const deps = makeDeps({ activateMailProvider: async () => { throw new OperationError(code, `said ${code}`); } });
    expect(await refusalOf(() => run(2, deps))).toEqual({ status, body: { error: `said ${code}`, code } });
  });

  it.each([["VALIDATION", 400], ["DUPLICATE_LABEL", 409], ["NOT_FOUND", 404], ["SECRET_STORE_UNCONFIGURED", 503]] as const)(
    "a credential-store refusal %s answers %i with only its code, never the error's text", async (code, status) => {
      const deps = makeDeps({ planMailProviderCredential: async () => { throw new StoreError(code); } });
      expect(await refusalOf(() => run(1, deps))).toEqual({ status, body: { error: code, code } });
    },
  );

  it("rethrows an unclassified failure unchanged (the host's redacted 500)", async () => {
    const deps = makeDeps({ readMailProviderConfigurations: async () => { throw new Error("catalog exploded"); } });
    await expect(run(0, deps)).rejects.toThrow("catalog exploded");
  });

  it("maps a failure to the same answer for the host's hand-written credential save", () => {
    expect(mailProviderRefusal({ kind: "operation", code: "MAIL_PROVIDER_INPUT", message: "token must be a string." }))
      .toEqual({ status: 400, body: { error: "token must be a string.", code: "MAIL_PROVIDER_INPUT" } });
    expect(mailProviderRefusal({ kind: "store", code: "DUPLICATE_LABEL" })).toEqual({ status: 409, body: { error: "DUPLICATE_LABEL", code: "DUPLICATE_LABEL" } });
  });

  it("fails closed without an authorizer or an authenticated principal", async () => {
    const parsed = { providerId: "fakemail" };
    await expect(mailProvidersListRoute.handle({ input: {}, deps: makeDeps(), context: PRINCIPAL }, { signal })).rejects.toThrow(/no authorizer/);
    await expect(mailProviderActivateRoute.handle({ input: parsed, deps: makeDeps(), context: undefined, authorize: recordingAuthorize().authorize }, { signal }))
      .rejects.toThrow(/no authenticated principal/);
  });
});
