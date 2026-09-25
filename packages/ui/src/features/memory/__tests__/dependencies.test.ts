// Transport-adapter tests for the memory slice's default port bindings.
// Adapted from the pinned source's `providers-entries.test.ts` /
// `config-provider.test.ts` / `providers-extractions.test.ts` /
// `providers-connectors.test.ts` (mocking global `fetch` to pin the
// ok/non-ok branches and the strict required-field response contract), plus
// new coverage for this feature's own additions (the fake connector
// catalogue, the browser pending-auth bridge). See `packages/ui/source-map.md`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createFakeMemoryConnectorsPort,
  fetchMemoryList,
  memoryConfigPort,
  memoryConnectorsPort,
  memoryEntriesPort,
  memoryExtractionsPort,
} from '../dependencies.js';

const originalFetch = globalThis.fetch;

function mockFetch(impl: (url: string, init?: RequestInit) => { ok: boolean; status?: number; json?: () => Promise<unknown> }) {
  const fn = vi.fn(async (url: unknown, init?: RequestInit) => impl(String(url), init) as unknown as Response);
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

describe('fetchMemoryList (the fetchMemoryList() bug-fix regression suite)', () => {
  const fullPayload = {
    enabled: false,
    chatExtractionEnabled: true,
    profileEnabled: true,
    rewriteEnabled: true,
    verifyEnabled: true,
    rootDir: '/memory',
    index: '# Memory',
    entries: [{ id: 'e1', name: 'n', description: 'd', type: 'user' }],
  };

  it('returns the parsed list on a well-formed 2xx', async () => {
    mockFetch(() => ({ ok: true, json: async () => fullPayload }));
    expect(await fetchMemoryList()).toEqual(fullPayload);
  });

  it('rejects rather than fabricating a list when the request fails', async () => {
    mockFetch(() => ({ ok: false, status: 503 }));
    await expect(fetchMemoryList()).rejects.toThrow('Memory list request failed (503)');
  });

  // THE FIX: the pinned source only validated `entries` here, even though
  // `useMemoryConfig.hydrate()` reads `enabled` and `useMemoryEntries.reload()`
  // reads `rootDir`/`index` off this same response with no fallback. A
  // malformed `200` missing any of those three previously passed validation
  // and silently hydrated the consuming hook's state to `undefined`. Every
  // field consumed without a fallback must now be rejected when absent.
  it.each(['entries', 'rootDir', 'index', 'enabled'] as const)(
    'rejects a malformed 2xx list missing required field %s instead of silently succeeding',
    async (field) => {
      const payload: Record<string, unknown> = { ...fullPayload };
      delete payload[field];
      mockFetch(() => ({ ok: true, json: async () => payload }));
      await expect(fetchMemoryList()).rejects.toThrow(`Memory list request succeeded without a '${field}' field`);
    },
  );

  it('the exact malformed response from the bug report — { entries: [] } alone — is rejected, not silently hydrated', async () => {
    mockFetch(() => ({ ok: true, json: async () => ({ entries: [] }) }));
    await expect(fetchMemoryList()).rejects.toThrow("Memory list request succeeded without a 'rootDir' field");
  });

  it('does NOT require the four per-hook flags — their absence keeps the established legacy-default semantics', async () => {
    const payload: Record<string, unknown> = { ...fullPayload };
    delete payload.chatExtractionEnabled;
    delete payload.profileEnabled;
    delete payload.rewriteEnabled;
    delete payload.verifyEnabled;
    mockFetch(() => ({ ok: true, json: async () => payload }));
    const list = await fetchMemoryList();
    expect(list.chatExtractionEnabled).toBeUndefined();
    expect(list.entries).toEqual(fullPayload.entries);
  });

  it('a legitimately falsy `enabled: false` is not mistaken for a missing field', async () => {
    mockFetch(() => ({ ok: true, json: async () => fullPayload }));
    const list = await fetchMemoryList();
    expect(list.enabled).toBe(false);
  });
});

describe('memoryEntriesPort', () => {
  it('fetchMemoryTree returns the tree, a present empty tree, and rejects on failure/malformed', async () => {
    mockFetch(() => ({ ok: true, json: async () => ({ tree: [{ id: 't', kind: 'folder', name: 'n' }] }) }));
    expect(await memoryEntriesPort.fetchMemoryTree()).toEqual([{ id: 't', kind: 'folder', name: 'n' }]);
    mockFetch(() => ({ ok: true, json: async () => ({ tree: [] }) }));
    expect(await memoryEntriesPort.fetchMemoryTree()).toEqual([]);
    mockFetch(() => ({ ok: false }));
    await expect(memoryEntriesPort.fetchMemoryTree()).rejects.toThrow('Memory tree request failed');
    mockFetch(() => ({ ok: true, json: async () => ({}) }));
    await expect(memoryEntriesPort.fetchMemoryTree()).rejects.toThrow("Memory tree request succeeded without a 'tree' field");
  });

  it('fetchMemoryEntry returns the entry, null only for a genuine 404, and rejects other non-ok/malformed', async () => {
    mockFetch((url) => {
      expect(url).toBe('/api/memory/user_role');
      return { ok: true, json: async () => ({ entry: { id: 'user_role', name: 'n', description: 'd', type: 'user', body: 'b' } }) };
    });
    expect(await memoryEntriesPort.fetchMemoryEntry('user_role')).toEqual({
      id: 'user_role',
      name: 'n',
      description: 'd',
      type: 'user',
      body: 'b',
    });
    mockFetch(() => ({ ok: false, status: 404 }));
    expect(await memoryEntriesPort.fetchMemoryEntry('x')).toBeNull();
    mockFetch(() => ({ ok: false, status: 500 }));
    await expect(memoryEntriesPort.fetchMemoryEntry('x')).rejects.toThrow('Memory entry request failed (500)');
    mockFetch(() => ({ ok: true, json: async () => ({}) }));
    await expect(memoryEntriesPort.fetchMemoryEntry('x')).rejects.toThrow("Memory entry request succeeded without a 'entry' field");
  });

  it('fetchMemoryEntry rejects (not returns null) when the entry field is present but explicitly null', async () => {
    // requiredNonNullField's "present but null/undefined" branch — distinct
    // from the field being entirely absent (covered above) or a genuine 404.
    mockFetch(() => ({ ok: true, json: async () => ({ entry: null }) }));
    await expect(memoryEntriesPort.fetchMemoryEntry('x')).rejects.toThrow("Memory entry request succeeded without a 'entry' field");
  });

  it('saveMemoryEntry POSTs when the draft has no id and PUTs when it does', async () => {
    const post = mockFetch((url, init) => {
      expect(url).toBe('/api/memory');
      expect(init?.method).toBe('POST');
      return { ok: true, json: async () => ({ entry: { id: 'new', name: 'n', description: 'd', type: 'user', body: 'b' } }) };
    });
    const saved = await memoryEntriesPort.saveMemoryEntry({ name: 'n', description: 'd', type: 'user', body: 'b' });
    expect(saved?.id).toBe('new');
    expect(post).toHaveBeenCalledOnce();

    mockFetch((url, init) => {
      expect(url).toBe('/api/memory/e1');
      expect(init?.method).toBe('PUT');
      return { ok: false };
    });
    expect(await memoryEntriesPort.saveMemoryEntry({ id: 'e1', name: 'n', description: 'd', type: 'user', body: 'b' })).toBeNull();
  });

  it('saveMemoryEntry rejects when the save succeeds but the response omits the entry', async () => {
    mockFetch(() => ({ ok: true, json: async () => ({}) }));
    await expect(memoryEntriesPort.saveMemoryEntry({ name: 'n', description: 'd', type: 'user', body: 'b' })).rejects.toThrow(
      "Memory entry save succeeded without a 'entry' field",
    );
  });

  it('deleteMemoryEntry/saveMemoryIndex report success/failure from the ok flag', async () => {
    mockFetch((url, init) => {
      expect(url).toBe('/api/memory/e1');
      expect(init?.method).toBe('DELETE');
      return { ok: true };
    });
    expect(await memoryEntriesPort.deleteMemoryEntry('e1')).toBe(true);

    mockFetch((url, init) => {
      expect(url).toBe('/api/memory/index');
      expect(init?.method).toBe('PUT');
      return { ok: false };
    });
    expect(await memoryEntriesPort.saveMemoryIndex('# index')).toBe(false);
  });
});

describe('memoryConfigPort', () => {
  it('PATCHes /api/memory/config with the JSON patch body and reports the ok flag', async () => {
    const fetchMock = mockFetch(() => ({ ok: true }));
    expect(await memoryConfigPort.patchConfig({ enabled: false })).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('/api/memory/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
      // fetchWithTimeout composes its own timeout AbortSignal in — see fetch-with-timeout.ts.
      signal: expect.any(AbortSignal),
    });

    mockFetch(() => ({ ok: false }));
    expect(await memoryConfigPort.patchConfig({ profileEnabled: true })).toBe(false);
  });
});

describe('memoryExtractionsPort', () => {
  it('fetchExtractions returns the list on a 2xx and rejects on malformed/failure', async () => {
    mockFetch(() => ({ ok: true, json: async () => ({ extractions: [{ id: 'r1', startedAt: 1, phase: 'success' }] }) }));
    expect(await memoryExtractionsPort.fetchExtractions()).toEqual([{ id: 'r1', startedAt: 1, phase: 'success' }]);
    mockFetch(() => ({ ok: true, json: async () => ({}) }));
    await expect(memoryExtractionsPort.fetchExtractions()).rejects.toThrow("Memory extractions request succeeded without a 'extractions' field");
    mockFetch(() => ({ ok: false }));
    await expect(memoryExtractionsPort.fetchExtractions()).rejects.toThrow('Memory extractions request failed');
  });

  it('deleteExtraction/clearExtractionHistory report ok from the response', async () => {
    const fn = mockFetch((url, init) => {
      expect(url).toBe('/api/memory/extractions/a%2Fb');
      expect(init?.method).toBe('DELETE');
      return { ok: true };
    });
    expect(await memoryExtractionsPort.deleteExtraction('a/b')).toBe(true);
    expect(fn).toHaveBeenCalledOnce();

    mockFetch(() => ({ ok: false }));
    expect(await memoryExtractionsPort.deleteExtraction('r1')).toBe(false);

    const clearFn = mockFetch((url, init) => {
      expect(url).toBe('/api/memory/extractions');
      expect(init?.method).toBe('DELETE');
      return { ok: true };
    });
    expect(await memoryExtractionsPort.clearExtractionHistory()).toBe(true);
    expect(clearFn).toHaveBeenCalledOnce();
  });
});

describe('createFakeMemoryConnectorsPort', () => {
  it('fetches the seeded catalogue and independently-derived statuses', async () => {
    const port = createFakeMemoryConnectorsPort({
      connectors: [{ id: 'notion', name: 'Notion', provider: 'p', category: 'c', status: 'connected', accountLabel: 'me@x.com', tools: [] }],
    });
    expect(await port.fetchMemoryConnectors()).toEqual([
      { id: 'notion', name: 'Notion', provider: 'p', category: 'c', status: 'connected', accountLabel: 'me@x.com', tools: [] },
    ]);
    expect(await port.fetchConnectorStatuses()).toEqual({ notion: { status: 'connected', accountLabel: 'me@x.com' } });
  });

  it('omits accountLabel from a derived status entry for a connector that has none', async () => {
    const port = createFakeMemoryConnectorsPort({
      connectors: [{ id: 'figma', name: 'Figma', provider: 'p', category: 'c', status: 'available', tools: [] }],
    });
    expect(await port.fetchConnectorStatuses()).toEqual({ figma: { status: 'available' } });
  });

  it('connectConnector marks an existing connector connected, or synthesizes a new connected row for an unknown id', async () => {
    const port = createFakeMemoryConnectorsPort({
      connectors: [{ id: 'notion', name: 'Notion', provider: 'p', category: 'c', status: 'available', tools: [] }],
    });
    const known = await port.connectConnector('notion');
    expect(known.connector?.status).toBe('connected');
    expect(known.auth).toEqual({ kind: 'connected' });

    const unknown = await port.connectConnector('figma');
    expect(unknown.connector?.id).toBe('figma');
    expect(unknown.connector?.status).toBe('connected');
    // A second fetch now sees the synthesized row too.
    const catalogue = await port.fetchMemoryConnectors();
    expect(catalogue.map((c) => c.id)).toContain('figma');
  });

  it('suggestConnectorMemories resolves the seeded fixture, defaulting to null', async () => {
    expect(await createFakeMemoryConnectorsPort().suggestConnectorMemories(['notion'], {})).toBeNull();
    const fixture = { suggestions: [], attemptedLLM: true, connectors: [], contextBytes: 0 };
    const port = createFakeMemoryConnectorsPort({ suggestionResponse: fixture });
    expect(await port.suggestConnectorMemories(['notion'], {})).toBe(fixture);
  });

  it('simulated latency resolves asynchronously rather than synchronously', async () => {
    vi.useFakeTimers();
    const port = createFakeMemoryConnectorsPort({ latencyMs: 50 });
    let resolved = false;
    void port.fetchMemoryConnectors().then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(50);
    expect(resolved).toBe(true);
    vi.useRealTimers();
  });

  it('saveMemoryEntry on the fake-catalogue port is the real HTTP adapter, not a fake', async () => {
    mockFetch(() => ({ ok: true, json: async () => ({ entry: { id: 'e1', name: 'n', description: 'd', type: 'user', body: 'b' } }) }));
    const port = createFakeMemoryConnectorsPort();
    const saved = await port.saveMemoryEntry({ name: 'n', description: 'd', type: 'user', body: 'b' });
    expect(saved?.id).toBe('e1');
  });
});

describe('memoryConnectorsPort browser bridges', () => {
  it('readPendingConnectorAuthIds/writePendingConnectorAuthIds round-trip through sessionStorage', () => {
    memoryConnectorsPort.writePendingConnectorAuthIds(new Set(['notion', 'figma']));
    expect(memoryConnectorsPort.readPendingConnectorAuthIds()).toEqual(new Set(['notion', 'figma']));
    memoryConnectorsPort.writePendingConnectorAuthIds(new Set());
    expect(window.sessionStorage.getItem('jini:memory:pending-connector-auth')).toBeNull();
    expect(memoryConnectorsPort.readPendingConnectorAuthIds()).toEqual(new Set());
  });

  it('writePendingConnectorAuthIds swallows a blocked sessionStorage instead of throwing', () => {
    const setItem = vi.spyOn(window.sessionStorage.__proto__, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'QuotaExceededError');
    });
    expect(() => memoryConnectorsPort.writePendingConnectorAuthIds(new Set(['notion']))).not.toThrow();
    setItem.mockRestore();
  });

  it('drops non-string/blank entries and returns empty on malformed JSON or a non-array payload', () => {
    const KEY = 'jini:memory:pending-connector-auth';
    window.sessionStorage.setItem(KEY, JSON.stringify(['ok', '', 3, null]));
    expect(memoryConnectorsPort.readPendingConnectorAuthIds()).toEqual(new Set(['ok']));
    window.sessionStorage.setItem(KEY, JSON.stringify({ not: 'an array' }));
    expect(memoryConnectorsPort.readPendingConnectorAuthIds()).toEqual(new Set());
    window.sessionStorage.setItem(KEY, '{not json');
    expect(memoryConnectorsPort.readPendingConnectorAuthIds()).toEqual(new Set());
  });

  it('readPendingConnectorAuthIds returns empty when nothing was ever written', () => {
    expect(memoryConnectorsPort.readPendingConnectorAuthIds()).toEqual(new Set());
  });

  it('notifyConnectorsChanged dispatches a same-page CustomEvent listeners can observe', () => {
    const onChanged = vi.fn();
    window.addEventListener('jini:memory-connectors-changed', onChanged);
    memoryConnectorsPort.notifyConnectorsChanged();
    expect(onChanged).toHaveBeenCalledOnce();
    window.removeEventListener('jini:memory-connectors-changed', onChanged);
  });
});

describe('SSR-safety (no window)', () => {
  it('readPendingConnectorAuthIds/writePendingConnectorAuthIds/notifyConnectorsChanged no-op without a window', () => {
    // This suite runs under this package's default jsdom environment;
    // simulate the `typeof window === 'undefined'` SSR guard directly by
    // deleting the global for the scope of this one assertion, rather than
    // splitting off a whole node-environment companion file for three
    // one-line guards (a file-wide environment pragma can't be scoped to
    // just one block, and — as a real footgun worth flagging — vitest scans
    // for that pragma as a bare substring anywhere in the file, not just a
    // leading docblock, so even writing it out in a comment like this one
    // must avoid the literal token or it silently flips the whole file's
    // environment).
    const originalWindow = globalThis.window;
    // @ts-expect-error -- simulate an SSR environment for this one assertion.
    delete globalThis.window;
    try {
      expect(memoryConnectorsPort.readPendingConnectorAuthIds()).toEqual(new Set());
      expect(() => memoryConnectorsPort.writePendingConnectorAuthIds(new Set(['a']))).not.toThrow();
      expect(() => memoryConnectorsPort.notifyConnectorsChanged()).not.toThrow();
    } finally {
      globalThis.window = originalWindow;
    }
  });
});
