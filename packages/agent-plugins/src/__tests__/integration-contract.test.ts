import { withFileLock } from "@jini-ai/platform/fs/file-lock";
import * as nativeFilesystem from "node:fs/promises";
import { test, expect } from 'vitest';
import { validatePluginManifest, validateMcpManifest, isPluginManifest, isMcpManifest } from '../index.js';
import { createAgentPluginLifecycle, createAgentPluginLayout, parseAgentPluginManifest, fetchAgentPluginArchive } from '../lifecycle/index.js';
import { createNodeAgentPluginEffects } from '../lifecycle/node.js';
import { ports } from '../lifecycle/__tests__/test-support.js';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { forceRemove } from '../lifecycle/__tests__/fixtures/force-remove.js';

test('object validators preserve legacy structural validation', () => {
  for (const value of [null, [], {}, { name: '' }, { name: 'toolkit' }]) {
    expect(validatePluginManifest({ value })).toBe(isPluginManifest(value));
    expect(validateMcpManifest({ value })).toBe(isMcpManifest(value));
  }
  expect(validateMcpManifest({ value: { mcpServers: {} } })).toBe(true);
});

test('strict parser preserves standard author objects and legacy author strings', () => {
  const author = { name: 'Example', email: 'author@example.com', url: 'https://example.com' };
  for (const value of [author, 'Example']) {
    const result = parseAgentPluginManifest({ value: {
      $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'toolkit', author: value,
    } });
    expect(result).toMatchObject({ ok: true, manifest: { author: value } });
  }
});

// REGRESSION: fails if lifecycle calls fs/promises.open with a wrapped path object.
test('archive installation accepts native filesystem effects through the public facade', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'plugin-contract-'));
  const effects = createNodeAgentPluginEffects({});
  const seen: string[] = [];
  const api = createAgentPluginLifecycle({ ...ports, ...effects,
    layout: createAgentPluginLayout({ root }),
    filesystem: { ...effects.filesystem, open: async (...args: Parameters<typeof nativeFilesystem.open>) => {
      expect(typeof args[0]).toBe('string');
      seen.push(String(args[0]));
      return effects.filesystem.open(...args);
    } },
  });
  try {
    const sourceDir = path.join(root, 'source');
    await effects.filesystem.mkdir(sourceDir, { recursive: true });
    const handle = await effects.filesystem.open(path.join(sourceDir, 'plugin.json'), 'w');
    await handle.writeFile(JSON.stringify({ $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'toolkit' }), 'utf8');
    await handle.close();
    const packed = await api.packAgentPluginDirectory({ sourceDir });
    const reader = api.createBundledSourceArchiveReader({});
    const installed = await api.installAgentPlugin({ archive: packed.bytes, expectedSha256: packed.sha256,
      archiveReader: { entries: required => { expect(required.archive).toBe(packed.bytes); return reader.entries(required); } },
      layout: createAgentPluginLayout({ root }),
      workspaceId: 'example',
    });
    expect(installed.pluginId).toBe('toolkit');
    expect(installed.files).toEqual(['plugin.json']);
    expect(seen.some(p => p.endsWith('plugin.json'))).toBe(true);
  } finally { await forceRemove(root); }
});

test('download passes URL and redirect policy as separate objects to the fetch port', async () => {
  const requests: unknown[] = [];
  const result = await fetchAgentPluginArchive({ url: 'https://example.com/plugin.zip',
    outboundGuard: { assertAllowed: async () => {} },
    fetch: async (required, optional) => { requests.push([required, optional]); return new Response(new Uint8Array([4, 5])); },
  });
  expect(requests).toEqual([[{ url: 'https://example.com/plugin.zip' }, { redirect: 'manual' }]]);
  expect(Array.from(result.archive)).toEqual([4, 5]);
});

test('public callbacks receive objects, including lock ownership checks', async () => {
  const api = createAgentPluginLifecycle(ports);
  const received: unknown[] = [];
  const items = [{ id: 'plugin-a' }];
  expect(api.filterActiveAgentPlugins({ activations: { schemaVersion: 1, plugins: {} }, items,
    pluginIdOf: required => { received.push(required); return required.item.id; },
  })).toEqual(items);
  expect(received).toEqual([{ item: items[0] }]);
  const root = await mkdtemp(path.join(os.tmpdir(), 'plugin-lock-contract-'));
  try {
    const result = await withFileLock({ lockPath: path.join(root, 'lock'),
      run: async lock => { await lock.assertHeld({}); return lock.lockPath; },
    });
    expect(api).not.toHaveProperty('withExclusiveFileLock');
    expect(result).toBe(path.join(root, 'lock'));
  } finally { await forceRemove(root); }
});
