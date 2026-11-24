import { describe, expect, it } from "vitest";
import { agentPluginMemoryGetRoute, agentPluginMemoryPutRoute } from "../memory.js";
import { PRINCIPAL, raw, refusalOf, signal, WORKSPACE_ID } from "./helpers.js";

/** @file GET/PUT one Agent Plugin's memory: notes are the only write; learned knowledge stays read-only. */

const LIMITS = { maxNoteBytes: 7 };

/** Records each authorization's args verbatim (so an absent `entityType`/`entityId` key is visible). */
function verbatimAuthorize(denied: readonly string[] = []) {
  const calls: unknown[] = [];
  return {
    calls,
    authorize: async (args: { permission: string; entityType?: string }, ...scope: unknown[]) => {
      calls.push(scope.length === 0 ? args : [args, ...scope]);
      if (denied.includes(args.permission)) throw new Error(`denied ${args.permission}`);
    },
  };
}

function deps(overrides: { installed?: boolean; writeError?: unknown; log?: string[] } = {}) {
  const log = overrides.log ?? [];
  return {
    workspaceId: WORKSPACE_ID,
    memoryLimits: LIMITS,
    isInstalled: async ({ pluginId }: { pluginId: string }) => { log.push(`installed:${pluginId}`); return overrides.installed ?? true; },
    openMemory: ({ pluginId }: { pluginId: string }) => {
      log.push(`open:${pluginId}`);
      return {
        writeNote: async ({ entryPath, text }: { entryPath: string; text: string }) => {
          log.push(`write:${entryPath}:${text}`);
          if (overrides.writeError !== undefined) throw overrides.writeError;
        },
        list: async ({ kind }: { kind: "learned" | "notes" }) => { log.push(`list:${kind}`); return [{ kind }]; },
      };
    },
    isSystemError: ({ error }: { error: unknown }) => error instanceof Error && "code" in error,
  };
}

describe("agentPluginMemory routes", () => {
  it("keep the method, path and default status, and read the plugin id with the host's `?? \"\"` fallback", () => {
    expect(agentPluginMemoryGetRoute.method).toBe("get");
    expect(agentPluginMemoryPutRoute.method).toBe("put");
    for (const route of [agentPluginMemoryGetRoute, agentPluginMemoryPutRoute]) {
      expect(route.path).toBe("/api/admin/v1/workspaces/:workspaceId/agent-plugins/:pluginId/memory");
      expect(route.successStatus).toBeUndefined();
      expect(route.maxBodyBytes).toBeUndefined();
    }
    expect(agentPluginMemoryGetRoute.parse(raw({ pluginId: "acme" }, { ignored: 1 }))).toEqual({ ok: true, value: { pluginId: "acme" } });
    expect(agentPluginMemoryPutRoute.parse(raw({}, "x"))).toEqual({ ok: true, value: { pluginId: "", body: "x" } });
  });

  it("authorize read / enable with neither an entity type nor an entity id, exactly as the hand-written calls did", async () => {
    const reader = verbatimAuthorize();
    await agentPluginMemoryGetRoute.handle({ input: { pluginId: "acme" }, deps: deps(), context: PRINCIPAL, authorize: reader.authorize }, { signal });
    expect(reader.calls).toStrictEqual([{ permission: "admin.plugins.read" }]);
    const writer = verbatimAuthorize();
    await agentPluginMemoryPutRoute.handle({ input: { pluginId: "acme", body: { entryPath: "a.md", text: "t" } }, deps: deps(), context: PRINCIPAL, authorize: writer.authorize }, { signal });
    expect(writer.calls).toStrictEqual([{ permission: "admin.plugins.enable" }]);
  });

  it("a denial stops before the installed lookup; a malformed body is refused only after authorization and the 404", async () => {
    const log: string[] = [];
    const { authorize } = verbatimAuthorize(["admin.plugins.enable"]);
    await expect(agentPluginMemoryPutRoute.handle({ input: { pluginId: "acme", body: null }, deps: deps({ log }), context: PRINCIPAL, authorize })).rejects.toThrow("denied admin.plugins.enable");
    expect(log).toEqual([]);
    const missing = await refusalOf(() => agentPluginMemoryPutRoute.handle({ input: { pluginId: "gone", body: null }, deps: deps({ installed: false, log }), context: PRINCIPAL, authorize: verbatimAuthorize().authorize }));
    expect(missing).toEqual({ status: 404, body: { error: "agent plugin was not found", code: "AGENT_PLUGIN_NOT_FOUND" } });
    expect(log).toEqual(["installed:gone"]);
  });

  it.each([null, "text", [], { entryPath: "a.md" }, { text: "t" }, { entryPath: 1, text: "t" }, { entryPath: "a.md", text: 2 }, { entryPath: "a.md", text: "t", extra: true }])(
    "refuses the note body %j with the flat 400 and writes nothing",
    async (body) => {
      const log: string[] = [];
      const refusal = await refusalOf(() => agentPluginMemoryPutRoute.handle({ input: { pluginId: "acme", body }, deps: deps({ log }), context: PRINCIPAL, authorize: verbatimAuthorize().authorize }));
      expect(refusal).toEqual({ status: 400, body: { error: "entryPath and text are required", code: "VALIDATION_ERROR" } });
      expect(log).toEqual(["installed:acme", "open:acme"]);
    },
  );

  it("an invalid note is a 422 refusal; a system error (the injected predicate) is rethrown unchanged for the host's own 500", async () => {
    const input = { pluginId: "acme", body: { entryPath: "a.md", text: "t" } };
    const invalid = await refusalOf(() => agentPluginMemoryPutRoute.handle({ input, deps: deps({ writeError: new Error("too big") }), context: PRINCIPAL, authorize: verbatimAuthorize().authorize }));
    expect(invalid).toEqual({ status: 422, body: { error: "note path, text or size is invalid", code: "PLUGIN_MEMORY_INVALID" } });
    const fault = Object.assign(new Error("disk"), { code: "EACCES" });
    await expect(agentPluginMemoryPutRoute.handle({ input, deps: deps({ writeError: fault }), context: PRINCIPAL, authorize: verbatimAuthorize().authorize })).rejects.toBe(fault);
  });

  it("answers both lists with the host's limits; PUT writes the note before reading", async () => {
    const log: string[] = [];
    const expected = { pluginId: "acme", learned: [{ kind: "learned" }], notes: [{ kind: "notes" }], limits: LIMITS };
    expect(await agentPluginMemoryGetRoute.handle({ input: { pluginId: "acme" }, deps: deps(), context: PRINCIPAL, authorize: verbatimAuthorize().authorize })).toEqual({ ok: true, value: expected });
    expect(await agentPluginMemoryPutRoute.handle({ input: { pluginId: "acme", body: { entryPath: "a.md", text: "t" } }, deps: deps({ log }), context: PRINCIPAL, authorize: verbatimAuthorize().authorize })).toEqual({ ok: true, value: expected });
    expect(log).toEqual(["installed:acme", "open:acme", "write:a.md:t", "list:learned", "list:notes"]);
  });

  it("fails closed on a mount without an authorizer (a wiring bug)", async () => {
    await expect(agentPluginMemoryGetRoute.handle({ input: { pluginId: "acme" }, deps: deps(), context: PRINCIPAL })).rejects.toThrow(/no authorizer/);
  });
});
