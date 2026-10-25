import type { lookup } from 'node:dns';
import { describe, expect, it, vi } from 'vitest';
import { createReachabilityLookup } from '../node.js';

/** AP2/AP3: one bad entry placed first, middle and last of a ≥3-item list, and one malformed
 *  shape per `isLookupAddress` clause — every variant must be refused, never forwarded. */
type ResolverCallback = (error: NodeJS.ErrnoException | null, address?: unknown, family?: number) => void;
const resolver = (address: unknown, family?: number): typeof lookup =>
  ((_hostname: string, _options: unknown, callback: ResolverCallback) => callback(null, address, family)) as unknown as typeof lookup;
const run = (address: unknown) => {
  const callback = vi.fn();
  createReachabilityLookup({}, { lookupImpl: resolver(address) })('deploy.example', { all: true }, callback);
  return callback;
};
const good = (n: number) => ({ address: `93.184.216.${n}`, family: 4 });
const invalid = new Error('DNS lookup returned an invalid address');

describe('reachability lookup refuses any single malformed entry', () => {
  const shapes: Array<[string, unknown]> = [
    ['null', null],
    ['a string', '93.184.216.1'],
    ['a number', 4],
    ['no address key', { family: 4 }],
    ['numeric address', { address: 1, family: 4 }],
    ['no family key', { address: '93.184.216.1' }],
    ['string family', { address: '93.184.216.1', family: '4' }],
  ];
  for (const [label, bad] of shapes) {
    it.each([0, 1, 2])(`${label} at position %i`, (position) => {
      const list = [good(1), good(2)];
      list.splice(position, 0, bad as never);
      const callback = run(list);
      expect(callback).toHaveBeenCalledOnce();
      const [error, address] = callback.mock.calls[0]!;
      expect(address).toBe('');
      expect(error).toBeInstanceOf(Error);
    });
  }

  it.each([0, 1, 2])('a well-shaped list is refused (shape error) only when one entry is malformed — malformed at %i', (position) => {
    const list: unknown[] = [good(1), good(2)];
    list.splice(position, 0, { address: '93.184.216.9', family: 'IPv4' });
    expect(run(list)).toHaveBeenCalledWith(invalid, '');
  });

  it.each([0, 1, 2])('a private address at position %i refuses the whole answer (no partial pass)', (position) => {
    const list = [good(1), good(2)];
    list.splice(position, 0, { address: '10.0.0.5', family: 4 });
    const callback = run(list);
    expect(callback).toHaveBeenCalledOnce();
    expect(callback.mock.calls[0]![0]).toMatchObject({ message: 'host resolves to a private address' });
    expect(callback.mock.calls[0]![1]).toBe('');
  });

  it('three well-formed public entries pass through unchanged', () => {
    const list = [good(1), good(2), good(3)];
    expect(run(list)).toHaveBeenCalledWith(null, list, undefined);
  });

  it.each([undefined, null, 4, { address: '93.184.216.1', family: 4 }])('a non-string, non-array answer %j is refused', (address) => {
    const callback = vi.fn();
    createReachabilityLookup({}, { lookupImpl: resolver(address, 4) })('deploy.example', {}, callback);
    expect(callback.mock.calls[0]![1]).toBe('');
    expect(callback.mock.calls[0]![0]).toBeInstanceOf(Error);
  });
});
