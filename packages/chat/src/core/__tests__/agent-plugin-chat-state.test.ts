import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_PLUGIN_STATE_CHANGED,
  captureAgentPluginUsage,
  readAgentPluginChatState,
  writeAgentPluginChatState,
  type AgentPluginChatState,
  type ChatPluginStorage,
} from '../agent-plugin-chat-state.js';

const EMPTY: AgentPluginChatState = { decision: null, excluded: [] };
const ROW_KEY = 'jini:chat-agent-plugins:a';

function memoryStorage(rows = new Map<string, string>()): ChatPluginStorage & { rows: Map<string, string> } {
  return { rows, getItem: (key) => rows.get(key) ?? null, setItem: (key, value) => { rows.set(key, value); } };
}

function storageWithRow(row: string): ChatPluginStorage {
  return memoryStorage(new Map([[ROW_KEY, row]]));
}

/** A browser-shaped `window`: a real EventTarget carrying a `localStorage`. */
function stubWindow(localStorage: ChatPluginStorage): EventTarget {
  const target = new EventTarget();
  vi.stubGlobal('window', Object.assign(target, { localStorage }));
  return target;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('local per-conversation plugin state', () => {
  it('round-trips decisions, separates chats, and makes × win over late responses', () => {
    const rows = new Map<string, string>();
    const storage = { getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value); } };
    writeAgentPluginChatState({ conversationId: 'a', state: { decision: { selected: ['theme'] }, excluded: [] } }, { storage });
    writeAgentPluginChatState({ conversationId: 'a', state: { decision: { selected: ['theme'] }, excluded: ['theme'] } }, { storage });
    writeAgentPluginChatState({ conversationId: 'a', state: { decision: { selected: ['theme'] }, excluded: [] } }, { storage });
    expect(readAgentPluginChatState({ conversationId: 'a' }, { storage })).toEqual({ decision: { selected: ['theme'] }, excluded: ['theme'] });
    expect(readAgentPluginChatState({ conversationId: 'b' }, { storage })).toEqual({ decision: null, excluded: [] });
    rows.clear();
    expect(readAgentPluginChatState({ conversationId: 'a' }, { storage }).decision).toBeNull();
  });
});

describe('readAgentPluginChatState', () => {
  it('returns a stored null decision with its exclusions', () => {
    const storage = storageWithRow(JSON.stringify({ decision: null, excluded: ['x'] }));
    expect(readAgentPluginChatState({ conversationId: 'a' }, { storage })).toEqual({ decision: null, excluded: ['x'] });
  });

  it('keeps the asked flag of a stored decision', () => {
    const storage = storageWithRow(JSON.stringify({ decision: { selected: [], asked: true }, excluded: [] }));
    expect(readAgentPluginChatState({ conversationId: 'a' }, { storage })).toEqual({ decision: { selected: [], asked: true }, excluded: [] });
  });

  it('treats a corrupt JSON row as a fresh chat', () => {
    expect(readAgentPluginChatState({ conversationId: 'a' }, { storage: storageWithRow('{not json') })).toEqual(EMPTY);
  });

  it('treats storage that throws on read as a fresh chat', () => {
    const storage: ChatPluginStorage = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => {} };
    expect(readAgentPluginChatState({ conversationId: 'a' }, { storage })).toEqual(EMPTY);
  });

  it('treats no storage at all as a fresh chat', () => {
    expect(readAgentPluginChatState({ conversationId: 'a' }, { storage: undefined })).toEqual(EMPTY);
  });

  it('rejects a row whose excluded is not an array', () => {
    expect(readAgentPluginChatState({ conversationId: 'a' }, { storage: storageWithRow(JSON.stringify({ decision: null, excluded: 'x' })) })).toEqual(EMPTY);
  });

  it('rejects a row whose excluded holds a non-string id', () => {
    expect(readAgentPluginChatState({ conversationId: 'a' }, { storage: storageWithRow(JSON.stringify({ decision: null, excluded: [1] })) })).toEqual(EMPTY);
  });

  it('rejects a row with no decision key', () => {
    expect(readAgentPluginChatState({ conversationId: 'a' }, { storage: storageWithRow(JSON.stringify({ excluded: [] })) })).toEqual(EMPTY);
  });

  it('rejects a decision whose selected is not an array', () => {
    expect(readAgentPluginChatState({ conversationId: 'a' }, { storage: storageWithRow(JSON.stringify({ decision: { selected: 'x' }, excluded: [] })) })).toEqual(EMPTY);
  });

  it('rejects a decision whose selected holds a non-string id', () => {
    expect(readAgentPluginChatState({ conversationId: 'a' }, { storage: storageWithRow(JSON.stringify({ decision: { selected: [2] }, excluded: [] })) })).toEqual(EMPTY);
  });

  it('defaults to window.localStorage when a browser window exists', () => {
    stubWindow(storageWithRow(JSON.stringify({ decision: null, excluded: ['w'] })));
    expect(readAgentPluginChatState({ conversationId: 'a' })).toEqual({ decision: null, excluded: ['w'] });
  });

  it('treats a window whose localStorage getter throws as a fresh chat', () => {
    const target = new EventTarget();
    Object.defineProperty(target, 'localStorage', { get: () => { throw new Error('blocked'); } });
    vi.stubGlobal('window', target);
    expect(readAgentPluginChatState({ conversationId: 'a' })).toEqual(EMPTY);
  });
});

describe('writeAgentPluginChatState', () => {
  it('continues the session when storage throws on write', () => {
    const storage: ChatPluginStorage = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } };
    expect(() => writeAgentPluginChatState({ conversationId: 'a', state: EMPTY }, { storage })).not.toThrow();
  });

  it('announces the merged state on window when one exists', () => {
    const storage = memoryStorage();
    const target = stubWindow(storage);
    const seen: unknown[] = [];
    target.addEventListener(AGENT_PLUGIN_STATE_CHANGED, (event) => { seen.push((event as CustomEvent).detail); });
    writeAgentPluginChatState({ conversationId: 'a', state: { decision: null, excluded: ['p'] } });
    expect(seen).toEqual([{ conversationId: 'a', state: { decision: null, excluded: ['p'] } }]);
    expect(storage.rows.get(ROW_KEY)).toBe(JSON.stringify({ decision: null, excluded: ['p'] }));
  });
});

describe('captureAgentPluginUsage', () => {
  const usage = { conversationId: 'a', state: { decision: { selected: ['theme'] }, excluded: ['x'] }, plugins: [] };

  it('persists the state of an agent_plugins ext event', () => {
    const storage = memoryStorage();
    stubWindow(storage);
    captureAgentPluginUsage({ event: { kind: 'ext', name: 'agent_plugins', data: usage } });
    expect(JSON.parse(storage.rows.get(ROW_KEY)!)).toEqual(usage.state);
  });

  it('ignores an event that is not ext', () => {
    const storage = memoryStorage();
    stubWindow(storage);
    captureAgentPluginUsage({ event: { kind: 'text', name: 'agent_plugins', data: usage } });
    expect(storage.rows.size).toBe(0);
  });

  it('ignores an ext event with another name', () => {
    const storage = memoryStorage();
    stubWindow(storage);
    captureAgentPluginUsage({ event: { kind: 'ext', name: 'mcp-ui', data: usage } });
    expect(storage.rows.size).toBe(0);
  });

  it('ignores an event with no data', () => {
    const storage = memoryStorage();
    stubWindow(storage);
    captureAgentPluginUsage({ event: { kind: 'ext', name: 'agent_plugins' } });
    expect(storage.rows.size).toBe(0);
  });

  it('ignores data with a non-string conversationId', () => {
    const storage = memoryStorage();
    stubWindow(storage);
    captureAgentPluginUsage({ event: { kind: 'ext', name: 'agent_plugins', data: { ...usage, conversationId: 7 } } });
    expect(storage.rows.size).toBe(0);
  });

  it('ignores data with no state', () => {
    const storage = memoryStorage();
    stubWindow(storage);
    captureAgentPluginUsage({ event: { kind: 'ext', name: 'agent_plugins', data: { conversationId: 'a' } } });
    expect(storage.rows.size).toBe(0);
  });

  it('ignores data whose state.excluded is not an array', () => {
    const storage = memoryStorage();
    stubWindow(storage);
    captureAgentPluginUsage({ event: { kind: 'ext', name: 'agent_plugins', data: { conversationId: 'a', state: { decision: null, excluded: 'x' } } } });
    expect(storage.rows.size).toBe(0);
  });

  it('stores a state with no decision key, which the next read then discards with its exclusions (reported, not fixed)', () => {
    const storage = memoryStorage();
    stubWindow(storage);
    captureAgentPluginUsage({ event: { kind: 'ext', name: 'agent_plugins', data: { conversationId: 'a', state: { excluded: ['x'] } } } });
    expect(storage.rows.get(ROW_KEY)).toBe(JSON.stringify({ excluded: ['x'] }));
    expect(readAgentPluginChatState({ conversationId: 'a' })).toEqual(EMPTY);
  });
});
