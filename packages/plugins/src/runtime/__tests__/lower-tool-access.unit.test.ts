import assert from 'node:assert/strict';
import { test } from 'vitest';
import { ToolAccessLoweringError } from '@jini-ai/core/tool-access-change';
import { lowerPluginToolAccess } from '../lower-tool-access.js';

/** @file A provider OFF also lowers its assistant faces; any failure collapses to the cause-free stop-failed error. */
test('a provider OFF stops answers admitted to its assistant face as well as its own tools', async () => {
  let seen: unknown; let reads = 0;
  await lowerPluginToolAccess({ pluginId: 'provider', notifyRosterChanged: async change => { seen = change?.lowered; }, providerFaces: { affectedPluginIds: async ({ pluginId }) => { reads++; assert.equal(pluginId, 'provider'); return ['provider', 'assistant-face']; } } }, {});
  assert.equal(reads, 1); assert.deepEqual(seen, { pluginIds: ['provider', 'assistant-face'] });
});

test('without a face lookup only the plugin itself is lowered', async () => {
  let seen: unknown;
  await lowerPluginToolAccess({ pluginId: 'solo', notifyRosterChanged: async change => { seen = change?.lowered; } });
  assert.deepEqual(seen, { pluginIds: ['solo'] });
});

test('a failing notify or lookup surfaces only ToolAccessLoweringError, never the sentinel cause', async () => {
  const notifyFails = lowerPluginToolAccess({ pluginId: 'p', notifyRosterChanged: async () => { throw new Error('sentinel'); } });
  await assert.rejects(notifyFails, error => error instanceof ToolAccessLoweringError && !error.message.includes('sentinel'));
  const lookupFails = lowerPluginToolAccess({ pluginId: 'p', notifyRosterChanged: async () => undefined, providerFaces: { affectedPluginIds: async () => { throw new Error('sentinel'); } } });
  await assert.rejects(lookupFails, error => error instanceof ToolAccessLoweringError && !error.message.includes('sentinel'));
});
