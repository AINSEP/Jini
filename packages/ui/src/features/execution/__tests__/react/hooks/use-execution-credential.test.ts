import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useExecutionCredential, type ExecutionCredentialEffects, type ExecutionCredentialPatch, type ExecutionCredentialPort, type ExecutionCredentialView } from '../../../react/hooks/use-execution-credential.hooks.js';
import type { ByokConfig } from '../../../types.js';

afterEach(cleanup);

const effects: ExecutionCredentialEffects<ExecutionCredentialView> = {
  namespace: 'execution',
  refreshPort: { publish: () => {}, subscribe: () => () => {} },
  readLegacyCredential: () => null,
  clearLegacyCredential: () => {},
  describeError: ({ error, fallback }) => error instanceof Error ? error.message : fallback,
  hasTypedKey: ({ apiKey }) => Boolean(apiKey.trim()),
  storedKeyIsForOtherEndpoint: () => false,
  hasUsableKey: ({ apiKey, stored }) => Boolean(apiKey) || stored?.isSet === true,
  storedKeyBlocksProbe: () => false,
  credentialHint: ({ stored }) => stored?.masked ?? undefined,
};

describe('write-only credential lifecycle', () => {
  it('separates key/settings patches and preserves edits made while a key save is in flight', async () => {
    const patches: ExecutionCredentialPatch[] = [];
    const stored: ExecutionCredentialView = { isSet: true, masked: 'stored credential', baseUrl: 'https://example.test' };
    let release!: (value: ExecutionCredentialView) => void;
    const pending = new Promise<ExecutionCredentialView>((resolve) => { release = resolve; });
    const port: ExecutionCredentialPort<ExecutionCredentialView> = {
      loadAdminExecutionCredential: async () => stored,
      saveAdminExecutionCredential: async ({ patch }) => { patches.push(patch); return patches.length === 1 ? pending : stored; },
    };
    const cleared: ByokConfig[] = [];
    const initial: ByokConfig = { protocol: 'openai', providerId: null, baseUrl: 'https://example.test', model: 'model', apiKey: 'test-draft' };
    const { result, rerender } = renderHook(({ byok }) => useExecutionCredential({
      byok, onByokChange: (next) => cleared.push(next), port, effects,
    }, {}), { initialProps: { byok: initial } });
    await act(async () => {});
    let saved!: Promise<void>;
    act(() => { saved = result.current.saveKey(); });
    await act(async () => {});
    rerender({ byok: { ...initial, apiKey: 'newer-draft', model: 'newer-model' } });
    await act(async () => { release(stored); await saved; });
    expect(patches).toEqual([{ apiKey: 'test-draft' }]);
    expect(cleared).toEqual([]);
    await act(async () => { await result.current.saveSettings(); });
    expect(patches[1]).toEqual({ protocol: 'openai', providerId: null, baseUrl: 'https://example.test', model: 'newer-model' });
    expect(patches[1]).not.toHaveProperty('apiKey');
    expect(result.current.settingsSaveState).toEqual({ status: 'saved' });
  });

  it('retains a legacy key after a rejected explicit migration', async () => {
    let cleared = false;
    const port: ExecutionCredentialPort<ExecutionCredentialView> = {
      loadAdminExecutionCredential: async () => ({ isSet: false, masked: null, baseUrl: null }),
      saveAdminExecutionCredential: async () => { throw new Error('save unavailable'); },
    };
    const hostEffects = { ...effects, readLegacyCredential: () => 'test-legacy-draft', clearLegacyCredential: () => { cleared = true; } };
    const byok: ByokConfig = { protocol: 'openai', providerId: null, baseUrl: 'https://example.test', model: 'model', apiKey: '' };
    const { result } = renderHook(() => useExecutionCredential({ byok, onByokChange: () => {}, port, effects: hostEffects }, {}));
    await act(async () => {});
    await act(async () => { await result.current.migrateLegacyKey(); });
    expect(cleared).toBe(false);
    expect(result.current.legacyKey).toBe('test-legacy-draft');
    expect(result.current.saveState).toEqual({ status: 'error', message: 'save unavailable' });
  });
});
