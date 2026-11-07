import { describe, expect, it } from 'vitest';
import { asFormDestinationModule, formDestinationMissingMethods, parseFormDestinationsFile } from '../index.js';

const file = (destinations: unknown) => JSON.stringify({ schemaVersion: 1, destinations });
const entry = { id: 'sheet-push', label: 'Sheet', module: 'forms/sheet.mjs' };

describe('parseFormDestinationsFile', () => {
  it('keeps the declared fields and drops unknown keys', () => {
    const cohosted = { id: 'edge', label: 'Edge', module: 'edge.mjs', receive: 'co-hosted', hosts: ['static-host'], credentialLabel: 'Edge key', extra: 1 };
    expect(parseFormDestinationsFile({ raw: file([entry, cohosted]) })).toEqual({
      ok: true, descriptors: [entry, { id: 'edge', label: 'Edge', module: 'edge.mjs', receive: 'co-hosted', hosts: ['static-host'], credentialLabel: 'Edge key' }],
    });
  });

  it('refuses bad JSON, versions, ids, absolute modules, receive options and duplicates', () => {
    expect(parseFormDestinationsFile({ raw: '{' })).toEqual({ ok: false, reason: 'not valid JSON' });
    expect(parseFormDestinationsFile({ raw: JSON.stringify({ schemaVersion: 2, destinations: [] }) })).toEqual({ ok: false, reason: 'schemaVersion must be 1' });
    expect(parseFormDestinationsFile({ raw: file([{ ...entry, id: 'Bad_Id' }]) })).toEqual({ ok: false, reason: 'destinations[0].id must be a lowercase hyphenated id' });
    expect(parseFormDestinationsFile({ raw: file([{ ...entry, module: '/abs/x.mjs' }]) })).toEqual({ ok: false, reason: 'destinations[0].module must be a relative path ending in .mjs' });
    expect(parseFormDestinationsFile({ raw: file([{ ...entry, receive: 'co-hosted' }]) })).toEqual({ ok: false, reason: 'destinations[0].hosts must name at least one hosting target for a co-hosted receiver' });
    expect(parseFormDestinationsFile({ raw: file([{ ...entry, receive: 'inbox' }]) })).toEqual({ ok: false, reason: 'destinations[0].receive must be "co-hosted" or "external"' });
    expect(parseFormDestinationsFile({ raw: file([entry, entry]) })).toEqual({ ok: false, reason: "destinations[1].id 'sheet-push' is declared twice" });
  });
});

describe('form destination module rules', () => {
  // Only presence is checked, so one stub stands in for every method signature.
  const fn = (async () => undefined) as never;
  it('accepts an object export and refuses anything else', () => {
    const module = { deliver: fn };
    expect(asFormDestinationModule({ exported: module })).toBe(module);
    expect(asFormDestinationModule({ exported: [] })).toBe("its module's default export is not an object");
  });

  it('names the methods each receive mode needs', () => {
    const descriptor = { id: 'x', label: 'X', module: 'x.mjs' };
    expect(formDestinationMissingMethods({ entry: { descriptor, module: { deliver: fn } } })).toBeUndefined();
    expect(formDestinationMissingMethods({ entry: { descriptor, module: {} } })).toBe('a destination that does not receive submissions needs deliver()');
    expect(formDestinationMissingMethods({ entry: { descriptor: { ...descriptor, receive: 'co-hosted', hosts: ['h'] }, module: { pull: fn } } })).toBe('a destination that receives submissions needs pull() and ack()');
    expect(formDestinationMissingMethods({ entry: { descriptor: { ...descriptor, receive: 'external' }, module: { pull: fn, ack: fn } } })).toBe('an external receiver needs prepare()');
  });
});
