import { RecordVersionConflictError } from "@jini-ai/core/optimistic-concurrency";
import { describe, expect, it, vi } from "vitest";
import { ForbiddenError } from "../../../../core/index.js";
import { FormFieldValidationError, FormSlugConflictError, FormSubmissionNotFoundError } from "../../../../forms/index.js";
import { formsUpdateRoute, type FormsUpdateRouteDeps } from "../update.js";
import { formsWriteErrorAnswer } from "../write-error.js";
import { fakeDefinition, PRINCIPAL, raw, recordingAuthorize, refusalOf, WORKSPACE_ID } from "./helpers.js";

type Writes = { patches: unknown[]; statuses: unknown[]; options: unknown[] };

function deps(overrides: Partial<FormsUpdateRouteDeps> = {}): FormsUpdateRouteDeps & Writes {
  const writes: Writes = { patches: [], statuses: [], options: [] };
  return {
    ...writes,
    workspaceId: WORKSPACE_ID,
    outwardErrorMessage: ({ error }) => error.message,
    versionedUpdateMessages: {
      mixedStatus: "Save the form and change its status as two separate actions.",
      missingDefinition: "Send at least one form field you want to change.",
      stale: "This form changed since you opened it. Reload it before saving.",
    },
    formDefinitionRepo: { findById: async ({ id }) => (id === "form-1" ? fakeDefinition() : null) },
    updateFormDefinition: async ({ input }, optional) => { writes.patches.push(input); writes.options.push(optional); return { definition: fakeDefinition({ name: input.patch.name ?? "Contact", version: 2 }) }; },
    setFormDefinitionStatus: async ({ input }) => { writes.statuses.push(input); return { definition: fakeDefinition({ status: input.status, version: 3 }) }; },
    ...overrides,
  };
}

const call = (body: Record<string, unknown>, d: FormsUpdateRouteDeps, formId = "form-1") =>
  formsUpdateRoute.handle({ input: { formId, body }, deps: d, context: PRINCIPAL, authorize: recordingAuthorize().authorize });

describe("formsUpdateRoute", () => {
  it("a versioned definition PUT forwards the basis separately from the patch", async () => {
    const d = deps();
    const patch = { name: "New", fields: [{ id: "a" }], notify: { enabled: true, recipients: [] }, provider: "p" };
    const result = await call({ ...patch, expectedVersion: 0, slug: "ignored", mode: "html", html: "<form></form>" }, d);
    expect(d.patches).toEqual([{ workspaceId: WORKSPACE_ID, actor: { id: "principal-1", kind: "user" }, formId: "form-1", patch }]);
    expect(d.options).toEqual([{ expectedVersion: 0 }]);
    expect(d.statuses).toEqual([]);
    expect(result.ok && result.value.data).toMatchObject({ name: "New", version: 2 });
  });

  it("a versioned PUT with any status key refuses before either write", async () => {
    const findById = vi.fn(async () => fakeDefinition());
    const d = deps({ formDefinitionRepo: { findById } });
    for (const status of ["disabled", "archived", undefined]) {
      expect(await refusalOf(() => call({ expectedVersion: 1, name: "New", status }, d))).toEqual({
        status: 400, body: { error: d.versionedUpdateMessages.mixedStatus, code: "VALIDATION_ERROR" },
      });
    }
    expect(d.patches).toEqual([]);
    expect(d.statuses).toEqual([]);
    expect(findById).not.toHaveBeenCalled();
  });

  it("a versioned PUT with no definition fields refuses before lookup or write", async () => {
    const findById = vi.fn(async () => fakeDefinition());
    const d = deps({ formDefinitionRepo: { findById } });
    for (const body of [{ expectedVersion: 1 }, { expectedVersion: 1, slug: "ignored", mode: "html", html: "<form></form>", name: 7, fields: {} }]) {
      expect(await refusalOf(() => call(body, d))).toEqual({
        status: 400, body: { error: d.versionedUpdateMessages.missingDefinition, code: "VALIDATION_ERROR" },
      });
    }
    expect(findById).not.toHaveBeenCalled();
    expect(d.patches).toEqual([]);
    expect(d.statuses).toEqual([]);
  });

  it("malformed expectedVersion is a 400 without a write", async () => {
    const findById = vi.fn(async () => fakeDefinition());
    const d = deps({ formDefinitionRepo: { findById } });
    for (const expectedVersion of ["1", null, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(await refusalOf(() => call({ expectedVersion, name: "New" }, d))).toEqual({
        status: 400, body: { error: "'expectedVersion' must be a non-negative integer when present", code: "VALIDATION_ERROR" },
      });
    }
    expect(d.patches).toEqual([]);
    expect(d.statuses).toEqual([]);
    expect(findById).not.toHaveBeenCalled();
  });

  it("a stale ordinary PUT uses the injected copy and keeps VERSION_CONFLICT details", async () => {
    const d = deps({
      outwardErrorMessage: () => "unclassified conflict copy",
      versionedUpdateMessages: { mixedStatus: "separate actions", missingDefinition: "definition required", stale: "host stale copy" },
      updateFormDefinition: async () => { throw new RecordVersionConflictError({ recordKind: "form_definition", recordId: "form-1", expectedVersion: 1, currentVersion: 2 }); },
    });
    expect(await refusalOf(() => call({ expectedVersion: 1, name: "New" }, d))).toEqual({
      status: 409,
      body: { error: "host stale copy", code: "VERSION_CONFLICT", details: { recordKind: "form_definition", recordId: "form-1", expectedVersion: 1, currentVersion: 2 } },
    });
    expect(d.statuses).toEqual([]);
  });

  it("unversioned empty, status-only and mixed requests keep their current behavior", async () => {
    const findById = vi.fn(async () => fakeDefinition());
    const d = deps({ formDefinitionRepo: { findById } });
    const writer = vi.spyOn(d, "updateFormDefinition");
    const statusWriter = vi.spyOn(d, "setFormDefinitionStatus");
    for (const body of [{}, { slug: "ignored", mode: "html", html: "<form></form>" }]) {
      const result = await call(body, d);
      expect(result.ok && result.value.data).toMatchObject({ name: "Contact", status: "active", version: 1 });
    }
    const status = await call({ status: "disabled" }, d);
    expect(status.ok && status.value.data).toMatchObject({ status: "disabled", version: 3 });
    const mixed = await call({ name: "New", status: "active" }, d);
    expect(mixed.ok && mixed.value.data).toMatchObject({ status: "active", version: 3 });
    const target = { workspaceId: WORKSPACE_ID, actor: { id: "principal-1", kind: "user" }, formId: "form-1" };
    expect(writer.mock.calls).toEqual([[{ input: { ...target, patch: { name: "New" } } }]]);
    expect(statusWriter.mock.calls).toEqual([[{ input: { ...target, status: "disabled" } }], [{ input: { ...target, status: "active" } }]]);
    expect(writer.mock.invocationCallOrder[0]).toBeLessThan(statusWriter.mock.invocationCallOrder[1]!);
    expect(findById).toHaveBeenCalledTimes(2);
  });

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

const plain = ({ error }: { error: Error }) => error.message;

describe("formsWriteErrorAnswer", () => {
  it("fills every recognized answer's copy from the host's outward message, keeping status, code and details", () => {
    const hosted = ({ error }: { error: Error }) => `host: ${error.message}`;
    expect(formsWriteErrorAnswer({ outwardErrorMessage: hosted, err: new FormSlugConflictError({ message: "taken", slug: "contact" }) })).toEqual({ status: 409, body: { error: "host: taken", code: "FORMS_SLUG_CONFLICT", details: { slug: "contact" } } });
    const update = formsUpdateRoute.handle({ input: { formId: "nope", body: {} }, deps: { ...deps(), outwardErrorMessage: hosted }, context: PRINCIPAL, authorize: recordingAuthorize().authorize });
    return expect(refusalOf(() => update)).resolves.toEqual({ status: 404, body: { error: "host: form definition 'nope' was not found", code: "FORMS_DEFINITION_NOT_FOUND" } });
  });

  it("maps each recognized class to its status and body, and nothing else", () => {
    expect(formsWriteErrorAnswer({ outwardErrorMessage: plain, err: new FormSlugConflictError({ message: "taken", slug: "contact" }) })).toEqual({ status: 409, body: { error: "taken", code: "FORMS_SLUG_CONFLICT", details: { slug: "contact" } } });
    expect(formsWriteErrorAnswer({ outwardErrorMessage: plain, err: new FormSubmissionNotFoundError({ message: "gone" } as never) })).toMatchObject({ status: 404, body: { code: "FORMS_SUBMISSION_NOT_FOUND" } });
    const forbidden = new ForbiddenError({ permission: "admin.forms.manage", reason: "no-role" } as never);
    expect(formsWriteErrorAnswer({ outwardErrorMessage: plain, err: forbidden })).toEqual({ status: 403, body: { error: forbidden.message, code: "FORBIDDEN", details: { permission: forbidden.permission, reason: forbidden.reason } } });
    const conflict = new RecordVersionConflictError({ recordKind: "form_definition", recordId: "form-1", expectedVersion: 1, currentVersion: 2 } as never);
    expect(formsWriteErrorAnswer({ outwardErrorMessage: plain, err: conflict })).toMatchObject({ status: 409, body: { code: "VERSION_CONFLICT" } });
    expect(formsWriteErrorAnswer({ outwardErrorMessage: plain, err: new Error("private db path") })).toBeUndefined();
  });
});
