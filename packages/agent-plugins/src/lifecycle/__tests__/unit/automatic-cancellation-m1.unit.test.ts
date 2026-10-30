import { expect, it, vi } from 'vitest';
import { createAutomaticAgentPluginUse, type AutomaticAgentPluginPorts } from '../../automatic-use.js';

it('does not resolve guidance when cancellation arrives while consent is pending', async () => {
  const controller = new AbortController();
  let answer!: (value: { action: 'use'; selected: string[] }) => void;
  let asked!: () => void;
  const asking = new Promise<void>(resolve => { asked = resolve; });
  const resolve = vi.fn<AutomaticAgentPluginPorts['resolve']>();
  const publish = vi.fn<AutomaticAgentPluginPorts['publish']>();
  const ports: AutomaticAgentPluginPorts = {
    list: async () => [{ pluginId: 'writer', enabled: true, keywords: [], skills: [], mcpServerIds: [] }],
    rank: () => [], resolve, publish, saveAuto: async () => {},
    ask: async () => { asked(); return new Promise(complete => { answer = complete; }); },
  };
  const use = createAutomaticAgentPluginUse({ mode: 'ask', ports });
  const loading = use.load({ pluginId: 'writer', signal: controller.signal });
  await asking;
  controller.abort();
  answer({ action: 'use', selected: ['writer'] });
  expect(await loading).toEqual({ status: 'cancelled', guidance: '' });
  expect(resolve).not.toHaveBeenCalled();
  expect(publish).toHaveBeenCalledWith({ state: { decision: { selected: ['writer'], asked: true }, excluded: [] }, plugins: [] }, {});
});
