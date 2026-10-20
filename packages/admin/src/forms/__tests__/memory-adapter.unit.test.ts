import { describe, expect, it } from 'vitest';
import type { AdminFormDefinition, AdminFormField, AdminFormSubmission, AdminFormUpdatePatch } from '../../core/ports/forms.js';
import { AdminApiError } from '../../core/transport/errors.js';
import { createMemoryFormsApi } from '../adapters/memory.js';

const field = (id: string): AdminFormField => ({ id, type: 'text', label: id, required: false });
const definition = (id: string, slug: string, extra: Partial<AdminFormDefinition> = {}): AdminFormDefinition => ({
  id, slug, name: `Form ${id}`, fields: [field('a'), field('b')], notify: { enabled: false, recipients: [] },
  status: 'active', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...extra,
});
const submission = (id: string, formDefinitionId: string, submittedAt: string, extra: Partial<AdminFormSubmission> = {}): AdminFormSubmission => ({
  id, formDefinitionId, data: { a: 'x' }, sourceIp: '127.0.0.1', submittedAt, ...extra,
});
async function rejection(promise: Promise<unknown>): Promise<AdminApiError> {
  const error = await promise.then(() => null, (thrown: unknown) => thrown);
  if (!(error instanceof AdminApiError)) throw new Error('expected the call to reject with an AdminApiError');
  return error;
}

describe('createMemoryFormsApi — definitions', () => {
  it('starts empty and stamps the epoch when no options are passed', async () => {
    const api = createMemoryFormsApi();
    expect(await api.listFormDefinitions({})).toEqual([]);
    const created = await api.createFormDefinition({ name: 'N', slug: 'n', fields: [] });
    expect(created).toEqual({ name: 'N', slug: 'n', fields: [], id: 'fake-1', notify: { enabled: false, recipients: [] }, status: 'active', createdAt: '1970-01-01T00:00:00.000Z', updatedAt: '1970-01-01T00:00:00.000Z' });
  });

  it('clones seeded definitions so caller mutation cannot reach the fixture', async () => {
    const seed = [definition('f1', 'one')];
    const api = createMemoryFormsApi({}, { forms: seed });
    const listed = await api.listFormDefinitions({});
    expect(listed).toEqual(seed);
    expect(listed[0]).not.toBe(api.forms[0]);
    expect(api.forms[0]).not.toBe(seed[0]);
  });

  it('gets a definition by slug before falling back to id', async () => {
    const api = createMemoryFormsApi({}, { forms: [definition('f1', 'one'), definition('one', 'two')] });
    expect((await api.getFormDefinition({ id: 'one' })).id).toBe('f1');
    expect((await api.getFormDefinition({ id: 'f1' })).slug).toBe('one');
  });

  it('rejects an unknown definition with a 404 naming the id', async () => {
    const error = await rejection(createMemoryFormsApi().getFormDefinition({ id: 'nope' }));
    expect(error.message).toBe("form definition 'nope' was not found");
    expect(error.status).toBe(404);
  });

  it('rejects a duplicate slug with a 409', async () => {
    const api = createMemoryFormsApi({}, { forms: [definition('f1', 'one')] });
    const error = await rejection(api.createFormDefinition({ name: 'N', slug: 'one', fields: [] }));
    expect(error.message).toBe('form slug already exists');
    expect(error.status).toBe(409);
  });

  it('skips sequence ids already taken by seeded definitions', async () => {
    const api = createMemoryFormsApi({}, { forms: [definition('fake-2', 'one')] });
    expect((await api.createFormDefinition({ name: 'N', slug: 'n', fields: [] })).id).toBe('fake-3');
  });

  it('uses the injected id, clock and notify config', async () => {
    const api = createMemoryFormsApi({}, { nextId: () => 'custom', now: () => 'T' });
    const notify = { enabled: true, recipients: ['a@example.com'] };
    const created = await api.createFormDefinition({ name: 'N', slug: 'n', fields: [] }, { notify });
    expect(created).toMatchObject({ id: 'custom', notify, createdAt: 'T', updatedAt: 'T' });
    expect(api.forms).toEqual([created]);
  });

  it('rejects an injected id that is already taken with a 409', async () => {
    const api = createMemoryFormsApi({}, { forms: [definition('dup', 'one')], nextId: () => 'dup' });
    const error = await rejection(api.createFormDefinition({ name: 'N', slug: 'n', fields: [] }));
    expect(error.message).toBe('form id already exists');
    expect(error.status).toBe(409);
  });
});

describe('createMemoryFormsApi — updateFormDefinition', () => {
  const seeded = () => createMemoryFormsApi({}, { forms: [definition('f1', 'one')], now: () => 'NOW' });

  it('rejects an unknown id with a 404 (slugs are not resolved here)', async () => {
    const error = await rejection(seeded().updateFormDefinition({ id: 'one' }, { name: 'x' }));
    expect(error.message).toBe("form definition 'one' was not found");
    expect(error.status).toBe(404);
  });

  it('rejects a fields patch that drops an existing field with a 400 validation code', async () => {
    const error = await rejection(seeded().updateFormDefinition({ id: 'f1' }, { fields: [field('a')] }));
    expect(error.message).toBe('existing form fields cannot be removed');
    expect(error.status).toBe(400);
    expect(error.code).toBe('FORMS_FIELD_VALIDATION_ERROR');
  });

  it('accepts reordered and appended fields', async () => {
    const api = seeded();
    const fields = [field('b'), field('a'), field('c')];
    expect((await api.updateFormDefinition({ id: 'f1' }, { fields })).fields).toEqual(fields);
    expect(api.forms[0]!.fields).toEqual(fields);
  });

  it('applies every supplied patch key and bumps updatedAt', async () => {
    const api = seeded();
    const patch: AdminFormUpdatePatch = { name: 'Renamed', notify: { enabled: true, recipients: ['r@example.com'] }, status: 'disabled', mode: 'html', html: '<form></form>' };
    const updated = await api.updateFormDefinition({ id: 'f1' }, patch);
    expect(updated).toEqual({ ...definition('f1', 'one'), ...patch, updatedAt: 'NOW' });
    expect(api.forms[0]).toEqual(updated);
  });

  it('ignores keys explicitly set to undefined and a missing patch', async () => {
    const api = seeded();
    const updated = await api.updateFormDefinition({ id: 'f1' }, { mode: undefined, html: undefined });
    expect(updated).toEqual({ ...definition('f1', 'one'), updatedAt: 'NOW' });
    expect(Object.keys(updated)).not.toContain('mode');
    expect(await api.updateFormDefinition({ id: 'f1' })).toEqual(updated);
  });

  it('drops a slug smuggled through a cast', async () => {
    const api = seeded();
    const smuggled: AdminFormUpdatePatch & { slug: string } = { slug: 'hijacked', name: 'N' };
    expect((await api.updateFormDefinition({ id: 'f1' }, smuggled)).slug).toBe('one');
  });

  it('stores a clone of the patch so later caller mutation cannot reach the fixture', async () => {
    const api = seeded();
    const recipients = ['r@example.com'];
    await api.updateFormDefinition({ id: 'f1' }, { notify: { enabled: true, recipients } });
    recipients.push('late@example.com');
    expect(api.forms[0]!.notify.recipients).toEqual(['r@example.com']);
  });
});

describe('createMemoryFormsApi — submissions', () => {
  const seeded = () => createMemoryFormsApi({}, {
    forms: [definition('f1', 'one')],
    submissions: [
      submission('s1', 'f1', '2026-01-01T00:00:00Z'),
      submission('s2', 'f1', '2026-01-02T00:00:00Z'),
      submission('s3', 'f1', '2026-01-02T00:00:00Z'),
      submission('s4', 'f1', '2026-01-03T00:00:00Z', { status: 'trash' }),
      submission('s5', 'f2', '2026-01-04T00:00:00Z'),
    ],
  });
  const ids = (page: { items: readonly AdminFormSubmission[] }) => page.items.map(item => item.id);

  it('lists active submissions newest-first, breaking timestamp ties by descending id, resolving a slug', async () => {
    const page = await seeded().listFormSubmissions({ formId: 'one' });
    expect(ids(page)).toEqual(['s3', 's2', 's1']);
    expect(page.nextCursor).toBeNull();
  });

  it('pages with a cursor and reports the next cursor', async () => {
    const api = seeded();
    const first = await api.listFormSubmissions({ formId: 'f1' }, { limit: 2 });
    expect(ids(first)).toEqual(['s3', 's2']);
    expect(first.nextCursor).toBe('s2');
    const second = await api.listFormSubmissions({ formId: 'f1' }, { limit: 2, cursor: 's2' });
    expect(ids(second)).toEqual(['s1']);
    expect(second.nextCursor).toBeNull();
  });

  it('rejects an unknown cursor with a 400', async () => {
    const error = await rejection(seeded().listFormSubmissions({ formId: 'f1' }, { cursor: 's5' }));
    expect(error.message).toBe('invalid submissions cursor');
    expect(error.status).toBe(400);
  });

  it.each([0, 1.5])('rejects limit %s with a 400', async limit => {
    const error = await rejection(seeded().listFormSubmissions({ formId: 'f1' }, { limit }));
    expect(error.message).toBe('invalid submissions limit');
    expect(error.status).toBe(400);
  });

  it('gets a submission through the owning form slug', async () => {
    expect(await seeded().getFormSubmission({ formId: 'one', submissionId: 's1' })).toEqual(submission('s1', 'f1', '2026-01-01T00:00:00Z'));
  });

  it.each([['s5', 'another form'], ['s4', 'trash'], ['zz', 'nowhere']])('rejects submission %s owned by %s with a 404', async submissionId => {
    const error = await rejection(seeded().getFormSubmission({ formId: 'f1', submissionId }));
    expect(error.message).toBe(`form submission '${submissionId}' was not found`);
    expect(error.status).toBe(404);
  });

  it('moves a deleted submission to trash, keeping its data', async () => {
    const api = seeded();
    await api.deleteFormSubmission({ formId: 'one', submissionId: 's2' });
    expect(api.submissions[1]).toEqual(submission('s2', 'f1', '2026-01-02T00:00:00Z', { status: 'trash' }));
    expect(ids(await api.listFormSubmissions({ formId: 'f1' }))).toEqual(['s3', 's1']);
  });
});

describe('createMemoryFormsApi — trash port', () => {
  it('trashes a submission by id regardless of form', async () => {
    const api = createMemoryFormsApi({}, { submissions: [submission('s1', 'f1', 'T')] });
    expect(await api.trash.trash({ type: 'form_submission', id: 's1' })).toEqual({ ok: true, version: null });
    expect(api.submissions[0]!.status).toBe('trash');
  });

  it('removes a trashed definition from the fixture', async () => {
    const api = createMemoryFormsApi({}, { forms: [definition('f1', 'one'), definition('f2', 'two')] });
    await api.trash.trash({ type: 'form', id: 'f1' });
    expect(api.forms.map(form => form.id)).toEqual(['f2']);
  });

  it.each([['form', 'form definition'], ['form_submission', 'form submission']] as const)('rejects an unknown %s id with a 404 naming the %s', async (type, kind) => {
    const error = await rejection(createMemoryFormsApi().trash.trash({ type, id: 'missing' }));
    expect(error.message).toBe(`${kind} 'missing' was not found`);
    expect(error.status).toBe(404);
  });
});
