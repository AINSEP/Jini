import { act, renderHook } from '../../../../../__tests__/ui-kit-render-support.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeExecutionPort } from '../../../dependencies.js';
import type { ExecutionConfig } from '../../../types.js';
import { useExecutionTabView } from '../../../react/components/ExecutionTab.hooks.js';

const KEY = `sk-test-${'0'.repeat(32)}`;
const withBaseUrl = (baseUrl: string): ExecutionConfig => ({
  mode: 'byok',
  byok: { protocol: 'openai', providerId: 'custom', apiKey: KEY, baseUrl, model: 'm' },
} as ExecutionConfig);

// B216: model discovery sends the provider key to the Base URL. It used to probe on every
// keystroke, so the key went to every half-typed host ("https://ap", "https://api.ex", …).
describe('BYOK model discovery waits for a settled Base URL', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function mount() {
    const port = createFakeExecutionPort({ models: ['m'] });
    const listModels = vi.spyOn(port, 'listModels');
    const view = renderHook(({ config }) => useExecutionTabView({ config, onConfigChange: () => {}, port, presets: [],
      autoDetect: false, canDiscoverModels: true, describeProbeError: undefined }), { initialProps: { config: withBaseUrl('https://saved.example.com/v1') } });
    return { listModels, view };
  }

  it('typing https://ap, https://api.ex… sends no listModels call to a half-typed host', async () => {
    const { listModels, view } = mount();
    expect(listModels).toHaveBeenCalledTimes(1);
    for (const partial of ['h', 'https://', 'https://ap', 'https://api.ex', 'https://api.example.com/v1']) {
      view.rerender({ config: withBaseUrl(partial) });
      await act(async () => { vi.advanceTimersByTime(100); });
    }
    expect(listModels).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(listModels).toHaveBeenCalledTimes(2);
    expect(listModels).toHaveBeenLastCalledWith(expect.objectContaining({ baseUrl: 'https://api.example.com/v1' }));
  });

  it('a settled but incomplete Base URL is never probed', async () => {
    const { listModels, view } = mount();
    view.rerender({ config: withBaseUrl('https://') });
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(listModels).toHaveBeenCalledTimes(1);
  });
});
