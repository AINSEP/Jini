import { describe, expect, it } from "vitest";
import { ToolInputError } from "@jini-ai/core";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";
import { publishCredentialCreateRoute } from "../publish-credentials/create.js";
import { publishCredentialUpdateRoute } from "../publish-credentials/update.js";
import { publishCredentialVerifyRoute } from "../publish-credentials/verify.js";
import { publishCredentialDeleteRoute } from "../publish-credentials/delete.js";

/** @file Spec tests for the publish-credential routes (one spec per route): paths, `system.publish`, ladder, verify/invalidate/heal wiring. */

class ValidationError extends Error {}
class DuplicateLabelError extends Error {}
class NotFoundError extends Error {}
class SecretStoreError extends Error {}
const storeErrors = { validation: ValidationError, duplicateLabel: DuplicateLabelError, notFound: NotFoundError, secretStoreUnconfigured: SecretStoreError };
const ROUTES = [publishCredentialCreateRoute, publishCredentialUpdateRoute, publishCredentialVerifyRoute, publishCredentialDeleteRoute];
const input = (body: Record<string, unknown> = {}, id = "c1") => ({ id, body });

function recording(deny = false) {
  const calls: unknown[] = [];
  return { calls, authorize: async (args: { permission: string; entityType: string }, scope?: object) => {
    calls.push(scope === undefined ? args : { ...args, ...scope });
    if (deny) throw new RouteRefusalError({ status: 403, body: { error: "denied" } });
  } };
}
async function refusal(promise: unknown): Promise<unknown> {
  try { await promise; } catch (error) { if (error instanceof RouteRefusalError) return error.response; throw error; }
  throw new Error("expected a refusal");
}
function deps(overrides: Record<string, unknown> = {}) {
  const log: string[] = [];
  const push = (line: string) => { log.push(line); };
  return { log, workspaceId: "ws-1", storeErrors, executionMode: "local",
    listCredentials: async () => { push("list"); return [{ id: "c1" }]; },
    triggerAccountLabelHeal: async (rows: unknown) => { push(`heal ${JSON.stringify(rows)}`); },
    createCredential: async (i: unknown) => { push(`create ${JSON.stringify(i)}`); return { id: "p1", scope: "project" }; },
    hasProjectStore: () => true,
    useProjectKey: async ({ keyId }: { keyId: string }) => { push(`use ${keyId}`); },
    prepareInvalidation: async () => { push("prepare"); return (change: unknown) => push(`invalidate ${JSON.stringify(change)}`); },
    verifyAfterSave: async ({ id }: { id: string }) => { push(`verify ${id}`); return { ok: true }; },
    describeCredential: async ({ id }: { id: string }) => { push(`describe ${id}`); return { id }; },
    updateCredential: async (i: unknown) => { push(`update ${JSON.stringify(i)}`); return { id: "c1" }; },
    deleteCredential: async (i: unknown) => { push(`delete ${JSON.stringify(i)}`); },
    ...overrides } as never;
}
const run = (route: { handle: (a: never) => unknown }, d: unknown, i = input(), authorize = recording().authorize) =>
  route.handle({ input: i, deps: d, authorize, context: { id: "p" } } as never) as Promise<unknown>;
const logOf = (d: unknown) => (d as { log: string[] }).log;

describe("publish credential routes", () => {
  it("pins methods, byte-identical paths and success statuses", () => {
    const base = "/api/admin/v1/workspaces/:workspaceId/system/publish/credentials";
    expect(ROUTES.map((r) => [r.method, r.path, r.successStatus, r.maxBodyBytes])).toEqual([
      ["post", base, 201, undefined], ["put", `${base}/:id`, undefined, undefined],
      ["post", `${base}/:id/verify`, undefined, undefined], ["delete", `${base}/:id`, 204, undefined],
    ]);
    expect(publishCredentialVerifyRoute.parse({ body: undefined, query: {}, params: { id: "x" } })).toEqual({ ok: true, value: { id: "x", body: {} } });
  });

  it("asks system.publish on site-publish with no entityId; a denial reaches no store, loader or probe", async () => {
    for (const route of ROUTES) {
      const d = deps();
      const { calls, authorize } = recording(true);
      await expect(run(route, d, input({ connection: {} }), authorize)).rejects.toBeInstanceOf(RouteRefusalError);
      expect(calls).toEqual([{ permission: "system.publish", entityType: "site-publish" }]);
      expect(logOf(d)).toEqual([]);
    }
    await expect(publishCredentialCreateRoute.handle({ input: input(), deps: deps() })).rejects.toThrow(/no authorizer/);
  });

  it("create: registry first, project-bound default, key attach, invalidate, then verify", async () => {
    const d = deps();
    expect(await run(publishCredentialCreateRoute, d, input({ label: "L", connection: { t: 1 }, worksFor: ["v"], other: 1 })))
      .toEqual({ ok: true, value: { credential: { id: "p1", scope: "project" }, verification: { ok: true } } });
    expect(logOf(d)).toEqual(["prepare", `create ${JSON.stringify({ workspaceId: "ws-1", label: "L", connection: { t: 1 }, isDefault: false, worksFor: ["v"] })}`,
      "use p1", 'invalidate {"after":{"id":"p1","scope":"project"}}', "verify p1"]);
    const site = deps({ hasProjectStore: () => false, verifyAfterSave: async () => undefined });
    expect(await run(publishCredentialCreateRoute, site, input({ connection: {} }))).toEqual({ ok: true, value: { credential: { id: "p1", scope: "project" } } });
    expect(logOf(site)[1]).toBe(`create ${JSON.stringify({ workspaceId: "ws-1", connection: {} })}`);
  });

  it("update: present fields only; invalidates on worksFor; verifies only a new connection", async () => {
    const rename = deps();
    expect(await run(publishCredentialUpdateRoute, rename, input({ label: null, other: 1 }))).toEqual({ ok: true, value: { credential: { id: "c1" } } });
    expect(logOf(rename)).toEqual(["prepare", "describe c1", `update ${JSON.stringify({ workspaceId: "ws-1", id: "c1", label: null })}`]);
    const full = deps();
    await run(publishCredentialUpdateRoute, full, input({ worksFor: [], connection: {} }));
    expect(logOf(full).slice(3)).toEqual(['invalidate {"before":{"id":"c1"},"after":{"id":"c1"}}', "verify c1"]);
  });

  it("verify: 404 for a missing credential, else the probe result", async () => {
    expect(await refusal(run(publishCredentialVerifyRoute, deps({ describeCredential: async () => null }), input({}, "gone"))))
      .toEqual({ status: 404, body: { error: "NOT_FOUND", detail: "no publish credential 'gone' in this workspace" } });
    expect(await run(publishCredentialVerifyRoute, deps())).toEqual({ ok: true, value: { verification: { ok: true } } });
  });

  it("delete: 204, invalidates only a credential that existed", async () => {
    const d = deps();
    expect(await run(publishCredentialDeleteRoute, d)).toEqual({ ok: true, value: undefined });
    expect(logOf(d)).toEqual(["prepare", "describe c1", 'delete {"workspaceId":"ws-1","id":"c1"}', 'invalidate {"before":{"id":"c1"}}']);
    const missing = deps({ describeCredential: async () => null });
    await run(publishCredentialDeleteRoute, missing);
    expect(logOf(missing).some((line) => line.startsWith("invalidate"))).toBe(false);
  });

  it("maps the ladder on every store step and rethrows the rest", async () => {
    const cases: [Error, number, string][] = [
      [new ToolInputError({ message: "m" }), 409, "KEY_IN_USE"], [new ValidationError("m"), 400, "VALIDATION"], [new DuplicateLabelError("m"), 409, "DUPLICATE_LABEL"],
      [new NotFoundError("m"), 404, "NOT_FOUND"], [new SecretStoreError("m"), 503, "SECRET_STORE_UNCONFIGURED"],
    ];
    for (const [thrown, status, error] of cases) {
      expect(await refusal(run(publishCredentialVerifyRoute, deps({ verifyAfterSave: async () => { throw thrown; } })))).toEqual({ status, body: { error, detail: "m" } });
    }
    await expect(run(publishCredentialDeleteRoute, deps({ deleteCredential: async () => { throw new Error("db down"); } }))).rejects.toThrow("db down");
  });
});
