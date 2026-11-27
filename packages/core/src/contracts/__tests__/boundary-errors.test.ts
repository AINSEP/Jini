import { expect, it } from 'vitest';
import { RECORDED_ACTOR_KINDS } from '../events.js';
import { FORM_COLLECTION_CONTRACT } from '../forms.js';
import { RuntimeSelectionError } from '../agents/index.js';
import { StorageError } from '../blob.js';
import { EmailSenderError, MAIL_CAPTURE_CLEAR_PERMISSION, validateEmailSourceTemplate } from '../mail.js';

it('preserves storage failure codes so callers can distinguish missing blobs from I/O failures', () => {
  const missing = new StorageError('NOT_FOUND', 'Invoice attachment not found');
  const failed = new StorageError('IO', 'Invoice attachment could not be read');
  expect(missing).toBeInstanceOf(Error);
  expect(missing).toMatchObject({ name: 'StorageError', code: 'NOT_FOUND', message: 'Invoice attachment not found' });
  expect(failed).toMatchObject({ name: 'StorageError', code: 'IO', message: 'Invoice attachment could not be read' });
});

it('lets an agent consumer distinguish a runtime selection refusal from transport failures', () => {
  const unavailable = new RuntimeSelectionError('The selected runtime does not offer this model.');
  expect(unavailable).toBeInstanceOf(Error);
  expect(new Error(unavailable.message)).not.toBeInstanceOf(RuntimeSelectionError);
  expect(unavailable.message).toBe('The selected runtime does not offer this model.');
});

const fields = [
  { token: 'receipt_id', label: 'Receipt ID', required: true },
  { token: 'site_name', label: 'Website', required: false },
];

it.each([
  { caseName: 'unsupported declaration', template: { fields: ['receipt_id', 'recipient'], placeholders: ['receipt_id'] } },
  { caseName: 'source token used without declaration', template: { fields: ['receipt_id'], placeholders: ['receipt_id', 'site_name'] } },
])('rejects an email template with an $caseName using a caller-safe error', ({ template }) => {
  expect(() => validateEmailSourceTemplate({ fields, template })).toThrow(EmailSenderError);
  expect(() => validateEmailSourceTemplate({ fields, template })).toThrow(
    expect.objectContaining({ name: 'EmailSenderError', code: 'incompatible', message: 'Email sender: incompatible' }),
  );
});

it('accepts supported declarations and permits the same declared token in multiple template locations', () => {
  expect(validateEmailSourceTemplate({ fields, template: {
    fields: ['receipt_id', 'site_name'], placeholders: ['site_name', 'receipt_id', 'site_name'],
  } })).toBeUndefined();
});

it('keeps ledger actor values stable and distinct from unrecorded provenance', () => {
  expect([...RECORDED_ACTOR_KINDS].sort()).toEqual(['agent', 'member', 'owner', 'plugin', 'system', 'unknown', 'visitor']);
});

it('uses stable registration and permission keys for form providers and clearing captured mail', () => {
  expect(FORM_COLLECTION_CONTRACT).toBe('form_collection');
  expect(MAIL_CAPTURE_CLEAR_PERMISSION).toBe('mail.capture.clear');
});
