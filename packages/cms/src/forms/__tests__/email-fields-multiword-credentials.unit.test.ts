import { expect, test } from 'vitest';
import { resolveFormEmailValues } from '../email-sender-fields.js';
import type { FieldDescriptor, FormDefinitionRecord, FormSubmissionRecord } from '../types.js';

function definition(required: { fields: FieldDescriptor[] }, _optional = {}): FormDefinitionRecord {
  return { ...required, id: 'form', workspaceId: 'site', name: 'Contact', slug: 'contact',
    notify: { enabled: false, recipients: [] }, status: 'active', version: 1, createdAt: '2026-10-28', updatedAt: '2026-10-28' };
}

const notes = (value: string): Readonly<Record<string, string>> => {
  const form = definition({ fields: [{ id: 'notes', label: 'Notes', type: 'textarea', required: false }] });
  const submission: FormSubmissionRecord = { id: 's', workspaceId: 'site', formDefinitionId: 'form', data: { notes: value }, sourceIp: null, submittedAt: '2026-10-28' };
  return resolveFormEmailValues({ definition: form, submission, site: { name: 'Host', url: '/' } });
};

// Mail leaves the system and cannot be recalled. The engine masks the part of a sentence it recognises as the
// credential, which for a multiword password after a label can be only its first word: the other words were mailed.
// An answer in which the engine finds any credential is therefore sent fully masked.
test.each([
  ['Password: blue sky river 42', ['sky', 'river', '42']],
  ['my db password = two words', ['words']],
  ['- API key: alpha bravo 7 charlie', ['bravo', 'charlie']],
])('an answer holding a credential is mailed with the whole answer masked: %j', (value, parts) => {
  const mailed = notes(value).notes ?? '';
  for (const part of parts) expect(mailed).not.toContain(part);
  expect(mailed).toBe('[REDACTED:credential]');
});

test('an answer with no credential is mailed as written', () => {
  expect(notes('Please call me after 5pm about the password reset page').notes).toBe('Please call me after 5pm about the password reset page');
});
