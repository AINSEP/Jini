import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  useExecutionCredential,
  type ExecutionCredentialEffects,
  type ExecutionCredentialPatch,
  type ExecutionCredentialPort,
  type ExecutionCredentialView,
} from '../../../react/hooks/use-execution-credential.hooks.js';
import type { ByokConfig } from '../../../types.js';
import type { SettingsSliceRefreshPort } from '../../../../panel-kit/hooks/use-settings-slice.hooks.js';

afterEach(cleanup);

type Listener = Parameters<SettingsSliceRefreshPort['subscribe']>[0]['listener'];

/** Hand-written in-memory refresh bus: records publishes and lets a test deliver a scope to subscribers. */
function createRefreshBus(): { published: string[][]; listenerCount: () => number; deliver: (scope: readonly string[] | null) => void; port: SettingsSliceRefreshPort } {
  const listeners = new Set<Listener>();
  const published: string[][] = [];
  return {
    published,
    listenerCount: () => listeners.size,
    deliver: (scope: readonly string[] | null) => { for (const listener of listeners) listener(scope); },
    port: {
      publish: ({ namespaces }) => { published.push([...namespaces]); },
      subscribe: ({ listener }) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    },
  };
}

function makeEffects(bus: ReturnType<typeof createRefreshBus>, overrides: Partial<ExecutionCredentialEffects<ExecutionCredentialView>> = {}): ExecutionCredentialEffects<ExecutionCredentialView> {
  return {
    namespace: 'execution',
    refreshPort: bus.port,
    readLegacyCredential: () => null,
    clearLegacyCredential: () => {},
    describeError: ({ error, fallback }) => error instanceof Error ? `${fallback}: ${error.message}` : fallback,
    hasTypedKey: ({ apiKey }) => Boolean(apiKey.trim()),
    storedKeyIsForOtherEndpoint: () => false,
    hasUsableKey: ({ apiKey, stored }) => Boolean(apiKey) || stored?.isSet === true,
    storedKeyBlocksProbe: () => false,
    credentialHint: ({ stored }) => stored?.masked ?? undefined,
    ...overrides,
  };
}

const empty: ExecutionCredentialView = { isSet: false, masked: null, baseUrl: null };
const storedView: ExecutionCredentialView = { isSet: true, masked: '••••abcd', baseUrl: 'https://example.test' };
const baseByok: ByokConfig = { protocol: 'openai', providerId: null, baseUrl: 'https://example.test', model: 'model-a', apiKey: '' };

describe('useExecutionCredential cross-mount refresh', () => {
  it('re-reads on a broad or matching refresh, ignores other namespaces, and unsubscribes on unmount', async () => {
    const bus = createRefreshBus();
    const stableEffects = makeEffects(bus);
    let loads = 0;
    const port: ExecutionCredentialPort<ExecutionCredentialView> = {
      loadAdminExecutionCredential: async () => { loads += 1; return loads === 1 ? empty : storedView; },
      saveAdminExecutionCredential: async () => storedView,
    };
    const { result, unmount } = renderHook(() => useExecutionCredential({ byok: baseByok, onByokChange: () => {}, port, effects: stableEffects }, {}));
    await act(async () => {});
    expect(loads).toBe(1);
    expect(result.current.stored).toEqual(empty);

    await act(async () => { bus.deliver(['some.other.slice']); });
    expect(loads).toBe(1);

    await act(async () => { bus.deliver(['execution']); });
    expect(loads).toBe(2);
    expect(result.current.stored).toEqual(storedView);
    expect(result.current.apiKeyPlaceholder).toBe('••••abcd');

    await act(async () => { bus.deliver(null); });
    expect(loads).toBe(3);

    unmount();
    expect(bus.listenerCount()).toBe(0);
  });
});

describe('useExecutionCredential saveKey', () => {
  it('is a no-op that never calls the port when the field is blank', async () => {
    const bus = createRefreshBus();
    const stableEffects = makeEffects(bus);
    const patches: ExecutionCredentialPatch[] = [];
    const port: ExecutionCredentialPort<ExecutionCredentialView> = {
      loadAdminExecutionCredential: async () => empty,
      saveAdminExecutionCredential: async ({ patch }) => { patches.push(patch); return storedView; },
    };
    const { result } = renderHook(() => useExecutionCredential({ byok: { ...baseByok, apiKey: '   ' }, onByokChange: () => {}, port, effects: stableEffects }, {}));
    await act(async () => {});
    expect(result.current.canSaveKey).toBe(false);
    await act(async () => { await result.current.saveKey(); });
    expect(patches).toEqual([]);
    expect(result.current.saveState).toEqual({ status: 'idle' });
  });

  it('saves the trimmed key alone, clears the unchanged field, installs the view and notifies other mounts', async () => {
    const bus = createRefreshBus();
    const stableEffects = makeEffects(bus);
    const patches: ExecutionCredentialPatch[] = [];
    const port: ExecutionCredentialPort<ExecutionCredentialView> = {
      loadAdminExecutionCredential: async () => empty,
      saveAdminExecutionCredential: async ({ patch }) => { patches.push(patch); return storedView; },
    };
    const changes: ByokConfig[] = [];
    const byok = { ...baseByok, apiKey: '  typed-key  ' };
    const { result } = renderHook(() => useExecutionCredential({ byok, onByokChange: (next) => changes.push(next), port, effects: stableEffects }, {}));
    await act(async () => {});
    await act(async () => { await result.current.saveKey(); });
    expect(patches).toEqual([{ apiKey: 'typed-key' }]);
    expect(changes).toEqual([{ ...byok, apiKey: '' }]);
    expect(result.current.saveState).toEqual({ status: 'saved' });
    expect(result.current.stored).toEqual(storedView);
    expect(bus.published).toEqual([['execution']]);
  });

  it('reports a failed key save through describeError and leaves the field and stored view untouched', async () => {
    const bus = createRefreshBus();
    const stableEffects = makeEffects(bus);
    const port: ExecutionCredentialPort<ExecutionCredentialView> = {
      loadAdminExecutionCredential: async () => empty,
      saveAdminExecutionCredential: async () => { throw new Error('denied'); },
    };
    const changes: ByokConfig[] = [];
    const { result } = renderHook(() => useExecutionCredential({ byok: { ...baseByok, apiKey: 'typed-key' }, onByokChange: (next) => changes.push(next), port, effects: stableEffects }, {}));
    await act(async () => {});
    await act(async () => { await result.current.saveKey(); });
    expect(result.current.saveState).toEqual({ status: 'error', message: 'failed to save the key: denied' });
    expect(changes).toEqual([]);
    expect(result.current.stored).toEqual(empty);
    expect(bus.published).toEqual([]);
  });
});

describe('useExecutionCredential saveSettings', () => {
  it('includes maxTokens when the form carries one and still never sends an apiKey property', async () => {
    const bus = createRefreshBus();
    const stableEffects = makeEffects(bus);
    const patches: ExecutionCredentialPatch[] = [];
    const port: ExecutionCredentialPort<ExecutionCredentialView> = {
      loadAdminExecutionCredential: async () => empty,
      saveAdminExecutionCredential: async ({ patch }) => { patches.push(patch); return storedView; },
    };
    const byok = { ...baseByok, apiKey: 'typed-but-unsaved', maxTokens: 2048 };
    const { result } = renderHook(() => useExecutionCredential({ byok, onByokChange: () => {}, port, effects: stableEffects }, {}));
    await act(async () => {});
    await act(async () => { await result.current.saveSettings(); });
    expect(patches).toEqual([{ protocol: 'openai', providerId: null, baseUrl: 'https://example.test', model: 'model-a', maxTokens: 2048 }]);
    expect(result.current.settingsSaveState).toEqual({ status: 'saved' });
    expect(result.current.saveState).toEqual({ status: 'idle' });
  });

  it('reports a failed settings save on its own status line only', async () => {
    const bus = createRefreshBus();
    const stableEffects = makeEffects(bus);
    const port: ExecutionCredentialPort<ExecutionCredentialView> = {
      loadAdminExecutionCredential: async () => empty,
      saveAdminExecutionCredential: async () => { throw 'offline'; },
    };
    const { result } = renderHook(() => useExecutionCredential({ byok: baseByok, onByokChange: () => {}, port, effects: stableEffects }, {}));
    await act(async () => {});
    await act(async () => { await result.current.saveSettings(); });
    expect(result.current.settingsSaveState).toEqual({ status: 'error', message: 'failed to save the settings' });
    expect(result.current.saveState).toEqual({ status: 'idle' });
    expect(bus.published).toEqual([]);
  });
});

describe('useExecutionCredential legacy migration', () => {
  it('migrates the legacy key with the current non-secret fields, then clears the local copy and the prompt', async () => {
    const bus = createRefreshBus();
    const stableEffects = makeEffects(bus);
    const patches: ExecutionCredentialPatch[] = [];
    let clears = 0;
    const port: ExecutionCredentialPort<ExecutionCredentialView> = {
      loadAdminExecutionCredential: async () => empty,
      saveAdminExecutionCredential: async ({ patch }) => { patches.push(patch); return storedView; },
    };
    const effects = makeEffects(bus, { readLegacyCredential: () => 'legacy-draft', clearLegacyCredential: () => { clears += 1; } });
    const { result } = renderHook(() => useExecutionCredential({ byok: { ...baseByok, maxTokens: 512 }, onByokChange: () => {}, port, effects }, {}));
    await act(async () => {});
    expect(result.current.legacyKey).toBe('legacy-draft');
    await act(async () => { await result.current.migrateLegacyKey(); });
    expect(patches).toEqual([{ apiKey: 'legacy-draft', protocol: 'openai', providerId: null, baseUrl: 'https://example.test', model: 'model-a', maxTokens: 512 }]);
    expect(clears).toBe(1);
    expect(result.current.legacyKey).toBeNull();
    expect(result.current.saveState).toEqual({ status: 'saved' });
    expect(bus.published).toEqual([['execution']]);
  });

  it('does nothing when there is no legacy key, and never offers one once a credential is stored', async () => {
    const bus = createRefreshBus();
    const stableEffects = makeEffects(bus);
    const patches: ExecutionCredentialPatch[] = [];
    const port: ExecutionCredentialPort<ExecutionCredentialView> = {
      loadAdminExecutionCredential: async () => storedView,
      saveAdminExecutionCredential: async ({ patch }) => { patches.push(patch); return storedView; },
    };
    const effects = makeEffects(bus, { readLegacyCredential: () => 'legacy-draft' });
    const { result } = renderHook(() => useExecutionCredential({ byok: baseByok, onByokChange: () => {}, port, effects }, {}));
    await act(async () => {});
    expect(result.current.legacyKey).toBeNull();
    await act(async () => { await result.current.migrateLegacyKey(); });
    expect(patches).toEqual([]);
    expect(result.current.saveState).toEqual({ status: 'idle' });
  });

  it('hides the prompt for the rest of the mount once dismissed, without clearing the local key', async () => {
    const bus = createRefreshBus();
    const stableEffects = makeEffects(bus);
    let clears = 0;
    const port: ExecutionCredentialPort<ExecutionCredentialView> = {
      loadAdminExecutionCredential: async () => empty,
      saveAdminExecutionCredential: async () => storedView,
    };
    const effects = makeEffects(bus, { readLegacyCredential: () => 'legacy-draft', clearLegacyCredential: () => { clears += 1; } });
    const { result } = renderHook(() => useExecutionCredential({ byok: baseByok, onByokChange: () => {}, port, effects }, {}));
    await act(async () => {});
    expect(result.current.legacyKey).toBe('legacy-draft');
    act(() => { result.current.dismissLegacyPrompt(); });
    expect(result.current.legacyKey).toBeNull();
    expect(clears).toBe(0);
  });
});
