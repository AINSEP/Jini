import assert from 'node:assert/strict';
import { test } from 'vitest';
import { toSubmissionRecord, toSubmissionRow } from '../sql/repo.rows.js';
import type { FormSubmissionRecord } from '../types.js';
const record: FormSubmissionRecord = { id: 's', workspaceId: 'w', formDefinitionId: 'f', data: { email: '' }, sourceIp: null, submittedAt: 'now',
  validation: { status: 'invalid', fieldErrors: [{ field: 'email', reason: 'required' }] } };
test('invalid classification and errors survive SQL JSON serialization and are outside visitor answers', () => {
  const row = toSubmissionRow(record);
  const stored = toSubmissionRecord({ ...row, version: 1, deleted_at: null } as never);
  assert.deepEqual(stored.validation, record.validation);
  assert.deepEqual(stored.data, record.data);
});
test('legacy answer objects, including envelope-like field names, retain their original meaning', () => {
  const data = { data: 'visitor text', validation: 'visitor text', __jini_form_submission_v1: true };
  const stored = toSubmissionRecord({ id: 's', workspace_id: 'w', form_definition_id: 'f', data_json: JSON.stringify(data), source_ip: null, submitted_at: 'now', version: 1, deleted_at: null });
  assert.deepEqual(stored.data, data); assert.equal(stored.validation, undefined);
});
