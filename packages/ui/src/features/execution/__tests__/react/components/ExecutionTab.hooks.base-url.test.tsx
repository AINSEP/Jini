import { act, renderHook } from '../../../../../__tests__/ui-kit-render-support.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeExecutionPort } from '../../../dependencies.js';
import type { ByokConfig, ExecutionConfig } from '@jini-ai/core/contracts/execution';
import { useExecutionTabView } from '../../../react/components/ExecutionTab.hooks.js';

const KEY = `sk-test-${'0'.repeat(32)}`;
const byok = (overrides: Partial<ByokConfig> = {}): ExecutionConfig => ({
  mode: 'byok',
  byok: { protocol: 'openai', providerId: 'custom', apiKey: KEY, baseUrl: 'https://saved.example.invalid/v1', model: 'm', ...overrides },
} as ExecutionConfig);

// B216: model discovery sends the provider key to the Base URL. It used to probe on every
// keystroke, then on a 600 ms pause; neither is the operator saying "this is the endpoint".
describe('BYOK model discovery waits for an explicitly committed Base URL', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function mount(initial: ExecutionConfig = byok()) {
    const port = createFakeExecutionPort({ models: ['m'] });
    const listModels = vi.spyOn(port, 'listModels');
    const view = renderHook(({ config }) => useExecutionTabView({ config, onConfigChange: () => {}, port, presets: [],
      autoDetect: false, canDiscoverModels: true, describeProbeError: undefined }), { initialProps: { config: initial } });
    return { listModels, view };
  }

  it('a paused Base URL draft does not reach listModels', async () => {
    const { listModels, view } = mount();
    expect(listModels).toHaveBeenCalledTimes(1);
    for (const partial of ['h', 'https://', 'https://ap', 'https://api.ex', ' https://api.example.invalid/v1 ']) {
      view.rerender({ config: byok({ baseUrl: partial }) });
      await act(async () => { vi.advanceTimersByTime(100); });
    }
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(listModels).toHaveBeenCalledTimes(1);
    act(() => { view.result.current.commitBaseUrl({ endpoint: { providerId: 'custom', protocol: 'openai', baseUrl: ' https://api.example.invalid/v1 ' } }); });
    expect(listModels).toHaveBeenCalledTimes(2);
    expect(listModels).toHaveBeenLastCalledWith(expect.objectContaining({ baseUrl: 'https://api.example.invalid/v1' }));
  });

  it('a settled but incomplete Base URL is never probed, even when committed', async () => {
    const { listModels, view } = mount();
    view.rerender({ config: byok({ baseUrl: 'https://' }) });
    await act(async () => { vi.advanceTimersByTime(2000); });
    act(() => { view.result.current.commitBaseUrl({ endpoint: { providerId: 'custom', protocol: 'openai', baseUrl: 'https://' } }); });
    expect(listModels).toHaveBeenCalledTimes(1);
  });

  it('switching to Custom does not approve a carried Base URL draft', async () => {
    const { listModels, view } = mount(byok({ providerId: 'gw' }));
    expect(listModels).toHaveBeenCalledTimes(1);
    view.rerender({ config: byok({ providerId: 'gw', baseUrl: 'https://draft.example.invalid/v1' }) });
    view.rerender({ config: byok({ providerId: null, baseUrl: 'https://draft.example.invalid/v1' }) });
    view.rerender({ config: byok({ providerId: null, protocol: 'anthropic', baseUrl: 'https://draft.example.invalid/v1' }) });
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(listModels).toHaveBeenCalledTimes(1);
  });

  it('a committed endpoint discovers when its key first becomes available', () => {
    const draft = 'https://keyed.example.invalid/v1';
    const { listModels, view } = mount(byok({ apiKey: '' }));
    view.rerender({ config: byok({ apiKey: '', baseUrl: draft }) });
    act(() => { view.result.current.commitBaseUrl({ endpoint: { providerId: 'custom', protocol: 'openai', baseUrl: draft } }); });
    const afterCommit = listModels.mock.calls.length;
    view.rerender({ config: byok({ apiKey: 'k', baseUrl: draft }) });
    expect(listModels).toHaveBeenCalledTimes(afterCommit + 1);
    expect(listModels).toHaveBeenLastCalledWith(expect.objectContaining({ baseUrl: draft }));
    view.rerender({ config: byok({ apiKey: 'kk', baseUrl: draft }) });
    view.rerender({ config: byok({ apiKey: KEY, baseUrl: draft }) });
    expect(listModels).toHaveBeenCalledTimes(afterCommit + 1);
  });

  it('a later prop rerender never seeds approval, and recommitting is a no-op', () => {
    const { listModels, view } = mount(byok({ baseUrl: 'not a url' }));
    expect(listModels).not.toHaveBeenCalled();
    view.rerender({ config: byok({ baseUrl: 'https://later.example.invalid/v1' }) });
    expect(listModels).not.toHaveBeenCalled();
    const endpoint = { providerId: 'custom', protocol: 'openai', baseUrl: 'https://later.example.invalid/v1' } as const;
    act(() => { view.result.current.commitBaseUrl({ endpoint }); });
    act(() => { view.result.current.commitBaseUrl({ endpoint: { ...endpoint, baseUrl: `${endpoint.baseUrl} ` } }); });
    expect(listModels).toHaveBeenCalledTimes(1);
    view.rerender({ config: byok({ baseUrl: '' }) });
    expect(listModels).toHaveBeenCalledTimes(2);
    expect(listModels).toHaveBeenLastCalledWith(expect.objectContaining({ baseUrl: '' }));
  });
});
