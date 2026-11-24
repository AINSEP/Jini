import { isRouteReply } from "@jini-ai/core/contracts/server";
import { describe, expect, it } from "vitest";
import { formsDeleteSubmissionRoute, type FormsDeleteSubmissionRouteDeps } from "../delete-submission.js";
import { denyingAuthorize, PRINCIPAL, raw, recordingAuthorize, refusalOf, seededRepos, WORKSPACE_ID } from "./helpers.js";

async function deps(overrides: Partial<FormsDeleteSubmissionRouteDeps> = {}): Promise<FormsDeleteSubmissionRouteDeps & { removed: unknown[] }> {
  const removed: unknown[] = [];
  return {
    removed,
    workspaceId: WORKSPACE_ID,
    ...(await seededRepos()),
    clock: { nowMs: () => 0 },
    removeFormSubmission: async (input) => { removed.push(input); return { ok: true } as never; },
    ...overrides,
  };
}

const handle = (d: FormsDeleteSubmissionRouteDeps, input = { formId: "contact", submissionId: "sub-1" }, authorize = recordingAuthorize().authorize) =>
  formsDeleteSubmissionRoute.handle({ input, deps: d, context: PRINCIPAL, authorize });

describe("formsDeleteSubmissionRoute", () => {
  it("pins the method, path, default success status and no body cap", () => {
    expect(formsDeleteSubmissionRoute.method).toBe("delete");
    expect(formsDeleteSubmissionRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/forms/:formId/submissions/:submissionId");
    expect(formsDeleteSubmissionRoute.successStatus).toBeUndefined();
    expect(formsDeleteSubmissionRoute.maxBodyBytes).toBeUndefined();
  });

  it("parses both params with the empty-string fallback", () => {
    expect(formsDeleteSubmissionRoute.parse(raw({}))).toEqual({ ok: true, value: { formId: "", submissionId: "" } });
    expect(formsDeleteSubmissionRoute.parse(raw({ formId: "f", submissionId: "s" }))).toEqual({ ok: true, value: { formId: "f", submissionId: "s" } });
  });

  it("authorizes admin.forms.submissions.delete on the submission, even for an empty id", async () => {
    const { authorize, calls } = recordingAuthorize();
    await handle(await deps(), undefined, authorize);
    await handle(await deps(), { formId: "contact", submissionId: "" }, authorize).catch(() => undefined);
    expect(calls).toEqual([
      { permission: "admin.forms.submissions.delete", entityType: "form_submission", entityId: "sub-1" },
      { permission: "admin.forms.submissions.delete", entityType: "form_submission", entityId: "" },
    ]);
  });

  it("a refused authorization stops every read and write", async () => {
    const d = await deps();
    expect(await refusalOf(() => handle(d, undefined, denyingAuthorize))).toEqual({ status: 403, body: { error: "denied", code: "FORBIDDEN" } });
    expect(d.removed).toEqual([]);
  });

  it("moves the submission to the trash by slug or id and answers a bare 204", async () => {
    for (const formId of ["contact", "form-1"]) {
      const d = await deps();
      const result = await handle(d, { formId, submissionId: "sub-1" });
      expect(d.removed).toEqual([{ workspaceId: WORKSPACE_ID, id: "sub-1", display: { title: "Contact", subtitle: "2026-01-02T00:00:00.000Z" }, at: "1970-01-01T00:00:00.000Z", expectedVersion: null, actor: { principalId: "principal-1", pluginId: null } }]);
      expect(result.ok && isRouteReply(result.value) && result.value).toMatchObject({ status: 204 });
      expect(result.ok && (result.value as { body?: unknown }).body).toBeUndefined();
    }
  });

  it("refuses an unknown form and a missing or foreign submission as 404 with their codes", async () => {
    const d = await deps();
    expect(await refusalOf(() => handle(d, { formId: "nope", submissionId: "sub-1" }))).toEqual({ status: 404, body: { error: "form definition 'nope' was not found", code: "FORMS_DEFINITION_NOT_FOUND" } });
    expect(await refusalOf(() => handle(d, { formId: "contact", submissionId: "nope" }))).toEqual({ status: 404, body: { error: "submission 'nope' was not found", code: "FORMS_SUBMISSION_NOT_FOUND" } });
    expect(d.removed).toEqual([]);
  });

  it("refuses a trash version change as 409 TRASH_VERSION_CHANGED, and a trash not-found as 404", async () => {
    const changed = await deps({ removeFormSubmission: async () => ({ ok: false, reason: "version-changed" }) as never });
    expect(await refusalOf(() => handle(changed))).toEqual({ status: 409, body: { error: "submission 'sub-1' changed while it was being deleted", code: "TRASH_VERSION_CHANGED" } });
    const gone = await deps({ removeFormSubmission: async () => ({ ok: false, reason: "not-found" }) as never });
    expect(await refusalOf(() => handle(gone))).toMatchObject({ status: 404, body: { code: "FORMS_SUBMISSION_NOT_FOUND" } });
  });

  it("rethrows an unexpected failure unchanged (the host's 500) and fails closed without a principal", async () => {
    const d = await deps({ removeFormSubmission: async () => { throw new Error("db down"); } });
    await expect(handle(d)).rejects.toThrow("db down");
    await expect(formsDeleteSubmissionRoute.handle({ input: { formId: "contact", submissionId: "sub-1" }, deps: await deps(), context: undefined, authorize: recordingAuthorize().authorize })).rejects.toThrow(/no authenticated principal/);
  });
});
