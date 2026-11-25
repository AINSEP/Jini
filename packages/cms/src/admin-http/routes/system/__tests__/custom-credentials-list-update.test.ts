import { describe, expect, it } from "vitest";
import { ToolInputError } from "@jini-ai/core";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";
import { customCredentialListRoute, customCredentialUpdateRoute } from "../custom-credentials.js";

/** @file Spec tests for the custom-provider credential list (owner-session Shared Keys gate) and update
 *  (owner-session shared-key replacement) routes: gate order, the ladder, and what reaches the store. */

class ValidationError extends Error {}
class ConcurrentError extends Error {}
class DuplicateLabelError extends Error {}
class NotFoundError extends Error {}
class SecretStoreError extends Error {}
const storeErrors = { validation: ValidationError, concurrentModification: ConcurrentError, duplicateLabel: DuplicateLabelError, notFound: NotFoundError, secretStoreUnconfigured: SecretStoreError };
const AUTH = { permission: "custom-credentials.write", entityType: "custom-credentials" };
const BASE = "/api/admin/v1/workspaces/:workspaceId/system/custom/credentials";
const COPY = { sessionRequired: "use the session", ownerRequired: "be the owner" };
const OWNER = { id: "owner" };

function recording(deny = false) {
  const calls: unknown[] = [];
  return { calls, authorize: async (args: { permission: string; entityType: string }) => {
    calls.push(args);
    if (deny) throw new RouteRefusalError({ status: 403, body: { error: "denied" } });
  } };
}
async function refusal(promise: unknown): Promise<unknown> {
  try { await promise; } catch (error) { if (error instanceof RouteRefusalError) return error.response; throw error; }
  throw new Error("expected a refusal");
}
const keyList = (log: string[]) => ({ list: async () => { log.push("keys"); return [{ keyId: "p1", usedBy: ["Shop"], usedByThisSite: true }]; } });

function listDeps(overrides: Record<string, unknown> = {}) {
  const log: string[] = [];
  return { log, workspaceId: "ws-1", storeErrors, copy: COPY, projectKeys: () => undefined,
    credentialKind: () => { log.push("kind"); return "session"; },
    ownerPrincipalId: () => { log.push("owner"); return Promise.resolve("owner"); },
    listInventory: async () => { log.push("inventory"); return [{ id: "p1", scope: "project" }, { id: "p2", scope: "project" }, { id: "s1", scope: "site" }]; },
    ...overrides } as never;
}
function updateDeps(overrides: Record<string, unknown> = {}) {
  const log: string[] = [];
  return { log, workspaceId: "ws-1", storeErrors,
    credentialKind: () => { log.push("kind"); return "session"; },
    ownerPrincipalId: () => { log.push("owner"); return Promise.resolve("owner"); },
    prepareInvalidation: async () => { log.push("prepare"); return (change: unknown) => { log.push(`invalidate ${JSON.stringify(change)}`); }; },
    describeCredential: async (t: unknown) => { log.push(`describe ${JSON.stringify(t)}`); return { id: "c1", scope: "site" }; },
    updateCredential: async (a: unknown) => { log.push(`update ${JSON.stringify(a)}`); return { id: "c1", scope: "site", label: "new" }; },
    ...overrides } as never;
}
const run = (route: { handle: (a: never) => unknown }, d: unknown, body: Record<string, unknown> = {}, authorize = recording().authorize, context: unknown = OWNER) =>
  route.handle({ input: { id: "c1", body }, deps: d, authorize, context } as never) as Promise<unknown>;
const logOf = (d: unknown) => (d as { log: string[] }).log;

describe("custom credential list route", () => {
  it("pins method and byte-identical path", () => {
    expect([customCredentialListRoute.method, customCredentialListRoute.path]).toEqual(["get", BASE]);
  });

  it("asks custom-credentials.write first; a denial reads nothing (no kind, no inventory)", async () => {
    const d = listDeps({ projectKeys: () => keyList(logOf(d)) });
    const { calls, authorize } = recording(true);
    await expect(run(customCredentialListRoute, d, {}, authorize)).rejects.toBeInstanceOf(RouteRefusalError);
    expect([calls, logOf(d)]).toEqual([[AUTH], []]);
  });

  it("with no project key store never reads the credential kind; project rows still read as unused, no projectKeysAvailable", async () => {
    const d = listDeps();
    expect(await run(customCredentialListRoute, d)).toEqual({ ok: true, value: { credentials: [
      { id: "p1", scope: "project", usedBy: [], usedByThisSite: false }, { id: "p2", scope: "project", usedBy: [], usedByThisSite: false }, { id: "s1", scope: "site" },
    ] } });
    expect(logOf(d)).toEqual(["inventory"]);
  });

  it("with a project key store refuses a non-session credential with the exact 403, before the owner or the inventory", async () => {
    const d = listDeps({ projectKeys: () => keyList(logOf(d)), credentialKind: () => "api-key" });
    expect(await refusal(run(customCredentialListRoute, d))).toEqual({ status: 403, body: {
      error: "use the session", code: "FORBIDDEN", details: { permission: "custom-credentials.write", reason: "credential_kind_not_permitted" },
    } });
    expect(logOf(d)).toEqual([]);
  });

  it("with a project key store refuses a session that is not the installation owner", async () => {
    const d = listDeps({ projectKeys: () => keyList(logOf(d)) });
    expect(await refusal(run(customCredentialListRoute, d, {}, recording().authorize, { id: "editor" }))).toEqual({ status: 403, body: { error: "be the owner" } });
    expect(logOf(d)).toEqual(["kind", "owner"]);
  });

  it("the owner session sees project keys' usage (absent key = unused) and projectKeysAvailable", async () => {
    const d = listDeps({ projectKeys: () => keyList(logOf(d)) });
    expect(await run(customCredentialListRoute, d)).toEqual({ ok: true, value: { projectKeysAvailable: true, credentials: [
      { id: "p1", scope: "project", usedBy: ["Shop"], usedByThisSite: true },
      { id: "p2", scope: "project", usedBy: [], usedByThisSite: false },
      { id: "s1", scope: "site" },
    ] } });
    expect(logOf(d)).toEqual(["kind", "owner", "inventory", "keys"]);
  });

  it("maps store errors through the ladder (KEY_IN_USE first); an unknown error escapes unchanged", async () => {
    const thrown = (error: Error) => listDeps({ listInventory: async () => { throw error; } });
    expect(await refusal(run(customCredentialListRoute, thrown(new NotFoundError("gone"))))).toEqual({ status: 404, body: { error: "NOT_FOUND", detail: "gone" } });
    expect(await refusal(run(customCredentialListRoute, thrown(new ToolInputError({ message: "busy" }))))).toEqual({ status: 409, body: { error: "KEY_IN_USE", detail: "busy" } });
    const boom = new Error("vault corrupted");
    await expect(run(customCredentialListRoute, thrown(boom))).rejects.toBe(boom);
  });
});

describe("custom credential update route", () => {
  it("pins method and byte-identical path", () => {
    expect([customCredentialUpdateRoute.method, customCredentialUpdateRoute.path]).toEqual(["put", `${BASE}/:id`]);
  });

  it("a denial reaches nothing", async () => {
    const d = updateDeps();
    const { calls, authorize } = recording(true);
    await expect(run(customCredentialUpdateRoute, d, { label: "x" }, authorize)).rejects.toBeInstanceOf(RouteRefusalError);
    expect([calls, logOf(d)]).toEqual([[AUTH], []]);
  });

  it("forwards only supplied keys (an explicit null survives), owner session may replace a shared key, then invalidates", async () => {
    const d = updateDeps();
    const body = { label: "new", worksFor: ["vercel"], username: null, ignored: 1 };
    expect(await run(customCredentialUpdateRoute, d, body)).toEqual({ ok: true, value: { credential: { id: "c1", scope: "site", label: "new" } } });
    expect(logOf(d)).toEqual([
      "prepare", 'describe {"workspaceId":"ws-1","id":"c1"}', "kind", "owner",
      'update {"allowSharedKeyReplacement":true,"input":{"workspaceId":"ws-1","id":"c1","label":"new","worksFor":["vercel"],"username":null}}',
      'invalidate {"before":{"id":"c1","scope":"site"},"after":{"id":"c1","scope":"site","label":"new"}}',
    ]);
  });

  it("a non-session credential never asks for the owner and may not replace a shared key; no worksFor = no invalidation", async () => {
    const d = updateDeps({ credentialKind: () => "api-key" });
    await run(customCredentialUpdateRoute, d, { label: "new" });
    expect(logOf(d)).toEqual(["prepare", 'describe {"workspaceId":"ws-1","id":"c1"}', 'update {"allowSharedKeyReplacement":false,"input":{"workspaceId":"ws-1","id":"c1","label":"new"}}']);
  });

  it("a session that is not the owner may not replace a shared key; a missing row is not invalidated", async () => {
    const d = updateDeps({ describeCredential: async () => null });
    await run(customCredentialUpdateRoute, d, { worksFor: [] }, recording().authorize, { id: "editor" });
    expect(logOf(d)).toEqual(["prepare", "kind", "owner", 'update {"allowSharedKeyReplacement":false,"input":{"workspaceId":"ws-1","id":"c1","worksFor":[]}}']);
  });

  it("maps store errors through the ladder incl. CONCURRENT_MODIFICATION", async () => {
    const d = updateDeps({ updateCredential: async () => { throw new ConcurrentError("raced"); } });
    expect(await refusal(run(customCredentialUpdateRoute, d))).toEqual({ status: 409, body: { error: "CONCURRENT_MODIFICATION", detail: "raced" } });
  });
});
