import { isRouteReply } from "@jini-ai/core/contracts/server";
import { RecordVersionConflictError } from "@jini-ai/core/optimistic-concurrency";
import { describe, expect, it } from "vitest";
import { formsAuthoringRoute, type FormsAuthoringRouteDeps } from "../authoring.js";
import { denyingAuthorize, fakeDefinition, PRINCIPAL, raw, recordingAuthorize, refusalOf, WORKSPACE_ID } from "./helpers.js";

type Writes = { calls: Array<{ input: unknown; optional: unknown }> };

function deps(overrides: Partial<FormsAuthoringRouteDeps> = {}): FormsAuthoringRouteDeps & Writes {
  const writes: Writes = { calls: [] };
  return {
    ...writes,
    workspaceId: WORKSPACE_ID,
    outwardErrorMessage: ({ error }) => error.message,
    updateFormDefinition: async ({ input }, optional) => { writes.calls.push({ input, optional }); return { definition: fakeDefinition({ version: 2 }) }; },
    ...overrides,
  };
}

const handle = (input: { formId?: string; body?: Record<string, unknown>; idempotencyKey?: string }, d: FormsAuthoringRouteDeps, authorize = recordingAuthorize().authorize) =>
  formsAuthoringRoute.handle({ input: { formId: "form-1", body: {}, idempotencyKey: undefined, ...input }, deps: d, context: PRINCIPAL, authorize });

describe("formsAuthoringRoute", () => {
  it("pins the method, path and a 200 success with no body cap", () => {
    expect(formsAuthoringRoute.method).toBe("put");
    expect(formsAuthoringRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/forms/:formId/authoring");
    expect(formsAuthoringRoute.successStatus).toBeUndefined();
    expect(formsAuthoringRoute.maxBodyBytes).toBeUndefined();
  });

  it("parses the param, body and Idempotency-Key with the hand-written fallbacks", () => {
    expect(formsAuthoringRoute.parse(raw({}))).toEqual({ ok: true, value: { formId: "", body: {}, idempotencyKey: undefined } });
    const body = { name: "N" };
    expect(formsAuthoringRoute.parse({ ...raw({ formId: "f" }, { body }), headers: { "idempotency-key": "k-1" } })).toEqual({ ok: true, value: { formId: "f", body, idempotencyKey: "k-1" } });
    expect(formsAuthoringRoute.parse({ ...raw({ formId: "f" }), headers: { "idempotency-key": "" } })).toEqual({ ok: true, value: { formId: "f", body: {}, idempotencyKey: undefined } });
  });

  it("authorizes admin.forms.manage on the form before any write", async () => {
    const { authorize, calls } = recordingAuthorize();
    const d = deps();
    await handle({ formId: "form-1" }, d, authorize);
    expect(calls).toEqual([{ permission: "admin.forms.manage", entityType: "form_definition", entityId: "form-1" }]);
    expect(await refusalOf(() => handle({}, d, denyingAuthorize))).toEqual({ status: 403, body: { error: "denied", code: "FORBIDDEN" } });
    expect(d.calls).toHaveLength(1);
  });

  it("writes only the recognized authoring keys, as the principal, with the key and expected version", async () => {
    const d = deps();
    const body = { name: "New", fields: [{ id: "a" }], notify: { enabled: true, recipients: [] }, mode: "html", html: "<form></form>", provider: "p", slug: "ignored", status: "disabled", expectedVersion: 4 };
    const result = await handle({ body, idempotencyKey: "k-1" }, d);
    expect(d.calls).toEqual([{
      input: {
        workspaceId: WORKSPACE_ID, formId: "form-1", actor: { id: "principal-1", kind: "user" }, idempotencyKey: "k-1",
        patch: { name: "New", fields: [{ id: "a" }], notify: { enabled: true, recipients: [] }, mode: "html", html: "<form></form>", provider: "p" },
      },
      optional: { expectedVersion: 4 },
    }]);
    expect(result.ok && result.value.data).toMatchObject({ id: "form-1", version: 2 });
    expect(result.ok && isRouteReply(result.value)).toBe(false);
  });

  it("sends an empty patch and no expected version for an unusable body", async () => {
    const d = deps();
    await handle({ body: { name: 7, fields: {}, ignored: true } }, d);
    expect(d.calls).toEqual([{ input: { workspaceId: WORKSPACE_ID, formId: "form-1", actor: { id: "principal-1", kind: "user" }, idempotencyKey: undefined, patch: {} }, optional: {} }]);
  });

  it("answers a malformed expectedVersion as 400 before writing, and a stale one as 409 VERSION_CONFLICT", async () => {
    const d = deps();
    expect(await refusalOf(() => handle({ body: { expectedVersion: "1" } }, d))).toEqual({ status: 400, body: { error: "'expectedVersion' must be a non-negative integer when present", code: "VALIDATION_ERROR" } });
    expect(d.calls).toEqual([]);
    const stale = deps({ updateFormDefinition: async () => { throw new RecordVersionConflictError({ recordKind: "form", recordId: "form-1", expectedVersion: 1, currentVersion: 2 }); } });
    const refusal = await refusalOf(() => handle({ body: { expectedVersion: 1 } }, stale));
    expect(refusal.status).toBe(409);
    expect(refusal.body).toMatchObject({ code: "VERSION_CONFLICT" });
  });

  it("uses the host's outward copy, and rethrows an unmapped error unchanged", async () => {
    const failing = (error: Error) => deps({ outwardErrorMessage: ({ error: e }) => `host: ${e.message}`, updateFormDefinition: async () => { throw error; } });
    const { FormDefinitionNotFoundError } = await import("../../../../forms/index.js");
    expect(await refusalOf(() => handle({}, failing(new FormDefinitionNotFoundError({ message: "gone" }))))).toEqual({ status: 404, body: { error: "host: gone", code: "FORMS_DEFINITION_NOT_FOUND" } });
    await expect(handle({}, failing(new Error("db down")))).rejects.toThrow("db down");
  });

  it("fails closed without an authorizer or principal", async () => {
    await expect(formsAuthoringRoute.handle({ input: { formId: "f", body: {}, idempotencyKey: undefined }, deps: deps(), context: undefined, authorize: recordingAuthorize().authorize })).rejects.toThrow(/no authenticated principal/);
    await expect(formsAuthoringRoute.handle({ input: { formId: "f", body: {}, idempotencyKey: undefined }, deps: deps(), context: PRINCIPAL, authorize: undefined })).rejects.toThrow(/no authorizer/);
  });
});
