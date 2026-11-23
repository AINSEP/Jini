import assert from "node:assert/strict";
import { test } from "vitest";

import type { FormSubmissionRecord, HtmlFormDefinitionRecord } from "../../../forms/index.js";
import {
  toAdminFormDefinitionListResponse,
  toAdminFormDefinitionResponse,
  toAdminFormSubmissionDto,
  toAdminFormSubmissionListResponse,
} from "../forms.js";

/**
 * @file Characterization of the admin forms DTO projections after they moved into the engine. The host
 * keeps its original response suite and the Express error mapping (`mapFormsWriteError`, which writes to
 * an Express `Response`); this file pins the DTOs' wire shape here so the engine copy is verified on its own.
 */

// Mutation rejected: return the original fields/notify arrays rather than copies; changing the
// response would then corrupt the read model.
test("form definition responses clone field objects and notification recipients", () => {
  const definition = {
    id: "form-7", workspaceId: "ws-9", name: "Contact", slug: "contact",
    fields: [{ id: "email", label: "Email address", type: "email" as const, required: true, maxLength: 123, className: "wide", attributes: { placeholder: "Your email" } }],
    notify: { enabled: true, recipients: ["ops@example.org", "audit@example.org"] }, status: "active" as const,
    createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-02T00:00:00Z", version: 4,
  } as unknown as HtmlFormDefinitionRecord;
  const single = toAdminFormDefinitionResponse(definition);
  assert.deepEqual(single, { data: {
    id: "form-7", workspaceId: "ws-9", name: "Contact", slug: "contact",
    fields: [{ id: "email", label: "Email address", type: "email", required: true, maxLength: 123, className: "wide", attributes: { placeholder: "Your email" } }],
    mode: "builder", html: undefined,
    notify: { enabled: true, recipients: ["ops@example.org", "audit@example.org"] }, status: "active",
    createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-02T00:00:00Z", version: 4,
  } });
  const list = toAdminFormDefinitionListResponse({ definitions: [definition] });
  const [singleField] = single.data.fields;
  if (singleField) singleField.label = "Changed in response";
  single.data.notify.enabled = false;
  single.data.notify.recipients.push("new@example.org");
  list.data[0]?.fields.push({ id: "extra", label: "Extra", type: "text", required: false });
  if (list.data[0]) list.data[0].notify.recipients[0] = "replaced@example.org";
  assert.deepEqual(definition.fields, [{ id: "email", label: "Email address", type: "email", required: true, maxLength: 123, className: "wide", attributes: { placeholder: "Your email" } }]);
  assert.deepEqual(definition.notify, { enabled: true, recipients: ["ops@example.org", "audit@example.org"] });
  assert.deepEqual(toAdminFormDefinitionListResponse({ definitions: [] }), { data: [] });
});

// Mutations rejected: hard-code mode to builder, or omit the authored HTML.
for (const mode of ["html", "builder"] as const) {
  test(`form responses preserve explicit ${mode} authoring mode and markup`, () => {
    const definition = {
      id: "authored-8", workspaceId: "ws-9", name: "Feedback", slug: "feedback", mode,
      html: '<input name="message" required>',
      fields: [{ id: "message", label: "Message", type: "text" as const, required: true }],
      notify: { enabled: false, recipients: [] }, status: "active" as const, version: 1,
      createdAt: "2026-10-01T02:03:04Z", updatedAt: "2026-10-02T03:04:05Z",
    } as unknown as HtmlFormDefinitionRecord;
    const expected = {
      id: "authored-8", workspaceId: "ws-9", name: "Feedback", slug: "feedback", mode,
      html: '<input name="message" required>',
      fields: [{ id: "message", label: "Message", type: "text", required: true }],
      notify: { enabled: false, recipients: [] }, status: "active",
      createdAt: "2026-10-01T02:03:04Z", updatedAt: "2026-10-02T03:04:05Z", version: 1,
    };
    assert.deepEqual(toAdminFormDefinitionResponse(definition), { data: expected });
    assert.deepEqual(toAdminFormDefinitionListResponse({ definitions: [definition] }), { data: [expected] });
  });
}

test("a submission DTO keeps an expired (null) IP as an empty string and copies the answers", () => {
  const data = { email: "a@example.com" };
  const submission = {
    id: "s1", formDefinitionId: "f1", workspaceId: "w1", data, sourceIp: null, submittedAt: "2026-01-01T00:00:00.000Z",
  } as unknown as FormSubmissionRecord;
  const dto = toAdminFormSubmissionDto(submission);
  assert.deepEqual(dto, { id: "s1", formDefinitionId: "f1", workspaceId: "w1", data, sourceIp: "", submittedAt: "2026-01-01T00:00:00.000Z" });
  assert.notEqual(dto.data, data);
  assert.deepEqual(toAdminFormSubmissionListResponse({ items: [submission], nextCursor: "c2" }), { data: [dto], nextCursor: "c2" });
});
