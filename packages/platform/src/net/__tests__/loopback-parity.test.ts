import { isIP } from 'node:net';
import { describe, expect, it } from 'vitest';
import { isLoopbackHostname } from '@jini-ai/core/net';

/** The pre-move implementation, which used the runtime's own IPv4 check. */
function referenceIsLoopback(hostname: unknown): boolean {
  const normalized = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (normalized === 'localhost') return true;
  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;
  if (isIP(normalized) === 4) return normalized === '127.0.0.1' || normalized.startsWith('127.');
  return false;
}

function candidates(): unknown[] {
  const out: unknown[] = ['', 'localhost', 'localhost.', 'LOCALHOST', '[::1]', '::1', '0:0:0:0:0:0:0:1', '127.0.0.1.', '127.1',
    '0127.0.0.1', '127.0.0.01', '127.0.0.1 ', '1.2.3.4.5', '256.0.0.1', '127.0.0.256', '1000.0.0.1', '[127.0.0.1]', null, undefined, 0, 7, {}, false];
  let seed = 12345;
  const next = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const pieces = ['0', '1', '9', '10', '99', '100', '127', '255', '256', '300', '0001', '007', '1000', ''];
  for (let i = 0; i < 2000; i += 1) {
    const parts = Array.from({ length: next(2) === 0 ? 4 : 3 + next(3) }, () => pieces[next(pieces.length)]);
    out.push(parts.join('.') + (next(8) === 0 ? '.' : ''));
  }
  return out;
}

describe('core isLoopbackHostname matches the runtime-IPv4 reference', () => {
  it('agrees on every generated candidate', () => {
    for (const candidate of candidates()) {
      expect(isLoopbackHostname({ hostname: candidate }), String(candidate)).toBe(referenceIsLoopback(candidate));
    }
  });
});
