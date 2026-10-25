import assert from "node:assert/strict";
import { test } from "vitest";
import { ProviderRegistryError } from "@jini-ai/core/provider-registry";
import { createEmailSenderRegistry, EmailSenderError, listEmailSources, prepareSenderEmail,
  validateEmailSourceTemplate, type EmailSender, type EmailSourceDescription, type EmailTemplatePort } from "../senders.js";

const context = { workspaceId: "w1", principalId: "owner", sourceId: "contact", eventId: "s1" };
function fixture({ id = "forms" }: { id?: string } = {}, _optional: Record<string, never> = {}) {
  const source: EmailSourceDescription = {
    senderId: id, sourceId: "contact", label: "Contact", eventName: "form.submission.received",
    fields: [{ token: "person", label: "Person", required: true }, { token: "note", label: "Note", required: false }],
    permittedRecipients: [{ id: "email", label: "Email" }], purpose: "transactional", lane: "notification",
    binding: { bindingId: "reply", templateId: "thanks", recipientId: "email", replyTo: "owner@example.org", enabled: true, activatedAt: "2026-10-22T21:00:00Z" },
    readiness: { ready: true, blockers: [] },
  };
  const rendered: Parameters<EmailTemplatePort["render"]>[0][] = [];
  const templates: EmailTemplatePort = {
    describe: async () => ({ version: "v1", fields: ["person", "note"], placeholders: ["person", "note"] }),
    render: async request => { rendered.push(request); return { subject: `Hello ${request.values.person}`, html: "<p>Thanks</p>", text: "Thanks", missingFields: [] }; },
  };
  const sender: EmailSender = {
    id, label: id,
    listSources: async request => request.workspaceId === "w1" ? [{ senderId: id, sourceId: source.sourceId, eventName: source.eventName, label: source.label }] : [],
    describeSource: async () => source,
    resolveEvent: async () => ({ occurredAt: "2026-10-22T21:00:00Z", values: { person: "Ada", sourceIp: "203.0.113.1", undeclared: "private" }, recipients: [{ id: "email", address: { email: "ada@example.org" } }] }),
    configureEmail: async request => ({ ...request.binding, activatedAt: "2026-10-22T21:00:00Z" }),
  };
  return { source, templates, rendered, sender };
}
const refusal = ({ code }: { code: EmailSenderError["code"] }, _optional: Record<string, never> = {}) => (error: unknown): boolean => error instanceof EmailSenderError && error.code === code;

test("registry conformance: isolated instances, keyed lookup and duplicate sender refusal", () => {
  const f = fixture(); const registry = createEmailSenderRegistry({ senders: [f.sender] });
  assert.equal(registry.get({ id: "forms" })!.provider, f.sender);
  assert.equal(createEmailSenderRegistry({ senders: [] }).has({ id: "forms" }), false);
  assert.throws(() => createEmailSenderRegistry({ senders: [f.sender, f.sender] }), ProviderRegistryError);
});

test("event discovery lists all senders while preserving caller workspace and sender identity", async () => {
  const a = fixture(); const b = fixture({ id: "other" });
  const registry = createEmailSenderRegistry({ senders: [a.sender, b.sender] });
  assert.deepEqual(await listEmailSources({ ...context, registry }), ["forms", "other"].map(senderId => ({ senderId, sourceId: "contact", eventName: "form.submission.received", label: "Contact" })));
  assert.deepEqual(await listEmailSources({ ...context, workspaceId: "w2", registry }), []);
  b.sender.listSources = async () => [{ senderId: "forms", sourceId: "contact", label: "Impersonated", eventName: "event" }];
  await assert.rejects(listEmailSources({ ...context, registry }), refusal({ code: "ownership" }));
});

test("preparation uses the stored binding, versioned send renderer and allowlisted values only", async () => {
  const f = fixture();
  const prepared = await prepareSenderEmail({ ...context, sender: f.sender, templates: f.templates });
  assert.deepEqual(prepared, { bindingId: "reply", templateId: "thanks", templateVersion: "v1", to: { email: "ada@example.org" }, replyTo: { email: "owner@example.org" },
    subject: "Hello Ada", html: "<p>Thanks</p>", text: "Thanks", purpose: "transactional", lane: "notification", warnings: ["note"] });
  assert.deepEqual(f.rendered, [{ workspaceId: "w1", principalId: "owner", templateId: "thanks", version: "v1", values: { person: "Ada", note: "" } }]);
});

test("preparation refuses pre-activation events and absent or invalid cutoff times before rendering", async () => {
  for (const activatedAt of [null, "invalid", "2026-10-22T21:00:01Z"]) {
    const f = fixture();
    f.sender.describeSource = async () => ({ ...f.source, binding: { ...f.source.binding!, activatedAt } });
    await assert.rejects(prepareSenderEmail({ ...context, sender: f.sender, templates: f.templates }), refusal({ code: "configuration" }));
    assert.equal(f.rendered.length, 0);
  }
  const f = fixture();
  const resolved = await f.sender.resolveEvent(context);
  f.sender.resolveEvent = async () => ({ ...resolved, occurredAt: "invalid" });
  await assert.rejects(prepareSenderEmail({ ...context, sender: f.sender, templates: f.templates }), refusal({ code: "configuration" }));
  assert.equal(f.rendered.length, 0);
});

test("disable then re-enable uses the new activation cutoff without reviving old events", async () => {
  const f = fixture();
  const binding = f.source.binding!;
  await prepareSenderEmail({ ...context, sender: f.sender, templates: f.templates });
  assert.equal(f.rendered.length, 1);
  f.sender.configureEmail = async request => {
    const saved = { ...request.binding, activatedAt: request.binding.enabled ? "2026-10-22T22:00:00Z" : null };
    Object.assign(f.source, { binding: saved });
    return saved;
  };
  await f.sender.configureEmail({ ...context, binding: { ...binding, enabled: false } });
  await assert.rejects(prepareSenderEmail({ ...context, sender: f.sender, templates: f.templates }), refusal({ code: "configuration" }));
  await f.sender.configureEmail({ ...context, binding });
  await assert.rejects(prepareSenderEmail({ ...context, sender: f.sender, templates: f.templates }), refusal({ code: "configuration" }));
  assert.equal(f.rendered.length, 1);
  const resolved = await f.sender.resolveEvent(context);
  f.sender.resolveEvent = async () => ({ ...resolved, occurredAt: "2026-10-22T22:00:00Z" });
  await prepareSenderEmail({ ...context, sender: f.sender, templates: f.templates });
  assert.equal(f.rendered.length, 2);
});

test("compatibility refuses unsupported declarations and undeclared placeholders", () => {
  const { source } = fixture();
  assert.doesNotThrow(() => validateEmailSourceTemplate({ fields: source.fields, template: { fields: ["person"], placeholders: ["person"] } }));
  for (const template of [{ fields: ["unknown"], placeholders: [] }, { fields: ["person"], placeholders: ["note"] }]) {
    assert.throws(() => validateEmailSourceTemplate({ fields: source.fields, template }), refusal({ code: "incompatible" }));
  }
});

test("missing required event values never become preview samples or reach the renderer", async () => {
  const f = fixture();
  f.sender.resolveEvent = async () => ({ occurredAt: "2026-10-22T21:00:00Z", values: { person: "" }, recipients: [{ id: "email", address: { email: "ada@example.org" } }] });
  await assert.rejects(prepareSenderEmail({ ...context, sender: f.sender, templates: f.templates }), refusal({ code: "missing_value" }));
  assert.equal(f.rendered.length, 0);
});

test("preparation refuses the wrong source, inactive binding, unavailable delivery or recipient substitution", async () => {
  const changes: [Partial<EmailSourceDescription>, EmailSenderError["code"]][] = [
    [{ sourceId: "other" }, "ownership"], [{ senderId: "other" }, "ownership"],
    [{ binding: null }, "configuration"],
    [{ binding: { ...fixture().source.binding!, enabled: false } }, "configuration"],
    [{ readiness: { ready: false, blockers: ["background_delivery_unavailable"] } }, "not_ready"],
    [{ permittedRecipients: [{ id: "owner", label: "Owner" }] }, "configuration"],
  ];
  for (const [patch, code] of changes) {
    const f = fixture(); f.sender.describeSource = async () => ({ ...f.source, ...patch });
    await assert.rejects(prepareSenderEmail({ ...context, sender: f.sender, templates: f.templates }), refusal({ code }));
    assert.equal(f.rendered.length, 0);
  }
  const f = fixture();
  f.sender.resolveEvent = async () => ({ occurredAt: "2026-10-22T21:00:00Z", values: { person: "Ada" }, recipients: [{ id: "owner", address: { email: "owner@example.org" } }] });
  await assert.rejects(prepareSenderEmail({ ...context, sender: f.sender, templates: f.templates }), refusal({ code: "missing_value" }));
});

test("changed-template errors and unresolved render fields never produce a prepared message", async () => {
  const f = fixture();
  f.templates.render = async () => { throw new Error("template version changed"); };
  await assert.rejects(prepareSenderEmail({ ...context, sender: f.sender, templates: f.templates }), /template version changed/);
  f.templates.render = async () => ({ subject: "Hello", html: "", text: "", missingFields: ["unexpected"] });
  await assert.rejects(prepareSenderEmail({ ...context, sender: f.sender, templates: f.templates }), refusal({ code: "missing_value" }));
});
