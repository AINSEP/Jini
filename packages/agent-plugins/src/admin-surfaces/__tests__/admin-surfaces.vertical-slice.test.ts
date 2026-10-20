/**
 * @file The one phase-A vertical-slice proof for admin surfaces: a neutral fixture plugin on disk
 * declares a surface in a HOST-NAMED contribution file; the real contribution loader and trusted file
 * reader admit it; the host serves its entry with the strict headers, mounts it, posts init with a
 * bootstrap, and a surface client round-trips one declared action through the host-page gate and the
 * server dispatcher to a host handler. Windows are simulated with structured-clone message passing
 * that, like a browser, drops a message whose target origin does not match the receiver.
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { createPluginContributionLoader } from '../../lifecycle/contribution-loader.js';
import { readTrustedPluginFile } from '../../lifecycle/__tests__/test-support.js';
import {
  adminSurfaceActionResponse, adminSurfaceInitMessage, createAdminSurfaceActionDispatcher, createAdminSurfaceBootstrap,
  createAdminSurfaceMount, defineAdminSurfaceContribution, readAdminSurfaceFile, validateAdminSurfaceMessage,
} from '../index.js';
import { createAdminSurfaceClient, type AdminSurfaceIncomingMessage } from '../surface-client.js';

const HOST_ORIGIN = 'https://admin.example.com';
const FILENAME = 'acme-admin-surfaces.json';
let root: string | undefined;
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = undefined; });

/** A window that delivers posted messages to its listeners, dropping any whose target origin is not its own. */
function simulatedWindow(ownOrigin: string) {
  const listeners = new Set<(event: AdminSurfaceIncomingMessage) => void>();
  return {
    listen: (handler: (event: AdminSurfaceIncomingMessage) => void) => { listeners.add(handler); return () => { listeners.delete(handler); }; },
    deliver(required: { readonly data: unknown; readonly targetOrigin: string; readonly origin: string; readonly source: unknown }) {
      if (required.targetOrigin !== '*' && required.targetOrigin !== ownOrigin) return;
      for (const listener of listeners) listener({ origin: required.origin, source: required.source, data: structuredClone(required.data) });
    },
  };
}

test('a fixture plugin surface loads, is served strictly, mounts and round-trips one declared action', async () => {
  root = await mkdtemp(path.join(tmpdir(), 'admin-surface-slice-'));
  await mkdir(path.join(root, 'surface'));
  await writeFile(path.join(root, FILENAME), JSON.stringify({
    schemaVersion: 1,
    surfaces: [{
      id: 'connection-settings', title: 'Connection settings', entry: 'surface/index.html', files: ['surface/app.mjs'],
      actions: [{ name: 'save-selection', input: { type: 'object', properties: { resourceId: { type: 'string', maxLength: 128 } }, required: ['resourceId'] },
        result: { type: 'object', properties: { saved: { type: 'boolean' } }, required: ['saved'] } }],
      csp: { 'connect-src': ['https://api.example.com'] },
    }],
  }));
  await writeFile(path.join(root, 'surface/index.html'), '<!doctype html><script type="module" src="app.mjs"></script>');
  await writeFile(path.join(root, 'surface/app.mjs'), 'export {};');
  const plugin = { pluginId: 'acme-office', packageRoot: root };

  const loader = createPluginContributionLoader({
    findPackages: async () => [{ trusted: plugin }],
    readFile: ({ plugin: trusted, filename }) => readTrustedPluginFile(trusted, filename),
    importModule: async () => 'surfaces never import code',
  });
  const loaded = await loader.loadPluginContributions({ workspaceId: 'w1', definition: defineAdminSurfaceContribution({ filename: FILENAME }) });
  expect(loaded.refusals).toEqual([]);
  const surface = loaded.items[0]!;

  const served = await readAdminSurfaceFile({ surface, path: surface.descriptor.entry, readFile: ({ plugin: trusted, filename }) => readTrustedPluginFile(trusted, filename) });
  expect(served).toMatchObject({ ok: true, body: '<!doctype html><script type="module" src="app.mjs"></script>', headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  expect(served.ok && served.headers['Content-Security-Policy']).toContain('connect-src https://api.example.com; frame-src');

  const handled: unknown[] = [];
  const { dispatch } = createAdminSurfaceActionDispatcher<{ readonly workspaceId: string }>({
    descriptor: surface.descriptor,
    handlers: { 'save-selection': async ({ payload, context }) => { handled.push({ payload, context }); return { saved: true }; } },
  });
  const mount = createAdminSurfaceMount({ surfaceId: surface.descriptor.id });
  const hostWindow = simulatedWindow(HOST_ORIGIN);
  const frameWindow = simulatedWindow('null');
  const frameRecord = { mountId: mount.mountId, frame: frameWindow, descriptor: surface.descriptor };

  // How the frame sees its parent: posting to it lands in the host window as a message from the frame.
  const parentPort = { postMessage: (data: unknown, targetOrigin: string) => hostWindow.deliver({ data, targetOrigin, origin: 'null', source: frameWindow }) };
  const serverRoundTrips: Promise<void>[] = [];
  hostWindow.listen((event) => {
    const verdict = validateAdminSurfaceMessage({ event, mount: frameRecord });
    if (!verdict.ok) return;
    // The host page forwards to its server route as JSON; the server, not the frame, supplies context.
    const body = JSON.parse(JSON.stringify({ action: verdict.request.action, payload: verdict.request.payload }));
    serverRoundTrips.push(dispatch({ ...body, context: { workspaceId: 'w1' } }).then((outcome) => {
      frameWindow.deliver({ data: adminSurfaceActionResponse({ request: verdict.request, outcome }), targetOrigin: '*', origin: HOST_ORIGIN, source: parentPort });
    }));
  });

  const client = createAdminSurfaceClient({ parent: parentPort, listen: frameWindow.listen }, { nowMs: () => 2_000 });

  const bootstrap = createAdminSurfaceBootstrap({ surfaceId: surface.descriptor.id, data: { mode: 'pick' }, nowMs: 1_000 });
  frameWindow.deliver({ data: adminSurfaceInitMessage({ mountId: mount.mountId }, { bootstrap }), targetOrigin: '*', origin: HOST_ORIGIN, source: parentPort });
  await client.ready;
  expect(client.bootstrap()).toEqual({ mode: 'pick' });

  const result = client.call({ action: 'save-selection', payload: { resourceId: 'res-1' } });
  await Promise.resolve();
  await Promise.all(serverRoundTrips);
  await expect(result).resolves.toEqual({ saved: true });
  expect(handled).toEqual([{ payload: { resourceId: 'res-1' }, context: { workspaceId: 'w1' } }]);
  client.close();
});
