import { describe, expect, it } from 'vitest';
import { createValidatingLookup } from '../asset-cache.js';

/** F2 source bug: a null/undefined entry inside an `all: true` DNS answer threw a TypeError
 *  out of the lookup callback instead of being refused like any other non-public entry. */
describe('createValidatingLookup with hostile list entries', () => {
  const answer = (address: unknown) =>
    ((_h: string, _o: unknown, cb: (e: Error | null, a?: unknown, f?: number) => void) => cb(null, address)) as never;
  it.each([null, undefined, 7, {}])('refuses a list containing %j (fail closed, no throw)', async (bad) => {
    const result = await new Promise<{ err: Error | null; address?: unknown }>((resolve) => {
      createValidatingLookup(answer([{ address: '93.184.216.34', family: 4 }, bad]))('host.example', { all: true }, (err, address) => resolve({ err, address }));
    });
    expect(result.err).toMatchObject({ message: 'host resolves to a private address' });
    expect(result.address).toBeUndefined();
  });
});
