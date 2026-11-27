import { expect, it, vi } from 'vitest';
import type { FormCollectionProvider } from '@jini-ai/core/contracts/forms';
import type { DefinedPlugin, PluginSdk } from '@jini-ai/core/contracts/plugin-sdk';
import echarts from '../charts-echarts/index.js';
import recharts from '../charts-recharts/index.js';
import formspree from '../formspree/index.js';
import googleForms from '../google-forms/index.js';

function recordingSdk() {
  const register = vi.fn<PluginSdk['providers']['register']>();
  const unapproved = (): never => { throw new Error('Unexpected server contribution during provider setup'); };
  const sdk: PluginSdk = {
    providers: { register },
    content: { read: unapproved, extend: unapproved },
    addFilter: unapproved, addAction: unapproved, addContribution: unapproved,
    routes: { add: unapproved }, tools: { add: unapproved }, widgets: { add: unapproved },
  };
  return { sdk, register };
}

it.each([
  {
    plugin: formspree, id: 'formspree',
    config: { endpoint: 'https://formspree.io/f/contact7' } as Record<string, string>,
    plan: { kind: 'post', action: 'https://formspree.io/f/contact7', external: true },
  },
  {
    plugin: googleForms, id: 'google_forms',
    config: { url: 'https://docs.google.com/forms/d/e/public-id/viewform' } as Record<string, string>,
    plan: { kind: 'embed', url: 'https://docs.google.com/forms/d/e/public-id/viewform?embedded=true', consent: ['functional'] },
  },
])('registers and initializes the $id collection provider', async ({ plugin, id, config, plan }) => {
  const { sdk, register } = recordingSdk();
  plugin.definition.setup(sdk);
  expect(register.mock.calls).toEqual([[{
    contract: 'form_collection', id, contractVersion: 1, factory: expect.any(Function),
  }]]);
  const [registration] = register.mock.calls[0]!;
  const resource = await registration.factory({});
  const provider = resource.port as FormCollectionProvider;
  expect(provider.plan({ config, slug: 'contact' })).toMatchObject(plan);
  await resource.dispose({});
  expect(provider.plan({ config, slug: 'contact' })).toMatchObject(plan);
});

const chartPlugins: Array<{ id: string; plugin: DefinedPlugin }> = [
  { id: 'charts-echarts', plugin: echarts }, { id: 'charts-recharts', plugin: recharts },
];
it.each(chartPlugins)('$id stays browser-only and registers no server provider', async ({ plugin }) => {
  const { sdk, register } = recordingSdk();
  await plugin.definition.setup(sdk);
  expect(register.mock.calls).toEqual([]);
});
