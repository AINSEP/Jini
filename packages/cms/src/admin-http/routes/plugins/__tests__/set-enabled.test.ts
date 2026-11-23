import { describe, expect, it } from "vitest";
import type { PluginActivationRecord } from "@jini-ai/core/contracts/site/plugins-host";

import { InMemoryChangeSetRepo } from "../../../../core/commands/repo.memory.js";
import { pluginSetEnabledRoute, type PluginSetEnabledInput, type PluginSetEnabledRouteDeps } from "../set-enabled.js";
import { FakeNotFoundError, PRINCIPAL, raw, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

/** Stand-ins for the engine/host error classes the host injects into the ladder. */
class FakeToolAccessLoweringError extends Error { readonly code = "TOOL_ACCESS_STOP_FAILED"; }
class FakeInstallError extends Error { constructor(readonly code: string, message: string) { super(message); } }
class FakeIncompatibleError extends Error {}
class FakeInvalidError extends Error {}
class FakeConflictError extends Error { constructor(readonly pluginId: string, readonly conflicts: readonly unknown[]) { super(`'${pluginId}' clashes`); } }
class FakeLoadError extends Error { constructor(readonly pluginId: string, readonly reason: string) { super(`'${pluginId}' failed to load`); } }

const RECORDS = [{ id: "word-count", source: "built-in" }, { id: "site-rules", source: "site" }] as const;
const PATH = "/api/admin/v1/workspaces/:workspaceId/plugins/:pluginId";
const BAD_BODY = { status: 400, body: { error: "'enabled' must be a boolean", code: "VALIDATION_ERROR" } };

/** Deps over a real `executeCommand` + in-memory change sets; every collaborator call is recorded. */
function makeDeps(overrides: Partial<PluginSetEnabledRouteDeps> = {}, rows: Record<string, boolean> = {}) {
  const store = new Map<string, PluginActivationRecord>(Object.entries(rows).map(([id, enabled]) => [id, { workspaceId: WORKSPACE_ID, pluginId: id, version: "0.9.0", enabled } as unknown as PluginActivationRecord]));
  const log: unknown[] = [];
  let tick = 0;
  const changeSets = new InMemoryChangeSetRepo();
  const deps: PluginSetEnabledRouteDeps = {
    workspaceId: WORKSPACE_ID,
    clock: { nowMs: () => Date.parse("2026-11-23T00:00:00.000Z") + 1000 * tick++ },
    idGen: { newId: () => `id-${++tick}` },
    changeSets,
    outbox: undefined,
    authorizeCommand: async (params) => { log.push(["authorize", params]); return { allowed: true, reason: "matched" }; },
    pluginActivationRepo: {
      getActivation: async ({ pluginId }) => store.get(pluginId) ?? null,
      save: async (row) => { log.push(["save", row.pluginId, row.enabled]); store.set(row.pluginId, row); },
      deleteActivation: async ({ pluginId }) => { log.push(["delete", pluginId]); store.delete(pluginId); },
    },
    discoverPlugins: async () => RECORDS,
    setPluginEnabled: async ({ discovery, input }: { discovery: readonly { id: string }[]; input: PluginSetEnabledInput }) => {
      if (!discovery.some((r) => r.id === input.pluginId)) throw new FakeNotFoundError(`plugin '${input.pluginId}' was not found`);
      const activation = { workspaceId: input.workspaceId, pluginId: input.pluginId, version: "1.0.0", enabled: input.enabled } as unknown as PluginActivationRecord;
      store.set(input.pluginId, activation);
      log.push([input.enabled ? "onEnabled" : "onDisabled", input.pluginId]);
      return { activation };
    },
    onPluginEnabled: async (pluginId) => { log.push(["rollback:onEnabled", pluginId]); },
    onPluginDisabled: (pluginId) => { log.push(["rollback:onDisabled", pluginId]); },
    recordApproval: async ({ record }) => { log.push(["approve", record.id]); },
    lowerToolAccess: async ({ pluginId }) => { log.push(["lower", pluginId]); },
    tracker: { capture: (input, options) => { log.push(["track", input, options]); } },
    // A marker proves the host's serializer is the one used.
    toAdminPluginResponse: ({ discovery, activation }) => ({ id: discovery.id, enabled: activation?.enabled, host: true }),
    setEnabledErrors: {
      toolAccessLowering: FakeToolAccessLoweringError, install: FakeInstallError, notFound: FakeNotFoundError,
      incompatible: FakeIncompatibleError, invalid: FakeInvalidError, conflict: FakeConflictError, load: FakeLoadError,
    },
    ...overrides,
  };
  return { deps, store, log, changeSets };
}

const handle = (deps: PluginSetEnabledRouteDeps, input: { pluginId: string; enabled: boolean }, { anonymous = false } = {}) =>
  pluginSetEnabledRoute.handle({ input, deps, context: anonymous ? undefined : PRINCIPAL, authorize: async () => { throw new Error("the port authorizer is never used"); } }, { signal });

describe("pluginSetEnabledRoute: shape and parse", () => {
  it("pins method, path, success status and no body cap", () => {
    expect(pluginSetEnabledRoute.method).toBe("patch");
    expect(pluginSetEnabledRoute.path).toBe(PATH);
    expect(pluginSetEnabledRoute.successStatus).toBeUndefined();
    expect(pluginSetEnabledRoute.maxBodyBytes).toBeUndefined();
  });

  it("reads the id (falling back to empty) and a boolean enabled", () => {
    expect(pluginSetEnabledRoute.parse(raw({ pluginId: "word-count" }, { enabled: false }))).toEqual({ ok: true, value: { pluginId: "word-count", enabled: false } });
    expect(pluginSetEnabledRoute.parse(raw({}, { enabled: true }))).toEqual({ ok: true, value: { pluginId: "", enabled: true } });
  });

  for (const body of [undefined, null, {}, { enabled: "false" }, { enabled: 1 }, "true"]) {
    it(`refuses the body ${JSON.stringify(body)} with the flat 400 (validated, never coerced)`, async () => {
      expect(await refusalOf(() => pluginSetEnabledRoute.parse({ body, query: {}, params: { pluginId: "word-count" } }))).toEqual(BAD_BODY);
    });
  }
});

describe("pluginSetEnabledRoute: the audited write", () => {
  it("enables through executeCommand, asking the raw authorizer with the activation entity, and answers the host DTO + change set", async () => {
    const { deps, log, changeSets } = makeDeps();
    const result = await handle(deps, { pluginId: "word-count", enabled: true });
    expect(result).toEqual({ ok: true, value: { plugin: { id: "word-count", enabled: true, host: true }, changeSetId: expect.any(String) } });
    const changeSetId = (result as { value: { changeSetId: string } }).value.changeSetId;
    expect((await changeSets.findById({ workspaceId: WORKSPACE_ID, id: changeSetId }))?.changeSet.summary).toBe("Set plugin 'word-count' enabled=true");
    expect(log).toEqual([
      ["authorize", { principalId: PRINCIPAL.id, permission: "admin.plugins.enable", workspaceId: WORKSPACE_ID, entityType: "plugin-activation", entityId: "word-count" }],
      ["onEnabled", "word-count"],
      ["track", { name: "plugin_toggled", userId: PRINCIPAL.id }, { properties: { pluginId: "word-count", pluginKind: "cms", enabled: true, source: "admin" } }],
    ]);
  });

  it("lowers tool access only on a committed OFF, and tracks only a real change", async () => {
    const { deps, log } = makeDeps({}, { "word-count": false });
    await handle(deps, { pluginId: "word-count", enabled: false });
    expect(log.slice(1)).toEqual([["onDisabled", "word-count"], ["lower", "word-count"]]);
  });

  it("records a site plugin's approval inside execute (after the gate, before the enable); never for a built-in or a disable", async () => {
    const { deps, log } = makeDeps();
    await handle(deps, { pluginId: "site-rules", enabled: true });
    expect(log.slice(1, 3)).toEqual([["approve", "site-rules"], ["onEnabled", "site-rules"]]);
    const other = makeDeps({}, { "site-rules": true });
    await handle(other.deps, { pluginId: "site-rules", enabled: false });
    await handle(other.deps, { pluginId: "word-count", enabled: true });
    expect(other.log.filter((entry) => (entry as unknown[])[0] === "approve")).toEqual([]);
  });

  it("a denied caller is 403 FORBIDDEN with details, and nothing is approved, written or toggled", async () => {
    const { deps, log, store } = makeDeps({ authorizeCommand: async () => ({ allowed: false, reason: "insufficient role" }) });
    expect(await refusalOf(() => handle(deps, { pluginId: "site-rules", enabled: true }))).toEqual({
      status: 403,
      body: { error: `principal '${PRINCIPAL.id}' is not authorized for 'admin.plugins.enable' (insufficient role)`, code: "FORBIDDEN", details: { permission: "admin.plugins.enable", reason: "insufficient role" } },
    });
    expect(log).toEqual([]);
    expect(store.size).toBe(0);
  });

  it("fails closed without an authenticated principal (a wiring bug), before discovery", async () => {
    let discovered = 0;
    const { deps } = makeDeps({ discoverPlugins: async () => { discovered += 1; return RECORDS; } });
    await expect(handle(deps, { pluginId: "word-count", enabled: true }, { anonymous: true })).rejects.toThrow(/no authenticated principal/);
    expect(discovered).toBe(0);
  });
});

describe("pluginSetEnabledRoute: rollback when the record cannot be written", () => {
  const failingInsert = async () => { throw new Error("change-set store unavailable"); };

  it("deletes a first-time row and re-runs the disable side effect; the store error is rethrown for the host 500", async () => {
    const { deps, store, log, changeSets } = makeDeps();
    changeSets.insert = failingInsert;
    await expect(handle(deps, { pluginId: "word-count", enabled: true })).rejects.toThrow("change-set store unavailable");
    expect(store.has("word-count")).toBe(false);
    expect(log.slice(1)).toEqual([["onEnabled", "word-count"], ["delete", "word-count"], ["rollback:onDisabled", "word-count"]]);
  });

  it("restores a prior row verbatim and re-runs the side effect matching it", async () => {
    const { deps, store, log, changeSets } = makeDeps({}, { "word-count": true });
    changeSets.insert = failingInsert;
    await expect(handle(deps, { pluginId: "word-count", enabled: false })).rejects.toThrow("change-set store unavailable");
    expect(store.get("word-count")).toMatchObject({ version: "0.9.0", enabled: true });
    expect(log.slice(1)).toEqual([["onDisabled", "word-count"], ["save", "word-count", true], ["rollback:onEnabled", "word-count"]]);
  });
});

describe("pluginSetEnabledRoute: the error ladder", () => {
  const conflicts = [{ kind: "tool", key: "count_words" }];
  const cases: [string, Error, { status: number; body: unknown }][] = [
    ["tool access lowering", new FakeToolAccessLoweringError("answers not stopped"), { status: 503, body: { error: "answers not stopped", code: "TOOL_ACCESS_STOP_FAILED" } }],
    ["install (own code)", new FakeInstallError("PLUGIN_BUSY", "busy"), { status: 409, body: { error: "busy", code: "PLUGIN_BUSY" } }],
    ["not found", new FakeNotFoundError("gone"), { status: 404, body: { error: "gone", code: "PLUGIN_NOT_FOUND" } }],
    ["incompatible", new FakeIncompatibleError("old sdk"), { status: 422, body: { error: "old sdk", code: "PLUGIN_INCOMPATIBLE" } }],
    ["invalid", new FakeInvalidError("broken"), { status: 422, body: { error: "broken", code: "PLUGIN_INVALID" } }],
    ["conflict", new FakeConflictError("word-count", conflicts), { status: 409, body: { error: "'word-count' clashes", code: "PLUGIN_CONFLICT", details: { pluginId: "word-count", conflicts } } }],
    ["load", new FakeLoadError("word-count", "PLUGIN_SETUP_FAILED"), { status: 500, body: { error: "'word-count' failed to load", code: "PLUGIN_LOAD_FAILED", details: { pluginId: "word-count", reason: "PLUGIN_SETUP_FAILED" } } }],
  ];
  for (const [name, error, expected] of cases) {
    it(`maps ${name} to its flat envelope`, async () => {
      const { deps } = makeDeps({ setPluginEnabled: async () => { throw error; } });
      expect(await refusalOf(() => handle(deps, { pluginId: "word-count", enabled: true }))).toEqual(expected);
    });
  }

  it("maps an undiscovered id to 404 through the injected engine, and a lowering failure after the commit to 503", async () => {
    expect(await refusalOf(() => handle(makeDeps().deps, { pluginId: "", enabled: true }))).toMatchObject({ status: 404, body: { code: "PLUGIN_NOT_FOUND" } });
    const lowering = makeDeps({ lowerToolAccess: async () => { throw new FakeToolAccessLoweringError("not confirmed"); } });
    expect(await refusalOf(() => handle(lowering.deps, { pluginId: "word-count", enabled: false }))).toEqual({ status: 503, body: { error: "not confirmed", code: "TOOL_ACCESS_STOP_FAILED" } });
  });

  it("checks the ladder top-down: an error matching two rungs takes the first", async () => {
    class LoweringAndNotFound extends FakeToolAccessLoweringError {}
    const { deps } = makeDeps({ setEnabledErrors: { ...makeDeps().deps.setEnabledErrors, notFound: LoweringAndNotFound } });
    const failing = { ...deps, setPluginEnabled: async () => { throw new LoweringAndNotFound("both"); } };
    expect(await refusalOf(() => handle(failing, { pluginId: "word-count", enabled: true }))).toMatchObject({ status: 503 });
  });

  it("rethrows an unmapped failure unchanged for the host 500", async () => {
    const { deps } = makeDeps({ discoverPlugins: async () => { throw new Error("disk gone"); } });
    await expect(handle(deps, { pluginId: "word-count", enabled: true })).rejects.toThrow("disk gone");
  });
});
