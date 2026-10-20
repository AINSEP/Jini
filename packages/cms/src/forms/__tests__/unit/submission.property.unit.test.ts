import { beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { validateSubmissionPayload } from '../../forms.js';
import type { FormDefinitionRecord } from '../../types.js';

const seed = Number(process.env.FC_SEED ?? 20261020);
const options = { seed, numRuns: 150 };
const definition: FormDefinitionRecord = {
  id: 'form-property', workspaceId: 'workspace-property', name: 'Contact', slug: 'contact',
  fields: [
    { id: 'answer', label: 'Answer', type: 'text', required: false, maxLength: 200 },
    { id: 'consent', label: 'Consent', type: 'checkbox', required: false },
  ],
  notify: { enabled: false, recipients: [] }, status: 'active', version: 1,
  createdAt: '2026-10-20T00:00:00.000Z', updatedAt: '2026-10-20T00:00:00.000Z',
};

beforeAll(() => console.info(`[fast-check cms/forms] seed=${seed}, numRuns=${options.numRuns}`));

describe('CMS submission validation properties', () => {
  it('preserves accepted values exactly and never stores the honeypot', () => {
    fc.assert(fc.property(fc.string({ maxLength: 100 }), fc.boolean(), fc.jsonValue(), (answer, consent, hp) => {
      const body = { answer, consent, _hp: hp };
      const before = structuredClone(body);
      expect(validateSubmissionPayload({ definition, body })).toEqual({ valid: true, data: { answer, consent } });
      expect(body).toEqual(before);
    }), options);
  });

  it('rejects every undeclared key, including object-prototype property names', () => {
    const unknownKey = fc.oneof(fc.string({ maxLength: 40 }), fc.constantFrom('__proto__', 'constructor', 'toString'))
      .filter(key => !['answer', 'consent', '_hp'].includes(key));
    fc.assert(fc.property(unknownKey, fc.jsonValue(), (key, value) => {
      expect(validateSubmissionPayload({ definition, body: { [key]: value } })).toEqual({
        valid: false, fieldErrors: [{ field: key, reason: 'unregistered_key' }],
      });
    }), options);
  });

  it('accepts exactly the declared text-length bound and refuses one character beyond', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 200 }), maxLength => {
      const bounded = { ...definition, fields: [{ ...definition.fields[0]!, maxLength }] };
      const answer = 'x'.repeat(maxLength);
      expect(validateSubmissionPayload({ definition: bounded, body: { answer } })).toEqual({ valid: true, data: { answer } });
      expect(validateSubmissionPayload({ definition: bounded, body: { answer: answer + 'x' } })).toEqual({
        valid: false, fieldErrors: [{ field: 'answer', reason: 'too_long' }],
      });
    }), options);
  });

  it('native on and JSON true normalize identically while optional false is retained', () => {
    fc.assert(fc.property(fc.string({ maxLength: 100 }), answer => {
      const expected = { valid: true, data: { answer, consent: true } };
      expect(validateSubmissionPayload({ definition, body: { answer, consent: 'on' } })).toEqual(expected);
      expect(validateSubmissionPayload({ definition, body: { answer, consent: true } })).toEqual(expected);
      expect(validateSubmissionPayload({ definition, body: { answer, consent: false } })).toEqual({
        valid: true, data: { answer, consent: false },
      });
    }), options);
  });

  it('requires authored checkbox submissions to equal the configured value', () => {
    fc.assert(fc.property(fc.string({ maxLength: 40 }), fc.string({ maxLength: 40 }), (configured, submitted) => {
      const authored: FormDefinitionRecord = { ...definition, fields: [
        { id: 'consent', label: 'Consent', type: 'checkbox', required: false, checkboxValue: configured },
      ] };
      expect(validateSubmissionPayload({ definition: authored, body: { consent: submitted } })).toEqual(
        submitted === configured ? { valid: true, data: { consent: submitted } }
          : { valid: false, fieldErrors: [{ field: 'consent', reason: 'invalid_option' }] },
      );
    }), options);
  });
});
