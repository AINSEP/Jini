import { describe, expect, it } from 'vitest';
import { findFieldReadRefusal, findFieldFillRefusal, type FieldDescriptor, type FieldReadRefusal } from '../guards.js';

describe('L077 secrecy guard precedence', () => {
  it.each([
    [{ type: 'PASSWORD', autocomplete: 'cc-number', name: 'secret' }, 'denied-type'],
    [{ autocomplete: 'section-user NEW-PASSWORD,current-password', name: 'secret' }, 'denied-autocomplete'],
    [{ autocomplete: 'email', name: 'api_key' }, 'suspicious-name'],
    [{ id: 'credit-card-number' }, 'suspicious-name'],
    [{ accessibleLabels: ['Enter value', 'Card number'] }, 'suspicious-name'],
    [{ name: 'ｐassword' }, 'suspicious-name'],
    [{ name: 'pássword' }, 'suspicious-name'],
    [{ accessibleLabels: ['Address', 'Snapshot'] }, null],
    [{ name: 'shipping', id: 'company', autocomplete: 'email' }, null],
    [{}, null],
    [{ autocomplete: '' }, null],
  ] satisfies [FieldDescriptor, FieldReadRefusal | null][])('reads %j with refusal %s', (field, expected) => {
    expect(findFieldReadRefusal({ field })).toBe(expected);
  });

  it('does not fold Cyrillic homoglyphs in secret names (reported, not fixed)', () => {
    const field = { name: 'pаssword' }; // U+0430 Cyrillic а, deliberately not Latin a.
    expect(findFieldReadRefusal({ field })).toBeNull();
    expect(findFieldFillRefusal({ field })).toBeNull();
  });
});
