import { expect, test } from 'vitest';
import { describeFormEmailFields, resolveFormEmailValues } from '../email-sender-fields.js';
import type { FieldDescriptor, FormDefinitionRecord, FormSubmissionRecord } from '../types.js';

function field(required: { id: string }, optional: Partial<FieldDescriptor> = {}): FieldDescriptor {
  return { ...required, label: required.id, type: 'text', required: false, ...optional };
}

function definition(required: { fields: FieldDescriptor[] }, _optional = {}): FormDefinitionRecord {
  return { ...required, id: 'form', workspaceId: 'site', name: 'Contact', slug: 'contact',
    notify: { enabled: false, recipients: [] }, status: 'active', version: 1, createdAt: '2026-10-28', updatedAt: '2026-10-28' };
}

test('mail tokens namespace builtin collisions and never export private or undeclared stored fields', () => {
  const form = definition({ fields: [field({ id: 'site_name' }), field({ id: 'password' }),
    field({ id: 'invisible' }, { type: 'hidden' }), field({ id: 'upload' }, { type: 'file' }),
    field({ id: 'bad.id' }), field({ id: 'missing' }, { default: 'must stay absent' })] });
  const submission: FormSubmissionRecord = { id: 'submission', workspaceId: 'site', formDefinitionId: 'form',
    data: { site_name: 'Answer', password: 'private', invisible: 'private', extra: 'private' }, sourceIp: null, submittedAt: '2026-10-28T00:00:00Z' };
  expect(describeFormEmailFields({ definition: form })).toEqual([
    { token: 'field.site_name', label: 'site_name', required: false }, { token: 'missing', label: 'missing', required: false },
    { token: 'site_name', label: 'Site name', required: true }, { token: 'site_url', label: 'Site URL', required: true },
    { token: 'submitted_at', label: 'Submitted at', required: true },
  ]);
  expect(resolveFormEmailValues({ definition: form, submission, site: { name: 'Host', url: 'https://example.org' } })).toEqual({
    'field.site_name': 'Answer', site_name: 'Host', site_url: 'https://example.org', submitted_at: submission.submittedAt,
  });
});

test('choice arrays containing credentials are omitted as a whole while public arrays retain option values', () => {
  const secret = ['ghp', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('_');
  const options = [{ label: 'First', value: 'a' }, { label: 'Private', value: secret }];
  const form = definition({ fields: [field({ id: 'safe' }, { type: 'multi-select', options }),
    field({ id: 'unsafe' }, { type: 'multi-select', options }), field({ id: 'invalid' }, { type: 'number' })] });
  const submission: FormSubmissionRecord = { id: 's', workspaceId: 'site', formDefinitionId: 'form',
    data: { safe: ['a'], unsafe: ['a', secret], invalid: 'not a number' }, sourceIp: null, submittedAt: '2026-10-28' };
  expect(resolveFormEmailValues({ definition: form, submission, site: { name: 'Host', url: '/' } })).toEqual({
    safe: 'a', site_name: 'Host', site_url: '/', submitted_at: '2026-10-28',
  });
});
