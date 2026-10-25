import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { readRequestConsentChoices } from '../express/index.js';
import { DENIED_CHOICES } from '../types.js';
import { accepted, config, now } from './fixtures.js';

/** Receipt-id format bounds in `express/index.ts` (`/^[a-zA-Z0-9_-]{16,128}$/`, Stryker L4 survivors):
 * an id outside the bounds never reaches storage and is reported as invalid proof (opt-in deny). */

const ALL = { necessary: true, functional: true, analytics: true, marketing: true };
const request = { get: () => undefined } as unknown as Request;

function run(id: string | null, present = true) {
  const reads: string[] = [];
  const failures: unknown[] = [];
  const ports: Parameters<typeof readRequestConsentChoices>[0]['ports'] = {
    config: { get: async () => ({ ...config, regionMode: 'opt-out' }) },
    records: { read: async ({ id: wanted }) => { reads.push(wanted); return { ...accepted, id: wanted }; }, save: async () => undefined },
    clock: { nowIso: () => now, nowMs: () => Date.parse(now) },
    readReceiptId: () => ({ id, present }),
    region: () => null,
    reportError: ({ error }) => { failures.push(error); },
  };
  return readRequestConsentChoices({ ports, request }).then(choices => ({ choices, reads, failures }));
}

describe('consent receipt id format', () => {
  it.each([
    ['16 chars (min)', 'a'.repeat(16)],
    ['128 chars (max)', 'Z'.repeat(128)],
    ['every allowed character class', 'aZ09_-aZ09_-aZ09'],
  ])('%s is read from storage', async (_label, id) => {
    const { choices, reads, failures } = await run(id);
    expect(reads).toEqual([id]);
    expect(choices).toEqual(ALL);
    expect(failures).toEqual([]);
  });

  it.each([
    ['15 chars (min-1)', 'a'.repeat(15)],
    ['129 chars (max+1)', 'a'.repeat(129)],
    ['a dot', `${'a'.repeat(16)}.`],
    ['a trailing newline', `${'a'.repeat(16)}\n`],
    ['leading space', ` ${'a'.repeat(16)}`],
    ['empty', ''],
  ])('%s never reaches storage and denies optional content (failed proof is opt-in)', async (_label, id) => {
    const { choices, reads, failures } = await run(id);
    expect(reads).toEqual([]);
    expect(choices).toEqual(DENIED_CHOICES);
    expect(failures).toEqual([expect.objectContaining({ message: 'The consent receipt cookie is invalid. Optional content stays denied; choose cookie preferences again.' })]);
  });

  it('a present cookie whose id the reader could not decode (null) is failed proof, not a new visitor', async () => {
    const { choices, reads } = await run(null, true);
    expect(reads).toEqual([]);
    expect(choices).toEqual(DENIED_CHOICES);
  });

  it('no cookie at all is a new visitor: opt-out region grants by default with no error', async () => {
    const { choices, reads, failures } = await run(null, false);
    expect(reads).toEqual([]);
    expect(failures).toEqual([]);
    expect(choices).toEqual(ALL);
  });
});
