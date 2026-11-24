import { describe, expect, it } from "vitest";
import type { FormSubmissionsPullPort, FormSubmissionsPullResult } from "../../../../forms/site/import-remote-submissions.js";
import { FormsPullFailedError, formsPullSubmissionsRoute } from "../pull-submissions.js";
import { denyingAuthorize, PRINCIPAL, raw, recordingAuthorize, refusalOf, WORKSPACE_ID } from "./helpers.js";

const REPORT: FormSubmissionsPullResult = { ran: true, message: "No new submissions.", destinations: [], forms: [], totals: { imported: 0, alreadyImported: 0, unmapped: 0, failed: 0 } };
const BAD_TARGET = { status: 400, body: {
  error: "targetId must be a hosting target id of 1-64 characters, or omitted to pull from every published site", code: "FORMS_FIELD_VALIDATION_ERROR",
  details: { fieldErrors: [{ field: "targetId", reason: "must be 1-64 characters" }] },
} };
const UNAVAILABLE = { status: 503, body: { error: "pulling form submissions is not available on this site's server; restart the site, then try again", code: "FORMS_PULL_UNAVAILABLE" } };

/** A recording pull port that answers {@link REPORT}. */
function pullSpy(): { calls: unknown[][]; port: FormSubmissionsPullPort } {
  const calls: unknown[][] = [];
  return { calls, port: { pull: async (...args) => { calls.push(args); return REPORT; } } };
}

const call = (body: unknown, formSubmissionsPull: FormSubmissionsPullPort | undefined, authorize = recordingAuthorize().authorize) =>
  formsPullSubmissionsRoute.handle({ input: { body }, deps: { workspaceId: WORKSPACE_ID, formSubmissionsPull }, context: PRINCIPAL, authorize });

describe("formsPullSubmissionsRoute", () => {
  it("is the workspace pull POST and passes the raw body through parse unchecked", () => {
    expect(formsPullSubmissionsRoute.method).toBe("post");
    expect(formsPullSubmissionsRoute.path).toBe("/api/admin/v1/workspaces/:workspaceId/forms/submissions/pull");
    expect(formsPullSubmissionsRoute.parse(raw({}, { body: { targetId: 7 } }))).toEqual({ ok: true, value: { body: { targetId: 7 } } });
  });

  it("authorizes id-free and forwards the optional target to the pull port", async () => {
    const { authorize, calls } = recordingAuthorize();
    const spy = pullSpy();
    for (const body of [undefined, null, "text", [], {}, { targetId: undefined }, { targetId: "host-a" }, { targetId: "x".repeat(64) }]) {
      expect(await call(body, spy.port, authorize)).toEqual({ ok: true, value: REPORT });
    }
    expect(calls[0]).toEqual({ permission: "admin.forms.manage", entityType: "form_submission" });
    expect(calls).toHaveLength(8);
    expect(spy.calls.map(([, optional]) => optional)).toEqual([{}, {}, {}, {}, {}, {}, { targetId: "host-a" }, { targetId: "x".repeat(64) }]);
    expect(spy.calls.every(([required]) => JSON.stringify(required) === JSON.stringify({ workspaceId: WORKSPACE_ID }))).toBe(true);
  });

  it("refuses an invalid target before the unavailable port, and never pulls", async () => {
    const spy = pullSpy();
    for (const targetId of [null, "", 7, false, {}, [], "x".repeat(65)]) {
      expect(await refusalOf(() => call({ targetId }, undefined))).toEqual(BAD_TARGET);
      expect(await refusalOf(() => call({ targetId }, spy.port))).toEqual(BAD_TARGET);
    }
    expect(spy.calls).toEqual([]);
  });

  it("answers an unwired pull port with the 503 and its next step", async () => {
    expect(await refusalOf(() => call(undefined, undefined))).toEqual(UNAVAILABLE);
  });

  it("checks the permission before the body and the pull", async () => {
    const spy = pullSpy();
    expect(await refusalOf(() => call({ targetId: "" }, spy.port, denyingAuthorize))).toEqual({ status: 403, body: { error: "denied", code: "FORBIDDEN" } });
    expect(spy.calls).toEqual([]);
  });

  it("wraps a thrown pull in FormsPullFailedError carrying the original cause", async () => {
    const cause = new Error("private pull failure");
    const failure = await Promise.resolve().then(() => call(undefined, { pull: async () => { throw cause; } })).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(FormsPullFailedError);
    expect((failure as FormsPullFailedError).cause).toBe(cause);
    expect((failure as Error).message).not.toContain("private pull failure");
  });
});
