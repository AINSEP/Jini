import { describe, expect, it } from 'vitest';
import { asRecord, mapRawQuestion, stringOrUndefined } from '../normalize.js';

describe('asRecord', () => {
  it('returns an object unchanged', () => {
    const obj = { a: 1 };
    expect(asRecord(obj)).toBe(obj);
  });

  it('returns null for null and for primitives', () => {
    for (const raw of [null, undefined, 0, 'x', true]) expect(asRecord(raw)).toBeNull();
  });
});

describe('stringOrUndefined', () => {
  it('returns a string unchanged, including an empty one', () => {
    expect(stringOrUndefined('')).toBe('');
    expect(stringOrUndefined('x')).toBe('x');
  });

  it('returns undefined for a non-string', () => {
    expect(stringOrUndefined(1)).toBeUndefined();
  });
});

describe('mapRawQuestion basics', () => {
  it('returns null for a non-object entry', () => {
    expect(mapRawQuestion({ q: 'x', index: 0 })).toBeNull();
  });

  it('trims the id and falls back to an index-based id when it is blank', () => {
    expect(mapRawQuestion({ q: { id: ' a ' }, index: 0 })?.id).toBe('a');
    expect(mapRawQuestion({ q: { id: '   ' }, index: 2 })?.id).toBe('q3');
  });

  it('keeps an empty-string label instead of falling back to the id', () => {
    expect(mapRawQuestion({ q: { id: 'a', label: '' }, index: 0 })?.label).toBe('');
  });

  it('keeps an empty-string name but drops an empty placeholder and help', () => {
    const q = mapRawQuestion({ q: { id: 'a', name: '', placeholder: '', help: '' }, index: 0 });
    expect(q).toEqual({ id: 'a', name: '', label: 'a', type: 'text' });
  });

  it('emits fields in a stable order when every field is present', () => {
    const q = mapRawQuestion({
      q: {
        cards: [{ id: 'c', label: 'C' }], accept: 'image/*', multiple: true, step: 1, max: 9, min: 0,
        customPlaceholder: 'cp', customLabel: 'cl', allowCustom: true, maxSelections: 2, default: 'x',
        required: true, help: 'h', placeholder: 'p', options: ['x'], type: 'file', label: 'L', name: 'n', id: 'a',
      },
      index: 0,
    });
    expect(Object.keys(q ?? {})).toEqual([
      'id', 'name', 'label', 'type', 'options', 'placeholder', 'help', 'required', 'defaultValue',
      'allowCustom', 'customLabel', 'customPlaceholder', 'min', 'max', 'step', 'multiple', 'accept', 'cards',
    ]);
  });
});

describe('mapRawQuestion type normalization', () => {
  const typeOf = (type: unknown) => mapRawQuestion({ q: { id: 'a', type }, index: 0 })?.type;

  it('lower-cases and trims the type before matching an alias', () => {
    expect(typeOf('  RaDiO ')).toBe('radio');
  });

  it('falls back to text for a non-string type', () => {
    expect(typeOf(3)).toBe('text');
  });

  it('falls back to text for names inherited from Object.prototype', () => {
    for (const type of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) expect(typeOf(type)).toBe('text');
  });
});

describe('mapRawQuestion type-gated fields', () => {
  const map = (q: Record<string, unknown>) => mapRawQuestion({ q: { id: 'a', ...q }, index: 0 });

  it('drops maxSelections that is zero, fractional, or a numeric string', () => {
    for (const maxSelections of [0, 1.5, '3', -1]) expect(map({ type: 'checkbox', maxSelections })).not.toHaveProperty('maxSelections');
  });

  it('keeps maxSelections of 1 on a checkbox', () => {
    expect(map({ type: 'checkbox', maxSelections: 1 })?.maxSelections).toBe(1);
  });

  it('drops multiple and accept on a non-file question', () => {
    const q = map({ type: 'text', multiple: true, accept: 'image/*' });
    expect(q).not.toHaveProperty('multiple');
    expect(q).not.toHaveProperty('accept');
  });

  it('drops an empty accept on a file question', () => {
    expect(map({ type: 'file', accept: '' })).not.toHaveProperty('accept');
  });

  it('drops allowCustom that is neither true nor false', () => {
    expect(map({ allowCustom: 'yes' })).not.toHaveProperty('allowCustom');
  });

  it('lets allowCustom false win over the legacy custom key', () => {
    expect(map({ allowCustom: false, custom: true })?.allowCustom).toBe(false);
  });
});

describe('mapRawQuestion numeric attributes', () => {
  const map = (q: Record<string, unknown>) => mapRawQuestion({ q: { id: 'a', ...q }, index: 0 });

  it('keeps a zero min', () => {
    expect(map({ min: 0 })?.min).toBe(0);
  });

  it('drops a non-finite number', () => {
    expect(map({ max: Number.POSITIVE_INFINITY })).not.toHaveProperty('max');
  });

  it('turns a blank string into zero, because Number("") is 0', () => {
    expect(map({ step: '' })?.step).toBe(0);
  });
});

describe('mapRawQuestion default values', () => {
  const defaultOf = (q: Record<string, unknown>) => mapRawQuestion({ q: { id: 'a', options: [{ label: 'Yes', value: 'y' }], ...q }, index: 0 })?.defaultValue;

  it('keeps an empty-string defaultValue', () => {
    expect(defaultOf({ defaultValue: '' })).toBe('');
  });

  it('falls back to the legacy default key when defaultValue is not usable', () => {
    expect(defaultOf({ defaultValue: null, default: 'Yes' })).toBe('y');
    expect(defaultOf({ defaultValue: {}, default: false })).toBe('false');
  });

  it('prefers defaultValue over default', () => {
    expect(defaultOf({ defaultValue: 2, default: 'Yes' })).toBe('2');
  });

  it('ignores an array under the legacy default key', () => {
    expect(defaultOf({ default: ['Yes'] })).toBeUndefined();
  });

  it('keeps only string entries of an array defaultValue, resolving each label', () => {
    expect(defaultOf({ defaultValue: ['Yes', 1, 'other'] })).toEqual(['y', 'other']);
  });
});

describe('mapRawQuestion options', () => {
  const optionsOf = (options: unknown) => mapRawQuestion({ q: { id: 'a', options }, index: 0 })?.options;

  it('trims an object option value and description, dropping a blank description', () => {
    expect(optionsOf([{ label: ' L ', value: ' v ', description: '  ' }])).toEqual([{ label: 'L', value: 'v' }]);
  });

  it('keeps a trimmed description', () => {
    expect(optionsOf([{ label: 'L', description: ' d ' }])).toEqual([{ label: 'L', value: 'L', description: 'd' }]);
  });

  it('drops numeric entries and objects whose label is not a string', () => {
    expect(optionsOf([3, { label: 3 }, null, 'ok'])).toEqual([{ label: 'ok', value: 'ok' }]);
  });
});

describe('mapRawQuestion direction cards', () => {
  const cardsOf = (cards: unknown) => mapRawQuestion({ q: { id: 'a', cards }, index: 0 })?.cards;

  it('trims the card id and keeps an empty label', () => {
    expect(cardsOf([{ id: ' c ', label: '' }])?.[0]).toMatchObject({ id: 'c', label: '' });
  });

  it('skips null entries and keeps only string references', () => {
    expect(cardsOf([null, { id: 'c', label: 'C', references: ['r', 1] }])?.map((card) => card.references)).toEqual([['r']]);
  });

  it('treats non-array references and palette as empty', () => {
    expect(cardsOf([{ id: 'c', label: 'C', references: 'r', palette: '#fff' }])?.[0]).toMatchObject({ references: [], palette: [] });
  });

  it('skips a card whose id is blank', () => {
    expect(cardsOf([{ id: ' ', label: 'C' }])).toBeUndefined();
  });
});
