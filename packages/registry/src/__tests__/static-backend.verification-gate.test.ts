import { beforeEach, describe, expect, it, vi } from 'vitest';

/** L2 §4 static-backend: verification identity is published ONLY alongside verified:true, and the
 *  search ordering is score-desc then name-asc. The verifier is replaced so each combination of
 *  verified / issuer / subject can be produced on its own. */
const verdict = vi.hoisted(() => ({ value: { verified: false } as Record<string, unknown> }));
vi.mock('../trust.js', async (importOriginal) => ({ ...(await importOriginal<object>()), verifyRegistryEntrySignatures: () => verdict.value }));
const { StaticRegistryBackend } = await import('../static-backend.js');

const entry = (name: string, extra: Record<string, unknown> = {}) => ({ name, version: '1.0.0', source: `src:${name}`, ...extra });
const backend = (entries = [entry('v/a')]) => new StaticRegistryBackend({ id: 'b', trust: 'restricted', manifest: { specVersion: '1', name: 'm', version: '1', entries } as never });
beforeEach(() => { verdict.value = { verified: false }; });

describe('resolve verification gate', () => {
  it.each([
    [{ verified: false, issuer: 'iss', subject: 'sub' }, {}],
    [{ verified: true, issuer: 'iss', subject: 'sub' }, { verifiedIssuer: 'iss', verifiedSubject: 'sub' }],
    [{ verified: true, issuer: 'iss' }, { verifiedIssuer: 'iss' }],
    [{ verified: true, subject: 'sub' }, { verifiedSubject: 'sub' }],
    [{ verified: true, issuer: '', subject: '' }, {}],
  ])('verdict %j publishes %j', async (value, published) => {
    verdict.value = value;
    const resolved = await backend().resolve({ name: 'V/A' });
    expect(resolved?.verified).toBe(value.verified);
    expect(Object.fromEntries(Object.entries(resolved ?? {}).filter(([key]) => key.startsWith('verified') && key !== 'verified'))).toEqual(published);
  });
  it('unknown names resolve null', async () => {
    expect(await backend().resolve({ name: 'v/zzz' })).toBeNull();
  });
});

describe('search ordering', () => {
  it('orders by score desc, ties by name asc, and honours limit', async () => {
    const b = backend([entry('v/zeta', { title: 'chart' }), entry('v/beta', { title: 'chart', description: 'chart chart', tags: ['chart'] }), entry('v/alpha', { title: 'chart' }), entry('v/other')]);
    const results = await b.search({ query: 'chart' });
    for (let i = 1; i < results.length; i++) {
      const [prev, cur] = [results[i - 1]!, results[i]!];
      expect(prev.score > cur.score || (prev.score === cur.score && prev.entry.name.localeCompare(cur.entry.name) < 0)).toBe(true);
    }
    const tied = results.filter(r => r.entry.name === 'v/zeta' || r.entry.name === 'v/alpha').map(r => r.entry.name);
    expect(tied).toEqual(['v/alpha', 'v/zeta']);
    expect(results.map(r => r.entry.name)).not.toContain('v/other');
    expect(await b.search({ query: 'chart' }, { limit: 1 })).toEqual(results.slice(0, 1));
  });
});
