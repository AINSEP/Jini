import { describe, expect, it } from 'vitest';
import { canonicalJson, deleteMapRecord, matchesRecordFields, upsertRecord } from './records.js';

describe('memory record operations', () => {
  it('matches all supplied fields strictly, including explicit undefined', () => {
    const record = { scope: 'one', id: 'same', value: 1 };
    expect(matchesRecordFields({ record, fields: { scope: 'one', id: 'same' } })).toBe(true);
    expect(matchesRecordFields({ record, fields: { scope: 'other', id: 'same' } })).toBe(false);
    expect(matchesRecordFields({ record, fields: {} })).toBe(true);
    const optionalRecord: { value: number | undefined } = { value: 0 };
    expect(matchesRecordFields({ record: optionalRecord, fields: { value: undefined } })).toBe(false);
  });

  it('upserts by the full identity without replacing other scopes or reordering rows', () => {
    const first = { scope: 'one', id: 'same', value: 'first' };
    const other = { scope: 'two', id: 'same', value: 'other' };
    const records = [first, other];
    const changed = { ...first, value: 'changed' };
    upsertRecord({ records, record: changed, identity: { scope: 'one', id: 'same' } });
    const added = { scope: 'one', id: 'new', value: 'added' };
    upsertRecord({ records, record: added, identity: { scope: 'one', id: 'new' } });
    expect(records).toEqual([changed, other, added]);
    expect(records[0]).toBe(changed);
    expect(records[1]).toBe(other);
  });

  it('deletes only the keyed row in the selected scope', () => {
    const records = new Map([['same', { scope: 'one' }], ['kept', { scope: 'one' }]]);
    deleteMapRecord({ records, key: 'missing', fields: { scope: 'one' } });
    deleteMapRecord({ records, key: 'same', fields: { scope: 'other' } });
    expect([...records.keys()]).toEqual(['same', 'kept']);
    deleteMapRecord({ records, key: 'same', fields: { scope: 'one' } });
    expect([...records.keys()]).toEqual(['kept']);
  });
});

describe('canonicalJson', () => {
  it('sorts keys, drops undefined members, keeps array order', () => {
    expect(canonicalJson({ value: { b: 1, a: [2, { d: null, c: undefined }], e: 'x' } })).toBe('{"a":[2,{"d":null}],"b":1,"e":"x"}');
    expect(canonicalJson({ value: undefined })).toBe('null');
  });
});
