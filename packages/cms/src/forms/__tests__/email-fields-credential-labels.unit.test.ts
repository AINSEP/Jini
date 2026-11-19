import { expect, test } from 'vitest';
import { describeFormEmailFields, resolveFormEmailValues } from '../email-sender-fields.js';
import type { FieldDescriptor, FormDefinitionRecord, FormSubmissionRecord } from '../types.js';

function definition(required: { fields: FieldDescriptor[] }, _optional = {}): FormDefinitionRecord {
  return { ...required, id: 'form', workspaceId: 'site', name: 'Signup', slug: 'signup',
    notify: { enabled: false, recipients: [] }, status: 'active', version: 1, createdAt: '2026-11-19', updatedAt: '2026-11-19' };
}

const mailed = (field: FieldDescriptor, value: string): Readonly<Record<string, string>> => {
  const submission: FormSubmissionRecord = { id: 's', workspaceId: 'site', formDefinitionId: 'form', data: { [field.id]: value }, sourceIp: null, submittedAt: '2026-11-19' };
  return resolveFormEmailValues({ definition: definition({ fields: [field] }), submission, site: { name: 'Host', url: '/' } });
};

// A credential field is left out of mail whether its id or the label people see names the credential.
test.each(['Password', 'Your API token', 'Secret answer'])('a field labelled %j is not mailed, whatever its id', label => {
  const field: FieldDescriptor = { id: 'answer', label, type: 'text', required: false };
  expect(mailed(field, 'Hx7short')).not.toHaveProperty('answer');
  expect(describeFormEmailFields({ definition: definition({ fields: [field] }) }).map(source => source.token)).not.toContain('answer');
});

test('a field whose label does not name a credential is mailed as written', () => {
  expect(mailed({ id: 'answer', label: 'Favourite colour', type: 'text', required: false }, 'blue').answer).toBe('blue');
});
