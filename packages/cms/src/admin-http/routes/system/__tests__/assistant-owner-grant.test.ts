import { describe, expect, it } from "vitest";

import { createOwnerGrantRoutes, type AssistantOwnerGrantRouteDeps, type OwnerGrantPolicy } from "../assistant-owner-grant.js";
import { FENCE, PRINCIPAL, baseDeps, invoke, recordingAuthorize, refusalOf, signal } from "../../settings/__tests__/helpers.js";

type Grant = { enabled: boolean; ids: string[] };
const NOW = "2026-01-01T00:00:00.000Z";

/** One owner-grant route pair over a recording writer; `policy` overrides the test policy's fields. */
function fixture({ previous = false, owner = PRINCIPAL.id, policy = {} }: { previous?: boolean; owner?: string; policy?: Partial<OwnerGrantPolicy<Grant>> } = {}) {
  const writes: Array<{ input: Record<string, unknown>; optional: unknown }> = [];
  let parses = 0;
  const deps: AssistantOwnerGrantRouteDeps = {
    ...baseDeps(), ownerPrincipalId: Promise.resolve(owner), clock: { nowIso: () => NOW },
    writeSetting: async ({ input }, optional = {}) => { writes.push({ input: { ...input }, optional }); return { revisionSeq: 40 + writes.length }; },
  };
  const routes = createOwnerGrantRoutes<Grant>({ path: "/grant", policy: {
    namespace: "test.grant", key: "policy", writeReason: "TEST owner only", validationError: "TEST invalid grant",
    read: async () => ({ enabled: previous, ids: [] }),
    parse: ({ body }) => { parses++; return { enabled: body.enabled as boolean, ids: ["a"] }; },
    value: ({ settings }) => ({ enabled: settings.enabled, ids: settings.ids }),
    ...policy,
  } });
  return { deps, routes, writes, parses: () => parses };
}

describe("owner-grant route factory", () => {
  it("pins GET and PUT on the given path", () => {
    const { routes } = fixture();
    expect([routes.get, routes.put].map((r) => [r.method, r.path])).toEqual([["get", "/grant"], ["put", "/grant"]]);
  });

  it("GET: visible to every principal; canEdit is ownership unless the policy projects it", async () => {
    const auth = recordingAuthorize();
    const owner = fixture();
    expect(await invoke(owner.routes.get, { deps: owner.deps, authorize: auth.authorize })).toEqual({ enabled: false, ids: [], canEdit: true });
    const admin = fixture({ owner: "someone-else" });
    expect(await invoke(admin.routes.get, { deps: admin.deps, authorize: auth.authorize })).toEqual({ enabled: false, ids: [], canEdit: false });
    const projected = fixture({ policy: { projectRead: ({ settings, isOwner }) => ({ ...settings, ids: [String(isOwner)] }), canEdit: () => false } });
    expect(await invoke(projected.routes.get, { deps: projected.deps })).toEqual({ enabled: false, ids: ["true"], canEdit: false });
    expect(auth.calls).toEqual([]);
  });

  it("PUT: a non-owner is 403 before the body; an uneditable grant is 403 with its copy; malformed bodies are 400 before parse", async () => {
    const admin = fixture({ owner: "someone-else" });
    expect(await refusalOf(() => invoke(admin.routes.put, { deps: admin.deps, body: null }))).toEqual({ status: 403, body: { error: "TEST owner only", code: "FORBIDDEN" } });
    const locked = fixture({ policy: { canEdit: () => false, uneditableError: "TEST not here" } });
    expect(await refusalOf(() => invoke(locked.routes.put, { deps: locked.deps, body: { enabled: true } }))).toEqual({ status: 403, body: { error: "TEST not here", code: "FORBIDDEN" } });
    const f = fixture();
    const auth = recordingAuthorize();
    for (const body of [null, undefined, [], {}, { enabled: "true" }]) {
      expect(await refusalOf(() => invoke(f.routes.put, { deps: f.deps, body, authorize: auth.authorize }))).toEqual({ status: 400, body: { error: "TEST invalid grant", code: "VALIDATION_ERROR" } });
    }
    expect([f.parses(), admin.parses(), f.writes.length, auth.calls.length]).toEqual([0, 0, 0, 0]);
  });

  it("PUT: enabling requires a strict riskAcknowledged and writes the receipt before the value", async () => {
    for (const riskAcknowledged of [undefined, false, "true"]) {
      const f = fixture();
      expect(await refusalOf(() => invoke(f.routes.put, { deps: f.deps, body: { enabled: true, riskAcknowledged } }))).toMatchObject({ status: 400 });
      expect([f.parses(), f.writes.length]).toEqual([1, 0]);
    }
    const f = fixture();
    const auth = recordingAuthorize();
    expect(await invoke(f.routes.put, { deps: f.deps, body: { enabled: true, riskAcknowledged: true }, authorize: auth.authorize }))
      .toEqual({ enabled: true, ids: ["a"], canEdit: true, revisionSeq: 42 });
    expect(auth.calls).toEqual([{ permission: "settings.workspace.write", entityType: "setting-value" }]);
    const common = { namespace: "test.grant", scope: "workspace", workspaceId: "ws-1", authWorkspaceId: "ws-1", callerPrincipalId: PRINCIPAL.id };
    expect(f.writes).toEqual([
      { input: { ...common, key: "riskAcknowledgment", value: { riskAcknowledged: true, acknowledgedAt: NOW, grant: { enabled: true, ids: ["a"] } } }, optional: {} },
      { input: { ...common, key: "policy", value: { enabled: true, ids: ["a"] } }, optional: {} },
    ]);
    for (const [previous, enabled, policy] of [[true, true, {}], [false, false, {}], [false, true, { requireAcknowledgment: false }]] as const) {
      const g = fixture({ previous, policy });
      await invoke(g.routes.put, { deps: g.deps, body: { enabled } });
      expect(g.writes.map((w) => w.input.key)).toEqual(["policy"]);
    }
  });

  it("PUT: a user-scoped grant authorizes the self write; prepareWrite and afterWrite shape the stored and returned value", async () => {
    const f = fixture({ policy: { scope: "user", requireAcknowledgment: false,
      prepareWrite: async ({ settings }) => ({ value: { patched: settings.enabled }, revisionSeq: 9 }),
      afterWrite: async () => ({ enabled: true, ids: ["saved"] }),
      projectRead: ({ settings, isOwner }) => ({ ...settings, ids: [...settings.ids, String(isOwner)] }) } });
    const auth = recordingAuthorize();
    expect(await invoke(f.routes.put, { deps: f.deps, body: { enabled: true }, authorize: auth.authorize })).toEqual({ enabled: true, ids: ["saved", "true"], canEdit: true, revisionSeq: 41 });
    expect(auth.calls).toEqual([{ permission: "settings.user.self.write", entityType: "setting-value" }]);
    expect(f.writes).toEqual([{ input: { namespace: "test.grant", scope: "user", principalId: PRINCIPAL.id, workspaceId: "ws-1", authWorkspaceId: "ws-1", callerPrincipalId: PRINCIPAL.id, key: "policy", value: { patched: true } }, optional: { expectedRevisionSeq: 9 } }]);
  });

  it("order: readiness first, a missing session before the fence, the fence before ownership; reads skip the fence", async () => {
    const down = fixture();
    // `invoke` defaults a missing context, so the no-session cases call `handle` directly.
    const noSession = (route: typeof down.routes.put, deps: typeof down.deps, body: unknown) =>
      route.handle({ input: { query: {}, body }, deps, context: undefined as never, authorize: recordingAuthorize().authorize }, { signal });
    await expect(noSession(down.routes.get, { ...down.deps, settingsReady: Promise.reject(new Error("ledger down")) }, {})).rejects.toThrow("ledger down");
    const f = fixture({ owner: "someone-else" });
    await expect(noSession(f.routes.put, f.deps, { namespace: "test.owner-only", key: "k" })).rejects.toThrow(/no authenticated principal/);
    expect(await refusalOf(() => invoke(f.routes.put, { deps: f.deps, body: { namespace: "test.owner-only", key: "k" } }))).toEqual({ status: 403, body: { error: FENCE.protected.error, code: "FORBIDDEN" } });
    expect(await invoke(f.routes.get, { deps: f.deps, query: { namespace: "test.owner-only" } })).toMatchObject({ canEdit: false });
  });

  it("an unexpected failure is rethrown for the host's redacted 500", async () => {
    const f = fixture({ policy: { read: async () => { throw new Error("private backend"); } } });
    await expect(invoke(f.routes.get, { deps: f.deps })).rejects.toThrow("private backend");
  });
});

it("uses the owner restriction copy if the host locks changes without a separate explanation", async () => {
  const f = fixture({ policy: { canEdit: () => false } });
  expect(await refusalOf(() => invoke(f.routes.put, { deps: f.deps, body: { enabled: false } })))
    .toEqual({ status: 403, body: { error: "TEST owner only", code: "FORBIDDEN" } });
  expect(f.parses()).toBe(0);
  expect(f.writes).toEqual([]);
});
