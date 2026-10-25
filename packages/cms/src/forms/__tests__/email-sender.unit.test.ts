import assert from "node:assert/strict";
import { test } from "vitest";
import { EmailSenderError, prepareSenderEmail, type EmailBindingInput, type EmailTemplatePort } from "@jini-ai/platform/mail/senders";
import { createFormsEmailSender, type FormEmailAction, type FormsEmailSenderDeps } from "../email-sender.js";
import { deriveHtmlForm } from "../html/html-authoring.js";
import type { FieldDescriptor, FormDefinitionRecord, FormSubmissionRecord } from "../types.js";

const context = { workspaceId: "w1", principalId: "owner", sourceId: "contact" };
const input: EmailBindingInput = { bindingId: "reply", templateId: "thanks", recipientId: "email", replyTo: "owner@example.org", enabled: true };
const field = ({ id, type = "text" }: { id: string; type?: FieldDescriptor["type"] }, _optional: Record<string, never> = {}): FieldDescriptor => ({ id, name: id, label: `Label ${id}`, type, required: true });
function fixture() {
  const definition: FormDefinitionRecord = { id: "contact", workspaceId: "w1", name: "Contact", slug: "contact",
    fields: [field({ id: "person" }), field({ id: "email", type: "email" }), { ...field({ id: "message", type: "textarea" }), required: false }],
    notify: { enabled: true, recipients: ["private-owner@example.org"] }, status: "active", createdAt: "2026-10-22", updatedAt: "2026-10-22", version: 1 };
  const submission: FormSubmissionRecord = { id: "s1", workspaceId: "w1", formDefinitionId: "contact",
    data: { person: "Ada", email: "ada@example.org" }, sourceIp: "203.0.113.1", submittedAt: "2026-10-22T20:00:00Z" };
  let saved: FormEmailAction | null = null;
  const writes: Parameters<FormsEmailSenderDeps["writeEmailBinding"]>[0][] = [];
  const renders: Parameters<EmailTemplatePort["render"]>[0][] = [];
  const templates: EmailTemplatePort = {
    describe: async () => ({ version: "v1", fields: ["person", "site_name", "message"], placeholders: ["person", "site_name", "message"] }),
    render: async request => { renders.push(request); return { subject: `Hello ${request.values.person}`, html: "<p>Thanks</p>", text: "Thanks", missingFields: [] }; },
  };
  const deps: FormsEmailSenderDeps = {
    definitions: { list: async () => [definition], findById: async () => definition },
    submissions: { findById: async () => submission },
    authorize: async request => request.workspaceId === "w1" && request.principalId === "owner",
    readEmailBinding: async () => saved,
    writeEmailBinding: async request => { writes.push(request); saved = { ...request.binding, activatedAt: request.binding.enabled ? "2026-10-22T19:00:00Z" : null }; return saved; },
    site: async () => ({ name: "Example site", url: "https://example.org" }),
    readiness: async () => ({ ready: true, blockers: [] }), templates,
  };
  return { definition, submission, deps, writes, renders, sender: createFormsEmailSender({ deps }), saved: () => saved };
}
const refusal = ({ code }: { code: EmailSenderError["code"] }, _optional: Record<string, never> = {}) => (error: unknown): boolean => error instanceof EmailSenderError && error.code === code;

test("Forms conforms to discovery, description, sender-owned configuration and event preparation", async () => {
  const f = fixture();
  f.definition.fields[2]!.default = "Preview/default value must not enter mail";
  assert.deepEqual(await f.sender.listSources(context), [{ senderId: "forms", sourceId: "contact", eventName: "form.submission.received", label: "Contact" }]);
  assert.equal((await f.sender.describeSource(context)).binding, null);
  await f.sender.configureEmail({ ...context, binding: input });
  assert.deepEqual(f.writes, [{ workspaceId: "w1", principalId: "owner", binding: { kind: "email", bindingId: "reply", formId: "contact", templateId: "thanks", submitterEmailFieldId: "email", replyTo: "owner@example.org", enabled: true } }]);
  assert.deepEqual(f.saved(), { ...f.writes[0]!.binding, activatedAt: "2026-10-22T19:00:00Z" });
  const prepared = await prepareSenderEmail({ ...context, sender: f.sender, templates: f.deps.templates, eventId: "s1" });
  assert.deepEqual(prepared, { bindingId: "reply", templateId: "thanks", templateVersion: "v1", to: { email: "ada@example.org" }, replyTo: { email: "owner@example.org" },
    subject: "Hello Ada", html: "<p>Thanks</p>", text: "Thanks", purpose: "transactional", lane: "notification", warnings: ["message"] });
  assert.deepEqual(f.renders[0]!.values, { person: "Ada", site_name: "Example site", message: "" });
  assert.deepEqual(f.definition.notify, { enabled: true, recipients: ["private-owner@example.org"] });
});

test("tokens follow stable builder ids, including every reserved-name collision", async () => {
  const f = fixture();
  f.definition.fields = [field({ id: "site_name" }), field({ id: "site_url" }), field({ id: "submitted_at" }), { ...field({ id: "person" }), label: "Name" }, field({ id: "email", type: "email" })];
  Object.assign(f.submission.data, { site_name: "Answer site", site_url: "Answer URL", submitted_at: "Answer time" });
  const first = await f.sender.describeSource(context);
  assert.deepEqual(first.fields.map(value => value.token), ["field.site_name", "field.site_url", "field.submitted_at", "person", "email", "site_name", "site_url", "submitted_at"]);
  assert.deepEqual(first.fields.find(value => value.token === "site_url"), { token: "site_url", label: "Site URL", required: true });
  f.definition.fields[3]!.label = "Renamed label";
  assert.deepEqual((await f.sender.describeSource(context)).fields.map(value => value.token), first.fields.map(value => value.token));
  const event = await f.sender.resolveEvent({ ...context, eventId: "s1" });
  assert.deepEqual(event.values, { "field.site_name": "Answer site", "field.site_url": "Answer URL", "field.submitted_at": "Answer time", person: "Ada", email: "ada@example.org", site_name: "Example site", site_url: "https://example.org", submitted_at: "2026-10-22T20:00:00Z" });
});

test("HTML-mode tokens come from authored control names, never DOM ids or labels", async () => {
  const f = fixture();
  const authored = deriveHtmlForm({ html: '<label for="person-control">Your name</label><input id="person-control" name="person"><input name="email" type="email">' });
  Object.assign(f.definition, authored);
  const description = await f.sender.describeSource(context);
  assert.deepEqual(description.fields.map(value => value.token), ["person", "email", "site_name", "site_url", "submitted_at"]);
  assert.deepEqual(description.permittedRecipients, [{ id: "email", label: "email" }]);
  const event = await f.sender.resolveEvent({ ...context, eventId: "s1" });
  assert.deepEqual(event.values, { person: "Ada", email: "ada@example.org", site_name: "Example site", site_url: "https://example.org", submitted_at: "2026-10-22T20:00:00Z" });
  assert.deepEqual(event.recipients, [{ id: "email", address: { email: "ada@example.org" } }]);
});

test("files, hidden metadata, IPs, credential fields and credential-shaped answers never escape", async () => {
  const f = fixture();
  f.definition.fields.push(field({ id: "upload", type: "file" }), field({ id: "api_key" }), field({ id: "source_ip" }), field({ id: "internal", type: "hidden" }), field({ id: "notes" }));
  Object.assign(f.submission.data, { upload: { mediaId: "secret-file", filename: "private.pdf", contentType: "application/pdf", byteSize: 5 }, api_key: "private", source_ip: "203.0.113.9", internal: "hidden", notes: "password=private", extra: "not declared" });
  const description = await f.sender.describeSource(context);
  assert.deepEqual(description.fields.map(value => value.token), ["person", "email", "message", "notes", "site_name", "site_url", "submitted_at"]);
  const event = await f.sender.resolveEvent({ ...context, eventId: "s1" });
  assert.deepEqual(event, { occurredAt: "2026-10-22T20:00:00Z", values: { person: "Ada", email: "ada@example.org", site_name: "Example site", site_url: "https://example.org", submitted_at: "2026-10-22T20:00:00Z" }, recipients: [{ id: "email", address: { email: "ada@example.org" } }] });
  assert.equal(JSON.stringify(event).includes("private"), false);
});

test("all operations authorize before reads or writes, with separate event-read permission", async () => {
  const f = fixture(); let reads = 0;
  f.deps.definitions = { list: async () => { reads++; return []; }, findById: async () => { reads++; return f.definition; } };
  const sender = createFormsEmailSender({ deps: f.deps });
  const foreign = { ...context, workspaceId: "w2" };
  assert.deepEqual(await sender.listSources(foreign), []);
  await assert.rejects(sender.describeSource(foreign), refusal({ code: "forbidden" }));
  await assert.rejects(sender.resolveEvent({ ...foreign, eventId: "s1" }), refusal({ code: "forbidden" }));
  await assert.rejects(sender.configureEmail({ ...foreign, binding: input }), refusal({ code: "forbidden" }));
  assert.equal(reads, 0); assert.equal(f.writes.length, 0);
  f.deps.authorize = async request => request.operation !== "resolve";
  await assert.rejects(sender.resolveEvent({ ...context, eventId: "s1" }), refusal({ code: "forbidden" }));
});

test("a mis-scoped repository cannot leak a workspace, source, event or binding", async () => {
  const f = fixture();
  f.definition.workspaceId = "w2";
  assert.deepEqual(await f.sender.listSources(context), []);
  await assert.rejects(f.sender.describeSource(context), refusal({ code: "ownership" }));
  await assert.rejects(f.sender.configureEmail({ ...context, binding: input }), refusal({ code: "ownership" }));
  f.definition.workspaceId = "w1";
  for (const patch of [{ workspaceId: "w2" }, { formDefinitionId: "other" }]) {
    const original = { ...f.submission }; Object.assign(f.submission, patch);
    await assert.rejects(f.sender.resolveEvent({ ...context, eventId: "s1" }), refusal({ code: "ownership" }));
    Object.assign(f.submission, original);
  }
  f.deps.readEmailBinding = async () => ({ kind: "email", ...input, formId: "other", submitterEmailFieldId: "email", activatedAt: null });
  await assert.rejects(f.sender.describeSource(context), refusal({ code: "ownership" }));
  assert.equal(f.writes.length, 0);
});

test("only Email fields are recipients; ambiguous choices stay explicit and invalid mailboxes are absent", async () => {
  const f = fixture(); f.definition.fields.push(field({ id: "billing_email", type: "email" }));
  const described = await f.sender.describeSource(context);
  assert.deepEqual(described.permittedRecipients.map(value => value.id), ["email", "billing_email"]);
  await assert.rejects(f.sender.configureEmail({ ...context, binding: { ...input, recipientId: "person" } }), refusal({ code: "configuration" }));
  for (const address of ["a@example.org,b@example.org", "Ada <a@example.org>", "a@example.org\r\nBcc:b@example.org"]) {
    f.submission.data.email = address;
    assert.deepEqual((await f.sender.resolveEvent({ ...context, eventId: "s1" })).recipients, []);
  }
  await assert.rejects(f.sender.configureEmail({ ...context, binding: { ...input, replyTo: "owner@example.org\n" } }), refusal({ code: "configuration" }));
  assert.equal(f.writes.length, 0);
});

test("activation refuses readiness and compatibility failures without writing; drafts retain the blocker", async () => {
  const f = fixture();
  f.deps.readiness = async () => ({ ready: false, blockers: ["background_delivery_unavailable"] });
  assert.deepEqual((await f.sender.describeSource(context)).readiness, { ready: false, blockers: ["background_delivery_unavailable"] });
  await assert.rejects(f.sender.configureEmail({ ...context, binding: input }), refusal({ code: "not_ready" }));
  await f.sender.configureEmail({ ...context, binding: { ...input, enabled: false } });
  assert.equal(f.writes.length, 1);
  f.deps.readiness = async () => ({ ready: true, blockers: [] });
  f.deps.templates.describe = async () => ({ version: "v1", fields: ["not_a_field"], placeholders: ["not_a_field"] });
  await assert.rejects(f.sender.configureEmail({ ...context, binding: input }), refusal({ code: "incompatible" }));
  f.deps.templates.describe = async () => ({ version: "v1", fields: ["person"], placeholders: ["person", "email"] });
  await assert.rejects(f.sender.configureEmail({ ...context, binding: input }), refusal({ code: "incompatible" }));
  assert.equal(f.writes.length, 1);
});

test("reserved-name Email fields resolve their own answer, never the built-in value", async () => {
  const f = fixture();
  f.definition.fields = [field({ id: "site_name", type: "email" })];
  f.submission.data = { site_name: "submitter@example.org" };
  f.deps.site = async () => ({ name: "different@example.org", url: "https://example.org" });
  assert.deepEqual(await f.sender.resolveEvent({ ...context, eventId: "s1" }), {
    occurredAt: "2026-10-22T20:00:00Z",
    values: { "field.site_name": "submitter@example.org", site_name: "different@example.org", site_url: "https://example.org", submitted_at: "2026-10-22T20:00:00Z" },
    recipients: [{ id: "site_name", address: { email: "submitter@example.org" } }],
  });
});

test("disabled forms and absent Email fields report their specific readiness blockers", async () => {
  const f = fixture(); f.definition.status = "disabled"; f.definition.fields = [field({ id: "person" })];
  const described = await f.sender.describeSource(context);
  assert.deepEqual(described.permittedRecipients, []);
  assert.deepEqual(described.readiness, { ready: false, blockers: ["form_disabled", "email_field_required"] });
});

test("configuration preserves the existing binding identity and propagates guarded-writer refusal", async () => {
  const f = fixture(); await f.sender.configureEmail({ ...context, binding: input });
  await assert.rejects(f.sender.configureEmail({ ...context, binding: { ...input, bindingId: "replacement" } }), refusal({ code: "configuration" }));
  assert.equal(f.writes.length, 1);
  f.deps.writeEmailBinding = async () => { throw new Error("stale settings revision"); };
  await assert.rejects(f.sender.configureEmail({ ...context, binding: input }), /stale settings revision/);
  assert.equal(f.saved()!.bindingId, "reply");
});

test("an email action can be disabled after its recipient field becomes ineligible", async () => {
  const f = fixture(); await f.sender.configureEmail({ ...context, binding: input });
  f.definition.fields = [field({ id: "person" })];
  await f.sender.configureEmail({ ...context, binding: { ...input, enabled: false } });
  assert.equal(f.saved()!.enabled, false);
  assert.equal(f.writes.length, 2);
});

test("missing forms and submissions fail without a write or template render", async () => {
  const f = fixture(); f.deps.definitions.findById = async () => null;
  await assert.rejects(f.sender.describeSource(context), refusal({ code: "not_found" }));
  await assert.rejects(f.sender.configureEmail({ ...context, binding: input }), refusal({ code: "not_found" }));
  f.deps.definitions.findById = async () => f.definition;
  f.deps.submissions.findById = async () => null;
  await assert.rejects(f.sender.resolveEvent({ ...context, eventId: "s1" }), refusal({ code: "not_found" }));
  assert.equal(f.writes.length, 0); assert.equal(f.renders.length, 0);
});

test("field declarations are detached between callers and listing filters per-source configuration grants", async () => {
  const f = fixture();
  const described = await f.sender.describeSource(context);
  const builtin = described.fields.find(value => value.token === "site_name")!;
  Object.assign(builtin, { label: "Changed by caller", required: false });
  assert.deepEqual((await f.sender.describeSource(context)).fields.find(value => value.token === "site_name"), { token: "site_name", label: "Site name", required: true });
  f.deps.authorize = async request => request.operation !== "configure";
  assert.deepEqual(await f.sender.listSources(context), []);
});

test("valid scalar and choice values are exported without stringifying stored objects", async () => {
  const f = fixture();
  f.definition.fields.push(field({ id: "count", type: "number" }), { ...field({ id: "consent", type: "checkbox" }), required: false },
    { ...field({ id: "tags", type: "multi-select" }), options: [{ label: "A", value: "a" }, { label: "B", value: "b" }] });
  Object.assign(f.submission.data, { count: 0, consent: false, tags: ["a", "b"], person: { mediaId: "unexpected-object" } });
  assert.deepEqual((await f.sender.resolveEvent({ ...context, eventId: "s1" })).values,
    { email: "ada@example.org", count: "0", consent: "false", tags: "a, b", site_name: "Example site", site_url: "https://example.org", submitted_at: "2026-10-22T20:00:00Z" });
});
