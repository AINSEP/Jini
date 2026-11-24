import { describe, expect, it } from "vitest";
import { ToolInputError } from "@jini-ai/core";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";
import {
  customCredentialCreateRoute, customCredentialDeleteRoute,
  type CustomCredentialProjectKeys,
} from "../custom-credentials.js";

/** @file Spec tests for the custom-provider credential create/delete routes: key attach, invalidation, the ladder, the injected store. */

class ValidationError extends Error {}
class ConcurrentError extends Error {}
class DuplicateLabelError extends Error {}
class NotFoundError extends Error {}
class SecretStoreError extends Error {}
const storeErrors = { validation: ValidationError, concurrentModification: ConcurrentError, duplicateLabel: DuplicateLabelError, notFound: NotFoundError, secretStoreUnconfigured: SecretStoreError };
const AUTH = { permission: "custom-credentials.write", entityType: "custom-credentials" };
const OWNER = { id: "owner" };
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
const keys = (log: string[] = []): CustomCredentialProjectKeys => ({
  use: async ({ keyId }) => { log.push(`use ${keyId}`); return { usedBy: ["Shop"], usedByThisSite: true }; },
});
function deps(overrides: Record<string, unknown> = {}) {
  const log: string[] = [];
  return { log, workspaceId: "ws-1", storeErrors, projectKeys: () => undefined,
    prepareInvalidation: async () => undefined,
    createCredential: async (i: unknown) => { log.push(`create ${JSON.stringify(i)}`); return { id: "p1", scope: "project" }; },
    describeCredential: async () => ({ id: "c1", scope: "site" }),
    deleteCredential: async (a: unknown) => { log.push(`delete ${JSON.stringify(a)}`); },
    ...overrides } as never;
}
const run = (route: { handle: (a: never) => unknown }, d: unknown, i = input(), authorize = recording().authorize, context: unknown = OWNER) =>
  route.handle({ input: i, deps: d, authorize, context } as never) as Promise<unknown>;

describe("custom credential routes", () => {
  it("pins methods, byte-identical paths and success statuses", () => {
    const base = "/api/admin/v1/workspaces/:workspaceId/system/custom/credentials";
    expect([customCredentialCreateRoute, customCredentialDeleteRoute].map((r) => [r.method, r.path, r.successStatus, r.maxBodyBytes]))
      .toEqual([["post", base, 201, undefined], ["delete", `${base}/:id`, 204, undefined]]);
    expect(customCredentialCreateRoute.parse({ body: undefined, query: {}, params: {} })).toEqual({ ok: true, value: { id: undefined, body: {} } });
  });

  it("asks custom-credentials.write without entityId; a denial reaches nothing", async () => {
    for (const route of [customCredentialCreateRoute, customCredentialDeleteRoute]) {
      const d = deps({ projectKeys: () => keys((d as { log: string[] }).log) });
      const { calls, authorize } = recording(true);
      await expect(run(route, d, input(), authorize)).rejects.toBeInstanceOf(RouteRefusalError);
      expect(calls).toEqual([AUTH]);
      expect((d as { log: string[] }).log).toEqual([]);
    }
  });

  it("fails closed with no authorizer", async () => {
    await expect(customCredentialDeleteRoute.handle({ input: input(), deps: deps() })).rejects.toThrow(/no authorizer/);
  });

  it("create forwards the body, attaches a project key and invalidates with the new credential", async () => {
    const changes: unknown[] = [];
    const d = deps({ projectKeys: () => keys((d as { log: string[] }).log), prepareInvalidation: async () => (change: unknown) => { changes.push(change); } });
    expect(await run(customCredentialCreateRoute, d, input({ label: "L", category: "c", baseUrl: "u", connection: {}, worksFor: ["x"], scope: "site", other: 1 })))
      .toEqual({ ok: true, value: { credential: { id: "p1", scope: "project", usedBy: ["Shop"], usedByThisSite: true } } });
    expect((d as { log: string[] }).log).toEqual([`create ${JSON.stringify({ workspaceId: "ws-1", label: "L", category: "c", baseUrl: "u", connection: {}, worksFor: ["x"], scope: "site" })}`, "use p1"]);
    expect(changes).toEqual([{ after: { id: "p1", scope: "project" } }]);
  });

  it("delete is idempotent (204) and invalidates only a credential that existed", async () => {
    const changes: unknown[] = [];
    const prepareInvalidation = async () => (change: unknown) => { changes.push(change); };
    expect(await run(customCredentialDeleteRoute, deps({ prepareInvalidation }))).toEqual({ ok: true, value: undefined });
    await run(customCredentialDeleteRoute, deps({ prepareInvalidation, describeCredential: async () => null }));
    expect(changes).toEqual([{ before: { id: "c1", scope: "site" } }]);
  });

  it("maps the ladder (KEY_IN_USE, VALIDATION, CONCURRENT_MODIFICATION, DUPLICATE_LABEL, NOT_FOUND, SECRET_STORE_UNCONFIGURED) and rethrows the rest", async () => {
    const cases: [Error, number, string][] = [
      [new ToolInputError({ message: "m" }), 409, "KEY_IN_USE"], [new ValidationError("m"), 400, "VALIDATION"], [new ConcurrentError("m"), 409, "CONCURRENT_MODIFICATION"],
      [new DuplicateLabelError("m"), 409, "DUPLICATE_LABEL"], [new NotFoundError("m"), 404, "NOT_FOUND"], [new SecretStoreError("m"), 503, "SECRET_STORE_UNCONFIGURED"],
    ];
    for (const [thrown, status, error] of cases) {
      expect(await refusal(run(customCredentialDeleteRoute, deps({ describeCredential: async () => { throw thrown; } })))).toEqual({ status, body: { error, detail: "m" } });
    }
    await expect(run(customCredentialDeleteRoute, deps({ deleteCredential: async () => { throw new Error("vault corrupted"); } }))).rejects.toThrow("vault corrupted");
  });
});
