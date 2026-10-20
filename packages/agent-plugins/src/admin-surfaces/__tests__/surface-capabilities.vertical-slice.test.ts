/**
 * @file The one phase-A vertical-slice proof for the admin-surface capability ports: a neutral
 * "acme-office" fixture is installed, bundled and activated through the real lifecycle owners and
 * its handler module admitted by the real loader. Through the host dispatcher it reads connection
 * status, starts a sign-in with a declared start parameter, takes the callback field the host's
 * callback route deposited after a completed sign-in, verifies it through guarded HTTP, saves the
 * selection in plugin state, and reads declared public config for its bootstrap. No network.
 */
import { expect, test } from 'vitest';
import { createPluginContributionLoader } from '../../lifecycle/contribution-loader.js';
import { findTrustedPluginPackages, importContainedModule, readTrustedPluginFile } from '../../lifecycle/__tests__/test-support.js';
import { FAKE_TOKEN, installPlugin, WORKSPACE_ID, withWorkspace } from '../../lifecycle/tools/__tests__/support.js';
import { createAdminSurfaceActionDispatcher, createAdminSurfaceHandlerHost, defineAdminSurfaceContribution, defineAdminSurfaceHandlerContribution } from '../index.js';
import { createFakeSurfaceHost } from './surface-support.js';

const FILENAME = 'host-admin-surfaces.json';
const HANDLERS = `export default {
  actions: {
    async 'read-status'({ capabilities, context }) {
      const status = await capabilities.connections.status({ connectionId: context.connectionIds[0] });
      return { state: status.state, account: status.accountLabel };
    },
    async 'choose-resource'({ capabilities, context }) {
      return capabilities.connections.begin({ connectionId: context.connectionIds[0], action: 'add-scopes' },
        { scopeSetIds: ['files'], startParams: { 'selection-mode': 'one' } });
    },
    async 'finish-choice'({ input, capabilities, context, fail }) {
      const connectionId = context.connectionIds[0];
      const fields = await capabilities.connections.takeCallbackFields({ connectionId, attemptId: input.attemptId });
      if (fields === null) throw fail({ code: 'choice-missing', message: 'Choose the resource again.' });
      const token = await capabilities.connections.getAccessToken({ connectionId });
      const response = await capabilities.http.fetch({ url: 'https://api.example.test/resources/' + fields['picked-id'] }, { headers: { authorization: 'Bearer ' + token } });
      if (response.status !== 200) throw fail({ code: 'choice-unverified', message: 'The chosen resource could not be opened; choose it again.' });
      await capabilities.state.set({ key: 'selection', value: { resourceId: fields['picked-id'] } });
      return { saved: true, resourceId: fields['picked-id'] };
    },
  },
  async bootstrap({ capabilities }) {
    return { appId: await capabilities.publicConfig.get({ name: 'ACME_APP_ID' }) };
  },
};
`;
const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required });
const SURFACES = JSON.stringify({ schemaVersion: 1, surfaces: [{
  id: 'resource-chooser', title: 'Choose a resource', entry: 'surface/index.html', files: ['surface/app.mjs'], handlerModule: 'server/handlers.mjs',
  connections: [{ id: 'account', startParams: ['selection-mode'], callbackFields: ['picked-id'] }], publicConfig: ['ACME_APP_ID'],
  actions: [
    { name: 'read-status', input: object({}), result: object({ state: { type: 'string' }, account: { type: 'string' } }, ['state']) },
    { name: 'choose-resource', input: object({}), result: object({ authorizationUrl: { type: 'string' }, attemptId: { type: 'string' }, expiresAt: { type: 'string' } }, ['authorizationUrl', 'attemptId']) },
    { name: 'finish-choice', input: object({ attemptId: { type: 'string', maxLength: 128 } }, ['attemptId']), result: object({ saved: { type: 'boolean' }, resourceId: { type: 'string' } }, ['saved']) },
  ],
  bootstrap: object({ appId: { type: 'string' } }, ['appId']),
}] });

test('an acme-style surface administers its own connection, takes a callback field once, verifies it and saves the choice', async () => {
  await withWorkspace(async (workspaceRoot) => {
    await installPlugin({ workspaceRoot, pluginId: 'acme-office', files: {
      [FILENAME]: SURFACES, 'surface/index.html': '<!doctype html><script type="module" src="app.mjs"></script>', 'surface/app.mjs': 'export {};', 'server/handlers.mjs': HANDLERS,
    } });
    const loader = createPluginContributionLoader({
      findPackages: (query) => findTrustedPluginPackages(query),
      readFile: ({ plugin, filename }) => readTrustedPluginFile(plugin, filename),
      importModule: ({ plugin, modulePath }) => importContainedModule(plugin, modulePath),
    });
    const fake = createFakeSurfaceHost({ config: { ACME_APP_ID: 'app-123' } });
    const host = createAdminSurfaceHandlerHost({ capabilities: fake.port });
    const surfaces = await loader.loadPluginContributions({ workspaceId: WORKSPACE_ID, definition: defineAdminSurfaceContribution({ filename: FILENAME }) });
    const handlerLoad = await loader.loadPluginContributions({ workspaceId: WORKSPACE_ID, definition: defineAdminSurfaceHandlerContribution({ filename: FILENAME }) });
    expect([...surfaces.refusals, ...host.sync({ loaded: handlerLoad.items, refusals: handlerLoad.refusals }).refusals]).toEqual([]);
    const [surface] = surfaces.items;
    if (!surface) throw new Error('the fixture surface was not admitted');
    const context = { workspaceId: WORKSPACE_ID, principalId: 'admin-1', pluginId: 'acme-office', surfaceId: 'resource-chooser' };
    const dispatcher = createAdminSurfaceActionDispatcher({ descriptor: surface.descriptor, handlers: host.handlersFor({ pluginId: 'acme-office', surfaceId: 'resource-chooser' }) });
    const dispatch = (action: string, payload: unknown = {}) => dispatcher.dispatch({ action, payload, context });

    expect(await host.bootstrapData({ context })).toEqual({ appId: 'app-123' });
    expect(await dispatch('read-status')).toEqual({ ok: true, result: { state: 'connected', account: 'person@example.test' } });
    const started = await dispatch('choose-resource');
    expect(started).toEqual({ ok: true, result: { authorizationUrl: 'https://auth.example.test/authorize?state=s1', attemptId: 'attempt-1', expiresAt: '2026-10-20T00:10:00.000Z' } });

    // The host's callback route, after the sign-in completed: deposits the declared callback field.
    fake.inbox.deposit({ workspaceId: WORKSPACE_ID, pluginId: 'acme-office', connectionId: 'account', attemptId: 'attempt-1', fields: { 'picked-id': 'res-42' } });
    expect(await dispatch('finish-choice', { attemptId: 'attempt-1' })).toEqual({ ok: true, result: { saved: true, resourceId: 'res-42' } });
    expect(await dispatch('finish-choice', { attemptId: 'attempt-1' })).toEqual({ ok: false, error: { code: 'choice-missing', message: 'Choose the resource again.', retryable: false } });

    expect(fake.log.requests).toEqual([{ url: 'https://api.example.test/resources/res-42', headers: { authorization: `Bearer ${FAKE_TOKEN}` } }]);
    expect([...fake.state.values()]).toEqual([{ resourceId: 'res-42' }]);
    expect(fake.log.calls).toEqual([
      'acme-office:publicConfig.get:{"name":"ACME_APP_ID"}',
      'acme-office:status:{"connectionId":"account"}',
      'acme-office:begin:{"connectionId":"account","action":"add-scopes","scopeSetIds":["files"],"startParams":{"selection-mode":"one"}}',
      'acme-office:state.set:{"key":"selection"}',
    ]);
  });
});
