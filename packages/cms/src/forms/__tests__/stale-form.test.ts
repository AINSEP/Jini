import assert from 'node:assert/strict';
import { test } from 'vitest';
import { submitForm } from '../submit-service.js';
import { captureSubmissionEvidence } from '../submission-evidence.js';
import { InMemoryFormDefinitionRepo, InMemoryFormSubmissionRepo } from './repo.fixture.js';
import type { FormDefinitionRecord } from '../types.js';

const definition: FormDefinitionRecord & { html?: string } = {
  id: 'form', workspaceId: 'ws', name: 'Contact', slug: 'contact', status: 'active', version: 1,
  createdAt: 'now', updatedAt: 'now', notify: { enabled: false, recipients: [] },
  fields: [{ id: 'email', label: 'Email', type: 'email', required: true }, { id: 'consent', label: 'Original terms', type: 'checkbox', required: true }],
};
async function setup(stored = definition) {
  const definitionRepo = new InMemoryFormDefinitionRepo();
  await definitionRepo.create(stored);
  const effects: string[] = [];
  const submissionRepo = new InMemoryFormSubmissionRepo();
  const deps = { definitionRepo, submissionRepo, clock: { nowMs: () => 0 }, idGen: { newId: () => { effects.push('id'); return String(effects.length); } },
    outbox: { enqueue: async () => { effects.push('enqueue'); } }, dispatcher: { dispatch: async () => { effects.push('dispatch'); } },
    logger: { warn: () => {} }, rateLimiter: { check: async () => { effects.push('rate'); return { allowed: true as const }; } } };
  const input = { workspaceId: 'ws', slug: 'contact', sourceIp: '192.0.2.1', body: { email: 'ada@example.com', consent: 'on' } as Record<string, unknown> };
  return { deps, input, effects };
}
const hashFor = async (stored = definition) => (await captureSubmissionEvidence({ definition: stored, source: 'native', capturedAt: 'now' })).schemaHash;

test('legacy submissions without a schema hash remain accepted', async () => {
  const { deps, input } = await setup();
  assert.deepEqual(await submitForm({ deps, input }), { status: 'accepted' });
  const rows = await deps.submissionRepo.listByDefinition({ workspaceId: 'ws', formDefinitionId: 'form', limit: 10 });
  assert.deepEqual(rows.items[0]!.data, { email: 'ada@example.com', consent: true });
});

test('matching page hash is stripped from answers and shares the evidence digest', async () => {
  const { deps, input } = await setup();
  input.body._schemaHash = await hashFor();
  assert.deepEqual(await submitForm({ deps, input }), { status: 'accepted' });
  const rows = await deps.submissionRepo.listByDefinition({ workspaceId: 'ws', formDefinitionId: 'form', limit: 10 });
  assert.deepEqual(rows.items[0]!.data, { email: 'ada@example.com', consent: true });
  assert.equal(rows.items[0]!.evidence?.schemaHash, input.body._schemaHash);
});

test('changed, malformed and repeated page hashes refuse before validation, rate, IDs or acceptance', async () => {
  for (const hash of ['a'.repeat(64), '', 'not-a-hash', ['a'.repeat(64), 'a'.repeat(64)], [], null, undefined]) {
    const { deps, input, effects } = await setup();
    input.body = { email: 'bad email', consent: 'on', _schemaHash: hash };
    await assert.rejects(submitForm({ deps, input }, { validateEmails: true }), (error: unknown) => {
      assert.equal((error as { code: string }).code, 'FORMS_SCHEMA_CHANGED');
      return true;
    });
    assert.deepEqual(effects, []);
    const rows = await deps.submissionRepo.listByDefinition({ workspaceId: 'ws', formDefinitionId: 'form', limit: 10 });
    assert.equal(rows.items.length, 0);
  }
});

test('a changed consent label or authored HTML invalidates the former page hash', async () => {
  const oldHash = await hashFor();
  const stored = { ...definition, fields: definition.fields.map(field => field.id === 'consent' ? { ...field, label: 'Changed terms' } : field), html: '<p>Updated privacy wording</p>' };
  const { deps, input, effects } = await setup(stored);
  input.body._schemaHash = oldHash;
  await assert.rejects(submitForm({ deps, input }), (error: unknown) => (error as { code: string }).code === 'FORMS_SCHEMA_CHANGED');
  assert.deepEqual(effects, []);
});

test('retry drafts exclude metadata and files, preserve dangerous text names safely, and bound UTF-8 bytes', async () => {
  const { boundedFormRetryDraft } = await import('../stale-form.js');
  const raw = JSON.parse('{"__proto__":"copy me","constructor":"also copy","removed":"<script>alert(1)</script>"}');
  const draft = boundedFormRetryDraft({ body: { ...raw, _schemaHash: 'bad', _attempt: 'private-token', _hp: 'bot', file: { bytes: new Uint8Array([1, 2, 3]) } } });
  assert.equal(draft.answers.__proto__, 'copy me');
  assert.equal(draft.answers.constructor, 'also copy');
  assert.deepEqual(Object.keys(draft.answers).sort(), ['__proto__', 'constructor', 'removed']);
  const oversized = boundedFormRetryDraft({ body: Object.fromEntries(Array.from({ length: 100 }, (_, index) => [String(index), '😀'.repeat(4000)])) });
  assert.equal(oversized.truncated, true);
  assert.ok(new TextEncoder().encode(JSON.stringify(oversized)).byteLength <= 64 * 1024);
});

test('retry repopulates only current valid answers and keeps changed/removed answers for copying', async () => {
  const { formRetryFields } = await import('../stale-form.js');
  const fields = [...definition.fields, { id: 'choice', label: 'Choice', type: 'select' as const, required: true, options: [{ value: 'new', label: 'New' }], default: 'new' }, { id: 'file', label: 'File', type: 'file' as const, required: false }];
  const answers = { email: 'ada@example.com', consent: 'on', choice: 'old', removed: '<script>alert(1)</script>' };
  const retry = formRetryFields({ fields, answers });
  assert.equal(retry.fields[0]!.default, 'ada@example.com');
  assert.equal(retry.fields[1]!.default, undefined);
  assert.equal(retry.fields[2]!.default, undefined);
  assert.equal(retry.fields[3]!.default, undefined);
  assert.deepEqual(retry.retained, { consent: 'on', choice: 'old', removed: '<script>alert(1)</script>' });
  assert.equal(fields[2]!.default, 'new', 'does not mutate the current definition');
});

test('shortened oversized drafts stay copy-only instead of being mistaken for compatible answers', async () => {
  const { boundedFormRetryDraft, formRetryFields } = await import('../stale-form.js');
  const draft = boundedFormRetryDraft({ body: { email: 'a'.repeat(6000) } });
  const retry = formRetryFields({ fields: [{ id: 'email', label: 'Message', type: 'text', required: false, maxLength: 5000 }], answers: draft.answers }, draft);
  assert.equal(retry.fields[0]!.default, undefined);
  assert.equal(draft.truncated, true);
  assert.equal(retry.retained.email, 'a'.repeat(5000));
});
