import assert from "node:assert/strict";
import { test } from "vitest";

import type { FormDefinitionRecord } from "../../index.js";
import { buildFormDeliveryForm, buildFormDestinationManifest } from "../form-destination-manifest.js";

/** @file Unit tests for the generic form manifest handed to hosting targets. */

const base = { workspaceId: "w", name: "Waitlist", notify: { enabled: true, recipients: ["owner@example.com"] }, createdAt: "t", updatedAt: "t", version: 1 };
const waitlist: FormDefinitionRecord = { ...base, id: "f1", slug: "byho-waitlist", status: "active", fields: [
  { id: "email", label: "Email", type: "email", required: true, maxLength: 254 },
  { id: "interests", label: "Interests", type: "checkbox-group", required: true, options: [{ value: "a", label: "A" }] },
  { id: "consent", label: "Consent", type: "checkbox", required: true },
  { id: "note", name: "visitor_note", label: "Note", type: "textarea", required: false, maxLength: null },
] };

test("active forms map to names, required flags, lengths and multi-value groups only", () => {
  const manifest = buildFormDestinationManifest({ definitions: [waitlist, { ...waitlist, id: "f2", slug: "old", status: "disabled" }] });
  assert.deepEqual(manifest.map(({ evidence, ...form }) => form), [{ slug: "byho-waitlist", fields: [
    { name: "email", required: true, maxLength: 254, type: "email" },
    { name: "interests", required: true, multiple: true, type: "checkbox-group", options: ["a"] },
    { name: "consent", required: true, type: "checkbox" },
    { name: "visitor_note", required: false, maxLength: 2000, type: "textarea" },
  ] }]);
  assert.equal(JSON.stringify(manifest).includes("owner@example.com"), false, "notification recipients never leave the host");
});

test("no active forms means an empty manifest", () => {
  assert.deepEqual(buildFormDestinationManifest({ definitions: [] }), []);
});

test("T9: the static-host manifest includes default text caps and preserves authored limits", () => {
  const manifest = buildFormDestinationManifest({ definitions: [{ ...waitlist, fields: [
    { id: "name", label: "Name", type: "text", required: false },
    waitlist.fields[0]!,
    waitlist.fields[3]!,
    { id: "token", label: "Token", type: "hidden", required: false },
    waitlist.fields[2]!,
  ] }] });

  assert.deepEqual(manifest.map(({ evidence, ...form }) => form), [{ slug: "byho-waitlist", fields: [
    { name: "name", required: false, maxLength: 100, type: "text" },
    { name: "email", required: true, maxLength: 254, type: "email" },
    { name: "visitor_note", required: false, maxLength: 2000, type: "textarea" },
    { name: "token", required: false, maxLength: 2000, type: "hidden" },
    { name: "consent", required: true, type: "checkbox" },
  ] }]);
});

// ---- buildFormDeliveryForm: the snapshot a push delivery freezes when a submission is planned ----

test("the delivery form adds each field's label and type to the manifest's names, flags, lengths and groups", () => {
  assert.deepEqual(buildFormDeliveryForm({ definition: waitlist }), { slug: "byho-waitlist", fields: [
    { name: "email", required: true, maxLength: 254, label: "Email", type: "email" },
    { name: "interests", required: true, multiple: true, label: "Interests", type: "checkbox-group", options: [{ value: "a", label: "A" }] },
    { name: "consent", required: true, label: "Consent", type: "checkbox" },
    { name: "visitor_note", required: false, label: "Note", type: "textarea" },
  ] });
});

test("the delivery form is built whatever the definition's status is now (the submission was already accepted)", () => {
  assert.equal(buildFormDeliveryForm({ definition: { ...waitlist, slug: "old", status: "disabled" } }).slug, "old");
});

test("the delivery form carries original option labels and never notification recipients", () => {
  const form = JSON.stringify(buildFormDeliveryForm({ definition: waitlist }));
  assert.equal(form.includes("owner@example.com"), false);
  assert.equal(form.includes("options"), true);
  assert.equal(form.includes('"label":"A"'), true);
});

test('receiver manifest carries validation semantics and identifies unsupported file fields before publish', () => {
  const fields = [waitlist.fields[0]!, waitlist.fields[1]!, { id: 'code', label: 'Code', type: 'text' as const, required: false, pattern: '[A-Z]+' }, { id: 'photo', label: 'Photo', type: 'file' as const, required: false }];
  const manifest = buildFormDestinationManifest({ definitions: [{ ...waitlist, fields }] });
  assert.equal(manifest[0]!.fields[0]!.type, 'email');
  assert.deepEqual(manifest[0]!.fields[1]!.options, ['a']);
  assert.equal(manifest[0]!.fields[2]!.validationUnsupported, true);
  assert.equal(manifest[0]!.fields[3]!.type, 'file');
});

test('empty select placeholders are omitted from the receiver allowlist', () => {
  const manifest = buildFormDestinationManifest({ definitions: [{ ...waitlist, fields: [{ id: 'choice', type: 'select', label: 'Choice', required: false, options: [{ value: '', label: 'Choose…' }, { value: 'yes', label: 'Yes' }] }] }] });
  assert.deepEqual(manifest[0]!.fields[0]!.options, ['yes']);
});


test('static manifest carries immutable original labels, consent wording and canonical schema hash', () => {
  const [form] = buildFormDestinationManifest({ definitions: [waitlist] });
  assert.equal(form!.evidence.fields[0]!.label, 'Email');
  assert.deepEqual(form!.evidence.consent, [{ fieldId: 'consent', wording: 'Consent' }]);
  assert.match(form!.evidence.schemaHash, /^[a-f0-9]{64}$/);
  const [edited] = buildFormDestinationManifest({ definitions: [{ ...waitlist, fields: waitlist.fields.map(field => ({ ...field, label: field.label + ' changed' })) }] });
  assert.notEqual(edited!.evidence.schemaHash, form!.evidence.schemaHash);
  assert.equal(JSON.stringify(form!.evidence).includes('owner@example.com'), false);
});

test('receiver manifest includes effective number and temporal bounds while external providers stay out', () => {
  const fields = [{ id: 'count', label: 'Count', type: 'number' as const, required: false, min: 2, max: 8, step: 2 },
    { id: 'date', label: 'Date', type: 'date' as const, required: true, attributes: { min: '2026-01-01', max: '2026-12-31' } }];
  const [form] = buildFormDestinationManifest({ definitions: [{ ...waitlist, fields }] });
  assert.deepEqual(form!.fields[0], { name: 'count', type: 'number', required: false, min: 2, max: 8, step: 2 });
  assert.equal(form!.fields[1]!.min, '2026-01-01');
  assert.equal(form!.fields[1]!.max, '2026-12-31');
  assert.deepEqual(buildFormDestinationManifest({ definitions: [{ ...waitlist, provider: { id: 'formspree', config: { endpoint: 'https://formspree.io/f/abcd' } } }] }), []);
});

test('hosted embed collection creates no built-in receiver destination and retains the pending delivery schema', () => {
  const google = { ...waitlist, provider: { id: 'google_forms', config: { url: 'https://docs.google.com/forms/d/e/dummy/viewform' } } };
  assert.deepEqual(buildFormDestinationManifest({ definitions: [google] }), []);
  const pendingDelivery = buildFormDeliveryForm({ definition: google });
  assert.equal(pendingDelivery.slug, waitlist.slug);
  assert.equal(pendingDelivery.fields.length, waitlist.fields.length);
});

test('built-in receiver keeps authored text minima and checkbox values', () => {
  const definition: FormDefinitionRecord = { ...waitlist, fields: [
    { id: 'code', label: 'Code', type: 'text', required: true, minLength: 4, attributes: { minlength: '2' } },
    { id: 'note', label: 'Note', type: 'textarea', required: false, attributes: { minlength: '7', pattern: '[A-Z]+' } },
    { id: 'consent', label: 'Consent', type: 'checkbox', required: true, checkboxValue: 'accepted' },
  ] };
  const provider = { id: 'builtin', config: {} };
  assert.deepEqual(buildFormDestinationManifest({ definitions: [{ ...definition, provider }] }).map(({ slug, fields }) => ({ slug, fields })), [
    { slug: 'byho-waitlist', fields: [
      { name: 'code', type: 'text', required: true, maxLength: 100, minLength: 4 },
      { name: 'note', type: 'textarea', required: false, maxLength: 2000, minLength: 7, validationUnsupported: true },
      { name: 'consent', type: 'checkbox', required: true, checkboxValue: 'accepted' },
    ] },
  ]);
});
