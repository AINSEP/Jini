import { describe, expect, it } from "vitest";
import { formsGetSubmissionRoute } from "../get-submission.js";
import { formsListSubmissionsRoute } from "../list-submissions.js";
import { fakeSubmission, PRINCIPAL, raw, recordingAuthorize, refusalOf, seededRepos, WORKSPACE_ID } from "./helpers.js";

const READ = { permission: "admin.forms.submissions.read", entityType: "form_submission" };
const NOT_FOUND_FORM = { status: 404, body: { error: "form definition 'nope' was not found", code: "FORMS_DEFINITION_NOT_FOUND" } };

describe("formsListSubmissionsRoute", () => {
  it("passes formId and the raw limit/cursor through parse unchecked", () => {
    expect(formsListSubmissionsRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/forms/:formId/submissions");
    expect(formsListSubmissionsRoute.parse(raw({ formId: "contact" }, { query: { limit: "x", cursor: 3 } }))).toEqual({ ok: true, value: { formId: "contact", limit: "x", cursor: 3 } });
  });

  it("authorizes id-free and lists the resolved definition's submissions", async () => {
    const { authorize, calls } = recordingAuthorize();
    const result = await formsListSubmissionsRoute.handle({ input: { formId: "contact", limit: "10", cursor: undefined }, deps: { workspaceId: WORKSPACE_ID, ...(await seededRepos()) }, context: PRINCIPAL, authorize });
    expect(calls).toEqual([READ]);
    if (!result.ok) throw new Error("expected success");
    expect(result.value.data.map((s) => s.id)).toEqual(["sub-1"]);
  });

  it("checks the definition before the query, then refuses a bad limit or cursor with field details", async () => {
    const deps = { workspaceId: WORKSPACE_ID, ...(await seededRepos()) };
    const call = (input: { formId: string; limit: unknown; cursor: unknown }) => formsListSubmissionsRoute.handle({ input, deps, context: PRINCIPAL, authorize: recordingAuthorize().authorize });
    expect(await refusalOf(() => call({ formId: "nope", limit: "0", cursor: undefined }))).toEqual(NOT_FOUND_FORM);
    expect(await refusalOf(() => call({ formId: "contact", limit: "101", cursor: undefined }))).toEqual({ status: 400, body: {
      error: "limit must be an integer between 1 and 100", code: "FORMS_FIELD_VALIDATION_ERROR", details: { fieldErrors: [{ field: "limit", reason: "must be 1-100" }] },
    } });
    expect(await refusalOf(() => call({ formId: "contact", limit: undefined, cursor: ["a"] }))).toEqual({ status: 400, body: {
      error: "cursor must be a string", code: "FORMS_FIELD_VALIDATION_ERROR", details: { fieldErrors: [{ field: "cursor", reason: "must be a string" }] },
    } });
  });
});

describe("formsGetSubmissionRoute", () => {
  it("authorizes the submission id and adds the host's delivery summary when reported", async () => {
    expect(formsGetSubmissionRoute.parse(raw({}))).toEqual({ ok: true, value: { formId: "", submissionId: "" } });
    const { authorize, calls } = recordingAuthorize();
    const formDeliveryStatus = { notificationSummary: async () => ({ failed: 1, pending: 2 }) };
    const result = await formsGetSubmissionRoute.handle({ input: { formId: "contact", submissionId: "sub-1" }, deps: { workspaceId: WORKSPACE_ID, ...(await seededRepos()), formDeliveryStatus }, context: PRINCIPAL, authorize });
    expect(calls).toEqual([{ ...READ, entityId: "sub-1" }]);
    if (!result.ok) throw new Error("expected success");
    expect(result.value.data).toMatchObject({ id: "sub-1", notificationDelivery: { failed: 1, pending: 2 } });
  });

  it("reads a submission of another form as not-found, like a missing one", async () => {
    const repos = await seededRepos();
    await repos.formSubmissionRepo.create(fakeSubmission({ id: "sub-other", formDefinitionId: "form-2" }));
    const call = (formId: string, submissionId: string) => formsGetSubmissionRoute.handle({ input: { formId, submissionId }, deps: { workspaceId: WORKSPACE_ID, ...repos }, context: PRINCIPAL, authorize: recordingAuthorize().authorize });
    expect(await refusalOf(() => call("nope", "sub-1"))).toEqual(NOT_FOUND_FORM);
    expect(await refusalOf(() => call("contact", "sub-other"))).toEqual({ status: 404, body: { error: "submission 'sub-other' was not found", code: "FORMS_SUBMISSION_NOT_FOUND" } });
  });
});

it.each(["0", "1.5"] as const)("refuses an out-of-bound or fractional limit %s", async (limit) => {
  const deps = { workspaceId: WORKSPACE_ID, ...(await seededRepos()) };
  expect(await refusalOf(() => formsListSubmissionsRoute.handle({
    input: { formId: "contact", limit, cursor: undefined }, deps, context: PRINCIPAL, authorize: recordingAuthorize().authorize,
  }))).toEqual({ status: 400, body: {
    error: "limit must be an integer between 1 and 100", code: "FORMS_FIELD_VALIDATION_ERROR",
    details: { fieldErrors: [{ field: "limit", reason: "must be 1-100" }] },
  } });
});
