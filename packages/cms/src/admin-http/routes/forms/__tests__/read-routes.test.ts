import { describe, expect, it } from "vitest";
import { formsGetRoute } from "../get-by-id.js";
import { formsListRoute } from "../list.js";
import { formsProvidersRoute } from "../providers.js";
import { resolveFormDefinitionByIdOrSlug } from "../resolve-definition.js";
import { denyingAuthorize, PRINCIPAL, raw, recordingAuthorize, refusalOf, seededRepos, signal, WORKSPACE_ID } from "./helpers.js";

const MANAGE = { permission: "admin.forms.manage", entityType: "form_definition" };

describe("resolveFormDefinitionByIdOrSlug", () => {
  it("tries the trimmed, lower-cased slug first, then the raw id, else null", async () => {
    const { formDefinitionRepo } = await seededRepos();
    const deps = { workspaceId: WORKSPACE_ID, formDefinitionRepo };
    expect((await resolveFormDefinitionByIdOrSlug({ deps, formId: " Contact " }))?.id).toBe("form-1");
    expect((await resolveFormDefinitionByIdOrSlug({ deps, formId: "form-1" }))?.id).toBe("form-1");
    expect(await resolveFormDefinitionByIdOrSlug({ deps, formId: "nope" })).toBeNull();
  });
});

describe("formsListRoute", () => {
  it("keeps the path, authorizes id-free and lists the workspace's definitions", async () => {
    expect(formsListRoute.method).toBe("get");
    expect(formsListRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/forms");
    expect(formsListRoute.parse(raw({}))).toEqual({ ok: true, value: {} });
    const { authorize, calls } = recordingAuthorize();
    const result = await formsListRoute.handle({ input: {}, deps: { workspaceId: WORKSPACE_ID, ...(await seededRepos()) }, context: PRINCIPAL, authorize }, { signal });
    expect(calls).toEqual([MANAGE]);
    if (!result.ok) throw new Error("expected success");
    expect(result.value.data.map((d) => d.id)).toEqual(["form-1"]);
  });

  it("lets the authorizer's refusal and a missing authorizer through before any read", async () => {
    const deps = { workspaceId: WORKSPACE_ID, formDefinitionRepo: { list: async () => { throw new Error("must not read"); } } };
    expect(await refusalOf(() => formsListRoute.handle({ input: {}, deps, context: PRINCIPAL, authorize: denyingAuthorize }))).toMatchObject({ status: 403 });
    await expect(formsListRoute.handle({ input: {}, deps, context: PRINCIPAL })).rejects.toThrow("no authorizer");
  });
});

describe("formsProvidersRoute", () => {
  it("answers the registry's public descriptions when the host decision allows", async () => {
    expect(formsProvidersRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/forms/_providers");
    const seen: unknown[] = [];
    const authorize = async (params: unknown) => { seen.push(params); return { allowed: true, reason: "ok" }; };
    const result = await formsProvidersRoute.handle({ input: {}, deps: { workspaceId: WORKSPACE_ID, authorize }, context: PRINCIPAL });
    expect(seen).toEqual([{ principalId: "principal-1", permission: "admin.forms.manage", workspaceId: WORKSPACE_ID, entityType: "form_definition" }]);
    if (!result.ok) throw new Error("expected success");
    // With no host registry the built-in receiver is the only provider described.
    expect(result.value.data.map((p) => p.id)).toEqual(["builtin"]);
    const custom = await Promise.resolve(formsProvidersRoute.handle({ input: {}, deps: { workspaceId: WORKSPACE_ID, authorize, formCollectionProviders: () => { throw new Error("host registry read"); } }, context: PRINCIPAL })).catch((e: Error) => e.message);
    expect(custom).toBe("host registry read");
  });

  it("refuses with its own 403 copy, carrying the host's reason", async () => {
    const authorize = async () => ({ allowed: false, reason: "no-role" });
    expect(await refusalOf(() => formsProvidersRoute.handle({ input: {}, deps: { workspaceId: WORKSPACE_ID, authorize }, context: PRINCIPAL }))).toEqual({
      status: 403,
      body: { error: "You do not have permission to view form provider settings.", code: "FORBIDDEN", details: { permission: "admin.forms.manage", reason: "no-role" } },
    });
  });
});

describe("formsGetRoute", () => {
  it("keeps the path, defaults a missing formId and resolves by slug, authorizing that formId", async () => {
    expect(formsGetRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/forms/:formId");
    expect(formsGetRoute.parse(raw({}))).toEqual({ ok: true, value: { formId: "" } });
    const { authorize, calls } = recordingAuthorize();
    const result = await formsGetRoute.handle({ input: { formId: "contact" }, deps: { workspaceId: WORKSPACE_ID, ...(await seededRepos()) }, context: PRINCIPAL, authorize });
    expect(calls).toEqual([{ ...MANAGE, entityId: "contact" }]);
    if (!result.ok) throw new Error("expected success");
    expect(result.value.data).toMatchObject({ id: "form-1", slug: "contact" });
  });

  it("answers 404 FORMS_DEFINITION_NOT_FOUND for an unknown slug or id", async () => {
    const deps = { workspaceId: WORKSPACE_ID, ...(await seededRepos()) };
    expect(await refusalOf(() => formsGetRoute.handle({ input: { formId: "nope" }, deps, context: PRINCIPAL, authorize: recordingAuthorize().authorize }))).toEqual({
      status: 404, body: { error: "form definition 'nope' was not found", code: "FORMS_DEFINITION_NOT_FOUND" },
    });
  });
});
