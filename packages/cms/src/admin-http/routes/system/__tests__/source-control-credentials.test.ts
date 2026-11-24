import { describe, expect, it, vi } from "vitest";
import { ToolInputError } from "@jini-ai/core";
import { RouteRefusalError } from "@jini-ai/core/errors/route-refusal";
import {
  sourceControlProvidersRoute, sourceControlListRoute, sourceControlCreateRoute, sourceControlUpdateRoute, sourceControlDeleteRoute,
  type SourceControlCreateRouteDeps,
} from "../source-control-credentials.js";

/** @file Spec tests for the source-control credential routes: paths, the one permission, the store-error ladder and the injected store. */

class ValidationError extends Error {}
class DuplicateLabelError extends Error {}
class NotFoundError extends Error {}
class SecretStoreUnconfiguredError extends Error {}
class SubValidationError extends ValidationError {}
const storeErrors = { validation: ValidationError, duplicateLabel: DuplicateLabelError, notFound: NotFoundError, secretStoreUnconfigured: SecretStoreUnconfiguredError };
const AUTH = { permission: "source-control.credentials.write", entityType: "source-control" };
const raw = (params: Record<string, string>, body?: unknown) => ({ body, query: {}, params });
const credential = { id: "c1", scope: "site" };

function recording(deny = false) {
  const calls: unknown[] = [];
  return { calls, authorize: async (args: { permission: string; entityType: string }, scope?: { entityId?: string }) => {
    calls.push(scope === undefined ? args : { ...args, ...scope });
    if (deny) throw new RouteRefusalError({ status: 403, body: { error: "denied" } });
  } };
}

async function refusal(promise: unknown): Promise<unknown> {
  try { await promise; } catch (error) { if (error instanceof RouteRefusalError) return error.response; throw error; }
  throw new Error("expected a refusal");
}

function createDeps(overrides: Partial<SourceControlCreateRouteDeps> = {}): SourceControlCreateRouteDeps & { created: unknown[]; used: unknown[] } {
  const created: unknown[] = [];
  const used: unknown[] = [];
  return {
    created, used, workspaceId: "ws-1", storeErrors, hasProjectStore: () => true,
    createCredential: async (input) => { created.push(input); return { id: "c9", scope: "project" }; },
    useProjectKey: async (args) => { used.push(args); },
    ...overrides,
  };
}

describe("source-control credential routes", () => {
  it("pins methods, byte-identical paths and success statuses", () => {
    const base = "/api/admin/v1/workspaces/:workspaceId/system/source-control/credentials";
    expect([sourceControlProvidersRoute, sourceControlListRoute, sourceControlCreateRoute, sourceControlUpdateRoute, sourceControlDeleteRoute].map((r) => [r.method, r.path, r.successStatus, r.maxBodyBytes])).toEqual([
      ["get", "/api/admin/v1/workspaces/:workspaceId/system/source-control/providers", undefined, undefined],
      ["get", base, undefined, undefined],
      ["post", base, 201, undefined],
      ["put", `${base}/:id`, undefined, undefined],
      ["delete", `${base}/:id`, 204, undefined],
    ]);
  });

  it("parses the raw :id and defaults an absent body to {}", () => {
    expect(sourceControlUpdateRoute.parse(raw({ id: "c1" }, { label: "x" }))).toEqual({ ok: true, value: { id: "c1", body: { label: "x" } } });
    expect(sourceControlDeleteRoute.parse(raw({}))).toEqual({ ok: true, value: { id: undefined, body: {} } });
  });

  it("asks the one permission with no entityId, even on by-id verbs, and a denial reaches no store", async () => {
    const touched: string[] = [];
    const deps = { workspaceId: "ws-1", storeErrors, hasProjectStore: () => { touched.push("project"); return true; },
      loadSourceControlProviders: async () => { touched.push("load"); throw new Error("no"); },
      listCredentials: async () => { touched.push("list"); return []; },
      createCredential: async () => { touched.push("create"); return credential; },
      updateCredential: async () => { touched.push("update"); return credential; },
      deleteCredential: async () => { touched.push("delete"); },
      useProjectKey: async () => { touched.push("use"); } };
    for (const route of [sourceControlProvidersRoute, sourceControlListRoute, sourceControlCreateRoute, sourceControlUpdateRoute, sourceControlDeleteRoute]) {
      const { calls, authorize } = recording(true);
      const input = { id: "c1", body: {} };
      await expect((route.handle as (a: unknown) => Promise<unknown>)({ input, deps, context: { id: "p" }, authorize })).rejects.toBeInstanceOf(RouteRefusalError);
      expect(calls).toEqual([AUTH]);
    }
    expect(touched).toEqual([]);
  });

  it("fails closed with no authorizer", async () => {
    await expect(sourceControlListRoute.handle({ input: { id: "", body: {} }, deps: { workspaceId: "ws-1", storeErrors, listCredentials: async () => [] } })).rejects.toThrow(/no authorizer/);
  });

  it("maps the store-error ladder in order (ToolInputError first, subclass via its parent) and rethrows the rest", async () => {
    const cases: [Error, unknown][] = [
      [new ToolInputError({ message: "in use" }), { status: 409, body: { error: "KEY_IN_USE", detail: "in use" } }],
      [new SubValidationError("bad"), { status: 400, body: { error: "VALIDATION", detail: "bad" } }],
      [new DuplicateLabelError("dup"), { status: 409, body: { error: "DUPLICATE_LABEL", detail: "dup" } }],
      [new NotFoundError("gone"), { status: 404, body: { error: "NOT_FOUND", detail: "gone" } }],
      [new SecretStoreUnconfiguredError("sealed"), { status: 503, body: { error: "SECRET_STORE_UNCONFIGURED", detail: "sealed" } }],
    ];
    for (const [thrown, expected] of cases) {
      const deps = { workspaceId: "ws-1", storeErrors, updateCredential: async () => { throw thrown; } };
      expect(await refusal(sourceControlUpdateRoute.handle({ input: { id: "c1", body: {} }, deps, authorize: recording().authorize }))).toEqual(expected);
    }
    const deps = { workspaceId: "ws-1", storeErrors, deleteCredential: async () => { throw new Error("SECRET repo detail"); } };
    await expect(sourceControlDeleteRoute.handle({ input: { id: "c1", body: {} }, deps, authorize: recording().authorize })).rejects.toThrow("SECRET repo detail");
  });

  it("shapes providers: optional fields only when declared, switched-off hosts named, refusals logged", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const deps = { workspaceId: "ws-1", storeErrors, loadSourceControlProviders: async ({ workspaceId }: { workspaceId: string }) => ({
      refusals: [`refused ${workspaceId}`],
      list: () => [{ descriptor: { id: "a", label: "A", credential: { fields: [] }, i18n: { fr: {} } } }, { descriptor: { id: "b", label: "B" } }],
      switchedOff: new Map([["off", "plugin-off"]]),
    }) };
    expect(await sourceControlProvidersRoute.handle({ input: { id: "", body: {} }, deps, authorize: recording().authorize })).toEqual({ ok: true, value: {
      providers: [{ id: "a", label: "A", credential: { fields: [] }, i18n: { fr: {} } }, { id: "b", label: "B" }],
      switchedOff: [{ id: "off", pluginId: "plugin-off" }],
    } });
    expect(warn).toHaveBeenCalledWith("[source-control-providers] refused ws-1");
    warn.mockRestore();
  });

  it("lists through the injected store for this workspace", async () => {
    const deps = { workspaceId: "ws-1", storeErrors, listCredentials: async ({ workspaceId }: { workspaceId: string }) => [{ id: workspaceId }] };
    expect(await sourceControlListRoute.handle({ input: { id: "", body: {} }, deps, authorize: recording().authorize })).toEqual({ ok: true, value: { credentials: [{ id: "ws-1" }] } });
  });

  it("create: a project-bound create starts non-default and attaches the key; a site create keeps the auto-default", async () => {
    const project = createDeps();
    expect(await sourceControlCreateRoute.handle({ input: { id: "", body: { label: "L", connection: { t: 1 } } }, deps: project, authorize: recording().authorize }))
      .toEqual({ ok: true, value: { credential: { id: "c9", scope: "project" } } });
    expect(project.created).toEqual([{ workspaceId: "ws-1", label: "L", connection: { t: 1 }, isDefault: false, scope: undefined }]);
    expect(project.used).toEqual([{ keyId: "c9" }]);
    const site = createDeps({ createCredential: async (input) => { site.created.push(input); return { id: "s1", scope: "site" }; } });
    await sourceControlCreateRoute.handle({ input: { id: "", body: { scope: "site" } }, deps: site, authorize: recording().authorize });
    const noProject = createDeps({ hasProjectStore: () => false });
    await sourceControlCreateRoute.handle({ input: { id: "", body: { isDefault: true } }, deps: noProject, authorize: recording().authorize });
    expect([site.created[0], noProject.created[0]].map((c) => (c as { isDefault: unknown }).isDefault)).toEqual([undefined, true]);
    expect(site.used).toEqual([]);
  });

  it("update forwards only supplied keys (explicit null kept); delete answers 204 with no body", async () => {
    const seen: unknown[] = [];
    const deps = { workspaceId: "ws-1", storeErrors, updateCredential: async (input: unknown) => { seen.push(input); return credential; } };
    expect(await sourceControlUpdateRoute.handle({ input: { id: "c1", body: { label: null, isDefault: false, other: 1 } }, deps, authorize: recording().authorize }))
      .toEqual({ ok: true, value: { credential } });
    expect(seen).toEqual([{ workspaceId: "ws-1", id: "c1", label: null, isDefault: false }]);
    const deleted: unknown[] = [];
    const del = { workspaceId: "ws-1", storeErrors, deleteCredential: async (args: unknown) => { deleted.push(args); } };
    expect(await sourceControlDeleteRoute.handle({ input: { id: "c1", body: {} }, deps: del, authorize: recording().authorize })).toEqual({ ok: true, value: undefined });
    expect(deleted).toEqual([{ workspaceId: "ws-1", id: "c1" }]);
  });
});
