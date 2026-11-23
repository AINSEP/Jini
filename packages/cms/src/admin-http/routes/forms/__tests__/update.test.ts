import { RecordVersionConflictError } from "@jini-ai/core/optimistic-concurrency";
import { describe, expect, it } from "vitest";
import { ForbiddenError } from "../../../../core/index.js";
import { FormFieldValidationError, FormSlugConflictError, FormSubmissionNotFoundError } from "../../../../forms/index.js";
import { formsUpdateRoute, type FormsUpdateRouteDeps } from "../update.js";
import { formsWriteErrorAnswer } from "../write-error.js";
import { fakeDefinition, PRINCIPAL, raw, recordingAuthorize, refusalOf, WORKSPACE_ID } from "./helpers.js";

type Writes = { patches: unknown[]; statuses: unknown[] };

function deps(overrides: Partial<FormsUpdateRouteDeps> = {}): FormsUpdateRouteDeps & Writes {
  const writes: Writes = { patches: [], statuses: [] };
  return {
    ...writes,
    workspaceId: WORKSPACE_ID,
    formDefinitionRepo: { findById: async ({ id }) => (id === "form-1" ? fakeDefinition() : null) },
    updateFormDefinition: async ({ input }) => { writes.patches.push(input); return { definition: fakeDefinition({ name: input.patch.name ?? "Contact", version: 2 }) }; },
    setFormDefinitionStatus: async ({ input }) => { writes.statuses.push(input); return { definition: fakeDefinition({ status: input.status, version: 3 }) }; },
    ...overrides,
  };
}

const call = (body: Record<string, unknown>, d: FormsUpdateRouteDeps, formId = "form-1") =>
  formsUpdateRoute.handle({ input: { formId, body }, deps: d, context: PRINCIPAL, authorize: recordingAuthorize().authorize });

describe("formsUpdateRoute", () => {
  it("keeps the path and defaults a missing formId and body", () => {
    expect(formsUpdateRoute.method).toBe("put");
    expect(formsUpdateRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/forms/:formId");
    expect(formsUpdateRoute.parse(raw({}))).toEqual({ ok: true, value: { formId: "", body: {} } });
  });

  it("authorizes the form, writes only recognized patch keys, then a valid status, as the principal", async () => {
    const { authorize, calls } = recordingAuthorize();
    const d = deps();
    const result = await formsUpdateRoute.handle({ input: { formId: "form-1", body: { name: "New", slug: "ignored", mode: "html", status: "disabled" } }, deps: d, context: PRINCIPAL, authorize });
    expect(calls).toEqual([{ permission: "admin.forms.manage", entityType: "form_definition", entityId: "form-1" }]);
    const target = { workspaceId: WORKSPACE_ID, actor: { id: "principal-1", kind: "user" }, formId: "form-1" };
    expect(d.patches).toEqual([{ ...target, patch: { name: "New" } }]);
    expect(d.statuses).toEqual([{ ...target, status: "disabled" }]);
    if (!result.ok) throw new Error("expected success");
    expect(result.value.data).toMatchObject({ status: "disabled", version: 3 });
  });

  it("reads without writing when nothing recognized is sent, and 404s an unknown form", async () => {
    const d = deps();
    const result = await call({ status: "archived" }, d);
    expect(d.patches).toEqual([]);
    expect(d.statuses).toEqual([]);
    expect(result.ok && result.value.data.version).toBe(1);
    expect(await refusalOf(() => call({}, deps(), "nope"))).toEqual({ status: 404, body: { error: "form definition 'nope' was not found", code: "FORMS_DEFINITION_NOT_FOUND" } });
  });

  it("maps write-service errors and rethrows anything unrecognized", async () => {
    const failing = (error: Error) => deps({ updateFormDefinition: async () => { throw error; } });
    expect(await refusalOf(() => call({ name: "x" }, failing(new FormFieldValidationError({ message: "bad", fieldErrors: [{ field: "name", reason: "empty" }] }))))).toEqual({
      status: 400, body: { error: "bad", code: "FORMS_FIELD_VALIDATION_ERROR", details: { fieldErrors: [{ field: "name", reason: "empty" }] } },
    });
    await expect(call({ name: "x" }, failing(new Error("db down")))).rejects.toThrow("db down");
  });
});

describe("formsWriteErrorAnswer", () => {
  it("maps each recognized class to its status and body, and nothing else", () => {
    expect(formsWriteErrorAnswer({ err: new FormSlugConflictError({ message: "taken", slug: "contact" }) })).toEqual({ status: 409, body: { error: "taken", code: "FORMS_SLUG_CONFLICT", details: { slug: "contact" } } });
    expect(formsWriteErrorAnswer({ err: new FormSubmissionNotFoundError({ message: "gone" } as never) })).toMatchObject({ status: 404, body: { code: "FORMS_SUBMISSION_NOT_FOUND" } });
    const forbidden = new ForbiddenError({ permission: "admin.forms.manage", reason: "no-role" } as never);
    expect(formsWriteErrorAnswer({ err: forbidden })).toEqual({ status: 403, body: { error: forbidden.message, code: "FORBIDDEN", details: { permission: forbidden.permission, reason: forbidden.reason } } });
    const conflict = new RecordVersionConflictError({ recordKind: "form_definition", recordId: "form-1", expectedVersion: 1, currentVersion: 2 } as never);
    expect(formsWriteErrorAnswer({ err: conflict })).toMatchObject({ status: 409, body: { code: "VERSION_CONFLICT" } });
    expect(formsWriteErrorAnswer({ err: new Error("private db path") })).toBeUndefined();
  });
});
