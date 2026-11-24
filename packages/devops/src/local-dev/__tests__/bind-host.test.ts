import { describe, expect, it } from 'vitest';

import { DEFAULT_LOCAL_BIND_HOST, isLoopbackHost, resolveBindHost } from '../bind-host.js';

/**
 * @file Coverage for `bind-host.ts` — the pure `--host`/host-env resolver shared by a host's serve
 * command and its container entry point.
 *
 * `resolveBindHost` takes the already-picked raw value, not an env object: the serve command
 * computes `input.host ?? process.env.<HOST_ENV>` itself (the `--host` flag wins over the env var),
 * and the container entry — which has no `--host` flag — passes the env value directly. Keeping the
 * precedence decision at each call site, rather than inside this resolver, is what lets the entry
 * stay a one-input caller instead of also depending on a flag it does not have.
 *
 * Pinned here:
 *   - `undefined`/blank raw value           → the caller's own fallback, unchanged;
 *   - an IP literal (`net.isIP`)             → passed through verbatim;
 *   - `"::"` (Node's own dual-stack default) → `undefined`, so `.listen()` falls back to it itself;
 *   - a hostname (`localhost`, `my host`)    → the injected error with EXACT wording, because a
 *     server bound to `127.0.0.1` refuses a Node client that dials `localhost` and resolves `::1`
 *     first — accepting a hostname here would silently reintroduce that trap for a value that
 *     LOOKS like it should work.
 *
 * `isLoopbackHost` backs the non-loopback stderr warning a serve command prints when `--host`
 * widens exposure — it must recognize every loopback form (`127.0.0.1`, other `127.x.x.x`, `::1`),
 * not just the one literal `resolveBindHost` defaults to.
 */

class HostValidationError extends Error {
  constructor({ message }: { message: string }) { super(message); }
}

const injected = { source: '--host/APP_HOST', invalidHost: ({ message }: { message: string }) => new HostValidationError({ message }) };

function resolve(required: { raw: string | undefined; fallback: string | undefined }) {
  return resolveBindHost({ ...required, ...injected });
}

function rejection(raw: string): unknown {
  try {
    resolve({ raw, fallback: '127.0.0.1' });
  } catch (err) {
    return err;
  }
  throw new Error('expected resolveBindHost to throw');
}

describe('resolveBindHost', () => {
  it("undefined with fallback '127.0.0.1' returns the fallback", () => {
    expect(resolve({ raw: undefined, fallback: '127.0.0.1' })).toBe('127.0.0.1');
  });

  it('undefined with fallback undefined returns undefined', () => {
    expect(resolve({ raw: undefined, fallback: undefined })).toBeUndefined();
  });

  it('a whitespace-only raw value is treated as unset -- returns the fallback', () => {
    expect(resolve({ raw: '  ', fallback: '127.0.0.1' })).toBe('127.0.0.1');
  });

  it("'0.0.0.0' passes through verbatim", () => {
    expect(resolve({ raw: '0.0.0.0', fallback: '127.0.0.1' })).toBe('0.0.0.0');
  });

  it('an arbitrary IPv4 literal passes through verbatim', () => {
    expect(resolve({ raw: '192.168.1.5', fallback: '127.0.0.1' })).toBe('192.168.1.5');
  });

  it("'::1' passes through verbatim", () => {
    expect(resolve({ raw: '::1', fallback: '127.0.0.1' })).toBe('::1');
  });

  it("'::' resolves to undefined (Node's own all-interfaces default)", () => {
    expect(resolve({ raw: '::', fallback: '127.0.0.1' })).toBeUndefined();
  });

  it("'localhost' throws the injected error with the exact documented text", () => {
    const err = rejection('localhost');
    expect(err).toBeInstanceOf(HostValidationError);
    expect((err as Error).message).toBe('--host/APP_HOST must be an IP address such as 127.0.0.1 or 0.0.0.0 (got "localhost")');
  });

  it('a hostname with a space throws the injected error naming the given value', () => {
    const err = rejection('my host');
    expect(err).toBeInstanceOf(HostValidationError);
    expect((err as Error).message).toBe('--host/APP_HOST must be an IP address such as 127.0.0.1 or 0.0.0.0 (got "my host")');
  });
});

describe('isLoopbackHost', () => {
  it('127.0.0.1 is loopback', () => {
    expect(isLoopbackHost({ host: '127.0.0.1' })).toBe(true);
  });

  it('another 127.x.x.x literal is loopback', () => {
    expect(isLoopbackHost({ host: '127.5.0.1' })).toBe(true);
  });

  it('::1 is loopback', () => {
    expect(isLoopbackHost({ host: '::1' })).toBe(true);
  });

  it('0.0.0.0 is not loopback', () => {
    expect(isLoopbackHost({ host: '0.0.0.0' })).toBe(false);
  });

  it('undefined (all interfaces) is not loopback', () => {
    expect(isLoopbackHost({ host: undefined })).toBe(false);
  });

  it('an arbitrary LAN literal is not loopback', () => {
    expect(isLoopbackHost({ host: '192.168.1.5' })).toBe(false);
  });
});

it("DEFAULT_LOCAL_BIND_HOST is '127.0.0.1'", () => {
  expect(DEFAULT_LOCAL_BIND_HOST).toBe('127.0.0.1');
});
