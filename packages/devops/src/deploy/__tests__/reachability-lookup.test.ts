import type { lookup } from 'node:dns';
import { describe, expect, it, vi } from 'vitest';
import { createReachabilityLookup } from '../node.js';

type ResolverCallback = (error: NodeJS.ErrnoException | null, address?: unknown, family?: number) => void;

/** Hand-written resolver standing in for `dns.lookup`: answers every query with one fixed result. */
function fixedResolver(result: { error?: NodeJS.ErrnoException; address?: unknown; family?: number }): typeof lookup {
  const resolver = (_hostname: string, _options: unknown, callback: ResolverCallback): void => {
    callback(result.error ?? null, result.address, result.family);
  };
  return resolver as unknown as typeof lookup;
}

function resolve(resolver: typeof lookup, options: object = {}) {
  const callback = vi.fn();
  createReachabilityLookup({}, { lookupImpl: resolver })('deploy.example', options, callback);
  return callback;
}

describe('createReachabilityLookup', () => {
  it('passes a single public address and its family straight to the socket', () => {
    expect(resolve(fixedResolver({ address: '93.184.216.34', family: 4 }))).toHaveBeenCalledWith(null, '93.184.216.34', 4);
  });

  it('passes an all-addresses list through when every entry is a well-formed public address', () => {
    const list = [{ address: '93.184.216.34', family: 4 }, { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 }];
    expect(resolve(fixedResolver({ address: list }), { all: true })).toHaveBeenCalledWith(null, list, undefined);
  });

  it('refuses a list containing an entry without a numeric family instead of forwarding it to the socket', () => {
    const callback = resolve(fixedResolver({ address: [{ address: '93.184.216.34', family: 'IPv4' }] }), { all: true });
    expect(callback).toHaveBeenCalledWith(new Error('DNS lookup returned an invalid address'), '');
  });

  it('refuses a list mixing bare address strings into the { address, family } entries', () => {
    const callback = resolve(fixedResolver({ address: ['93.184.216.34'] }), { all: true });
    expect(callback).toHaveBeenCalledWith(new Error('DNS lookup returned an invalid address'), '');
  });

  it('surfaces a resolver failure as the socket error', () => {
    const failure = Object.assign(new Error('getaddrinfo ENOTFOUND deploy.example'), { code: 'ENOTFOUND' });
    expect(resolve(fixedResolver({ error: failure }))).toHaveBeenCalledWith(failure, '');
  });

  // SEC-003: the address validated is the address the socket connects to.
  it('refuses a host that resolves to a private address at connection time', () => {
    const [error] = resolve(fixedResolver({ address: '169.254.169.254', family: 4 })).mock.calls[0] ?? [];
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('private address');
  });
});
