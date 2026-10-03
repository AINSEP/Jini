import { describe, expect, it } from 'vitest';
import {
  buildResourceIndex,
  handleResourceRead,
  resourcesToList,
  type McpResourceDef,
} from '../resource-protocol.js';
import type { McpToolContext } from '../tool-protocol.js';

const ctx: McpToolContext = { baseUrl: 'http://d.example', fetchImpl: fetch };

function makeResource(overrides: Partial<McpResourceDef> = {}): McpResourceDef {
  return {
    uri: 'jini://noop',
    name: 'Noop',
    read: () => ({ text: 'hello' }),
    ...overrides,
  };
}

describe('resourcesToList', () => {
  it('projects uri/name and omits description/mimeType when unset', () => {
    const resource = makeResource();
    expect(resourcesToList({ resources: [resource] })).toEqual([{ uri: 'jini://noop', name: 'Noop' }]);
  });

  it('includes description and mimeType when set', () => {
    const resource = makeResource({ description: 'a resource', mimeType: 'application/json' });
    expect(resourcesToList({ resources: [resource] })[0]).toEqual({
      uri: 'jini://noop',
      name: 'Noop',
      description: 'a resource',
      mimeType: 'application/json',
    });
  });
});

describe('buildResourceIndex', () => {
  it('indexes resources by uri', () => {
    const a = makeResource({ uri: 'jini://a' });
    const b = makeResource({ uri: 'jini://b' });
    const index = buildResourceIndex({ resources: [a, b] });
    expect(index.get('jini://a')).toBe(a);
    expect(index.get('jini://b')).toBe(b);
    expect(index.size).toBe(2);
  });

  it('builds an empty index for an empty list', () => {
    expect(buildResourceIndex({ resources: [] }).size).toBe(0);
  });

  it('throws on a duplicate resource uri', () => {
    expect(() =>
      buildResourceIndex({ resources: [makeResource({ uri: 'jini://dup' }), makeResource({ uri: 'jini://dup' })] }),
    ).toThrow('createMcpToolServer: duplicate resource uri "jini://dup"');
  });
});

describe('handleResourceRead', () => {
  it('throws for an unknown/adversarial uri instead of silently returning empty content', async () => {
    // Includes uris an attacker-controlled MCP client might probe with: a scheme this package
    // never registers (including a legacy product-scheme shape from an unrelated origin server)
    // and an empty string — all must fail closed, not resolve to something unintended.
    await expect(handleResourceRead({ uri: 'jini://missing', resources: buildResourceIndex({ resources: [] }), ctx })).rejects.toThrow(
      'unsupported resource URI: jini://missing',
    );
    await expect(handleResourceRead({ uri: 'legacy-scheme://focus/active', resources: buildResourceIndex({ resources: [] }), ctx })).rejects.toThrow(
      'unsupported resource URI: legacy-scheme://focus/active',
    );
    await expect(handleResourceRead({ uri: '', resources: buildResourceIndex({ resources: [] }), ctx })).rejects.toThrow(
      'unsupported resource URI: ',
    );
  });

  it('reads the matched resource and wraps the result as MCP contents, with no mimeType key when none is set', async () => {
    const resources = buildResourceIndex({ resources: [makeResource({ uri: 'jini://a', read: () => ({ text: 'body' }) })] });
    const result = await handleResourceRead({ uri: 'jini://a', resources, ctx });
    expect(result).toEqual({ contents: [{ uri: 'jini://a', text: 'body' }] });
  });

  it('falls back to the resource def\'s own mimeType when the read result omits one', async () => {
    const resources = buildResourceIndex({ resources: [
      makeResource({ uri: 'jini://a', mimeType: 'application/json', read: () => ({ text: '{}' }) }),
    ] });
    const result = await handleResourceRead({ uri: 'jini://a', resources, ctx });
    expect(result).toEqual({ contents: [{ uri: 'jini://a', text: '{}', mimeType: 'application/json' }] });
  });

  it('lets a per-read mimeType override the resource def\'s own default', async () => {
    const resources = buildResourceIndex({ resources: [
      makeResource({
        uri: 'jini://a',
        mimeType: 'application/json',
        read: () => ({ text: 'plain', mimeType: 'text/plain' }),
      }),
    ] });
    const result = await handleResourceRead({ uri: 'jini://a', resources, ctx });
    expect(result).toEqual({ contents: [{ uri: 'jini://a', text: 'plain', mimeType: 'text/plain' }] });
  });

  it('passes the context through to read', async () => {
    let seenCtx: unknown;
    const resources = buildResourceIndex({ resources: [
      makeResource({ uri: 'jini://a', read: ({ ctx: readCtx }) => { seenCtx = readCtx; return { text: 'ok' }; } }),
    ] });
    await handleResourceRead({ uri: 'jini://a', resources, ctx });
    expect(seenCtx).toBe(ctx);
  });

  it('awaits an async read', async () => {
    const resources = buildResourceIndex({ resources: [
      makeResource({ uri: 'jini://a', read: async () => Promise.resolve({ text: 'async-ok' }) }),
    ] });
    const result = await handleResourceRead({ uri: 'jini://a', resources, ctx });
    expect(result).toEqual({ contents: [{ uri: 'jini://a', text: 'async-ok' }] });
  });

  it('converts a thrown Error from read into a rejected promise with the (sanitized) message', async () => {
    const resources = buildResourceIndex({ resources: [
      makeResource({ uri: 'jini://a', read: () => { throw new Error('boom'); } }),
    ] });
    await expect(handleResourceRead({ uri: 'jini://a', resources, ctx })).rejects.toThrow('boom');
  });

  it('converts a thrown non-Error value from read via String()', async () => {
    const resources = buildResourceIndex({ resources: [
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      makeResource({ uri: 'jini://a', read: () => { throw 'oops'; } }),
    ] });
    await expect(handleResourceRead({ uri: 'jini://a', resources, ctx })).rejects.toThrow('oops');
  });

  it('sanitizes a secret-looking thrown message before it leaves the function', async () => {
    const resources = buildResourceIndex({ resources: [
      makeResource({
        uri: 'jini://a',
        read: () => { throw new Error('daemon 400: apikey=abcdefghijklmnopqrstuvwxyz123456'); },
      }),
    ] });
    await expect(handleResourceRead({ uri: 'jini://a', resources, ctx })).rejects.toThrow('[redacted]');
  });
});
