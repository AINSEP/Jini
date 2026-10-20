/**
 * @file The one phase-A vertical-slice proof for plugin-supplied surface handlers: a neutral
 * "acme-office" fixture is installed, bundled and activated through the real lifecycle owners; the
 * real loaders admit its surface (data) and its handler module (executable); the host composes
 * `handlersFor` into the existing action dispatcher and `bootstrapData` into the bootstrap envelope,
 * and one declared action runs plugin code with injected fake capabilities. No network.
 */
import { expect, test } from 'vitest';
import { createIssuedTokenMemories } from '../../lifecycle/tools/capabilities.js';
import { createPluginContributionLoader } from '../../lifecycle/contribution-loader.js';
import { findTrustedPluginPackages, importContainedModule, readTrustedPluginFile } from '../../lifecycle/__tests__/test-support.js';
import { FAKE_TOKEN, installPlugin, WORKSPACE_ID, withWorkspace } from '../../lifecycle/tools/__tests__/support.js';
import { createFakeSurfaceHost } from './surface-support.js';
import {
  createAdminSurfaceActionDispatcher, createAdminSurfaceBootstrap, createAdminSurfaceHandlerHost,
  defineAdminSurfaceContribution, defineAdminSurfaceHandlerContribution, readAdminSurfaceFile,
} from '../index.js';

const FILENAME = 'host-admin-surfaces.json';
const HANDLERS = `export default {
  actions: {
    async 'save-selection'({ input, capabilities, context }) {
      const token = await capabilities.connections.getAccessToken({ connectionId: context.connectionIds[0] });
      const response = await capabilities.http.fetch({ url: 'https://api.example.test/files/' + input.resourceId },
        { method: 'GET', headers: { authorization: 'Bearer ' + token } });
      return { saved: response.status === 200, workspace: context.workspaceId };
    },
  },
  async bootstrap({ capabilities }) {
    return { accessToken: await capabilities.connections.getAccessToken({ connectionId: 'conn-1' }), appId: 'public-app-id' };
  },
};
`;
const SURFACES = JSON.stringify({ schemaVersion: 1, surfaces: [{
  id: 'resource-chooser', title: 'Choose a file', entry: 'surface/index.html', files: ['surface/app.mjs'], handlerModule: 'server/handlers.mjs', connections: [{ id: 'conn-1' }],
  actions: [{ name: 'save-selection',
    input: { type: 'object', properties: { resourceId: { type: 'string', maxLength: 128 } }, required: ['resourceId'] },
    result: { type: 'object', properties: { saved: { type: 'boolean' }, workspace: { type: 'string' } }, required: ['saved'] } }],
  bootstrap: { type: 'object', properties: { accessToken: { type: 'string' }, appId: { type: 'string' } }, required: ['accessToken', 'appId'] },
}] });

test('an acme-style plugin surface runs its own handler and bootstrap provider through the host dispatcher', async () => {
  await withWorkspace(async (workspaceRoot) => {
    await installPlugin({ workspaceRoot, pluginId: 'acme-office', files: {
      [FILENAME]: SURFACES, 'surface/index.html': '<!doctype html><script type="module" src="app.mjs"></script>', 'surface/app.mjs': 'export {};', 'server/handlers.mjs': HANDLERS,
    } });
    const loader = createPluginContributionLoader({
      findPackages: (query) => findTrustedPluginPackages(query),
      readFile: ({ plugin, filename }) => readTrustedPluginFile(plugin, filename),
      importModule: ({ plugin, modulePath }) => importContainedModule(plugin, modulePath),
    });
    const { log, port } = createFakeSurfaceHost();
    const host = createAdminSurfaceHandlerHost({ issuedTokens: createIssuedTokenMemories(), capabilities: port });

    const surfaces = await loader.loadPluginContributions({ workspaceId: WORKSPACE_ID, definition: defineAdminSurfaceContribution({ filename: FILENAME }) });
    const handlerLoad = await loader.loadPluginContributions({ workspaceId: WORKSPACE_ID, definition: defineAdminSurfaceHandlerContribution({ filename: FILENAME }) });
    expect([...surfaces.refusals, ...host.sync({ loaded: handlerLoad.items, refusals: handlerLoad.refusals }).refusals]).toEqual([]);
    const [surface] = surfaces.items;
    if (!surface) throw new Error('the fixture surface was not admitted');
    expect(await readAdminSurfaceFile({ surface, path: 'server/handlers.mjs', readFile: ({ plugin, filename }) => readTrustedPluginFile(plugin, filename) })).toEqual({ ok: false, reason: 'not-declared' });

    const context = { workspaceId: WORKSPACE_ID, principalId: 'admin-1', pluginId: 'acme-office', surfaceId: 'resource-chooser' };
    const bootstrap = createAdminSurfaceBootstrap({ surfaceId: surface.descriptor.id, data: await host.bootstrapData({ context }), nowMs: 1_000 });
    expect(bootstrap).toEqual({ surfaceId: 'resource-chooser', issuedAt: 1_000, expiresAt: 61_000, data: { accessToken: FAKE_TOKEN, appId: 'public-app-id' } });

    const dispatcher = createAdminSurfaceActionDispatcher({ descriptor: surface.descriptor, handlers: host.handlersFor({ pluginId: 'acme-office', surfaceId: 'resource-chooser' }) });
    expect(await dispatcher.dispatch({ action: 'save-selection', payload: { resourceId: 'file-42' }, context }))
      .toEqual({ ok: true, result: { saved: true, workspace: WORKSPACE_ID } });
    expect(log.tokenRequests).toEqual(['conn-1', 'conn-1']);
    expect(log.requests).toEqual([{ url: 'https://api.example.test/files/file-42', headers: { authorization: `Bearer ${FAKE_TOKEN}` } }]);
  });
});
