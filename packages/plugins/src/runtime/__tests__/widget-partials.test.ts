import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createPluginContributionRegistry } from '../../host/contributions.js';
import type { PluginSdk } from '@jini-ai/core/contracts/plugin-sdk';
import { renderPluginWidgetPartials } from '../widget-partials.js';

test('inactive fragment cannot appear even if its name is requested', async () => {
  const contributions = createPluginContributionRegistry({});
  contributions.replace({ contributions: { pluginId: 'sample', sdk: {} as PluginSdk, routes: [], tools: [], widgets: [{ name: 'card', render: () => '<b>private</b>' }] } });
  let rendered = false;
  const html = await renderPluginWidgetPartials({ html: 'placement', workspaceId: 'ws', contributions,
    activationRepo: { getActivation: async () => null },
    render: { readNames: () => ['card'], validateHtml: () => { rendered = true; return 'private'; },
      expand: ({ partials }) => JSON.stringify(partials) },
  });
  assert.equal(html, '{}');
  assert.equal(rendered, false);
});

test('validator is used before expansion', async () => {
  const contributions = createPluginContributionRegistry({});
  contributions.replace({ contributions: { pluginId: 'sample', sdk: {} as PluginSdk, routes: [], tools: [], widgets: [{ name: 'card', render: () => '<b>raw</b>' }] } });
  const order: string[] = [];
  const html = await renderPluginWidgetPartials({ html: 'placement', workspaceId: 'ws', contributions,
    activationRepo: { getActivation: async () => ({ pluginId: 'sample', workspaceId: 'ws', version: '1', enabled: true, updatedAt: 'now' }) },
    render: { readNames: () => ['card'], validateHtml: ({ html }) => { order.push('validate'); assert.equal(html, '<b>raw</b>'); return '<b>safe</b>'; },
      expand: ({ html, partials, slots }) => { order.push('expand'); assert.equal(html, 'placement'); assert.deepEqual(slots, { card: { source: 'card.html' } }); return partials.card ?? ''; } },
  });
  assert.equal(html, '<b>safe</b>');
  assert.deepEqual(order, ['validate', 'expand']);
});

test('no markers returns original bytes and performs no lookup', async () => {
  const html = '  <p>original\r\n</p>  ';
  const result = await renderPluginWidgetPartials({ html, workspaceId: 'ws',
    contributions: { list() { throw new Error('registry read'); }, replace() {}, detach() {}, subscribe() { return () => {}; } },
    activationRepo: { getActivation() { throw new Error('activation read'); } },
    render: { readNames: () => [], validateHtml() { throw new Error('validation'); }, expand() { throw new Error('expansion'); } },
  });
  assert.equal(result, html);
});
