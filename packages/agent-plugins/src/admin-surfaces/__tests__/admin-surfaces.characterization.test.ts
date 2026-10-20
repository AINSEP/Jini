/**
 * @file Characterization pins written green on the unmodified `../host-validator.ts` and
 * `../surface-handlers.ts` before host-mediated link opening and the host-supplied `hostKind` were
 * added: the action gate keeps ignoring any message that is not an action request (so a new message
 * kind can never be forwarded to the server as an action), and a field the caller's context carries
 * beyond the known ones never reaches a plugin's handler.
 */
import { expect, test } from 'vitest';
import { createIssuedTokenMemories } from '../../lifecycle/tools/capabilities.js';
import { WORKSPACE_ID } from '../../lifecycle/tools/__tests__/support.js';
import {
  createAdminSurfaceActionDispatcher, createAdminSurfaceHandlerHost, parseAdminSurfacesFile, validateAdminSurfaceMessage, type AdminSurfaceDescriptor, type AdminSurfaceHandlerContext,
} from '../index.js';
import { createFakeSurfaceHost } from './surface-support.js';

const input = { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } as const;
const result = { type: 'object', properties: { saved: { type: 'boolean' } }, required: ['saved'] } as const;

function descriptorOf(surface: Record<string, unknown>): AdminSurfaceDescriptor {
  const parsed = parseAdminSurfacesFile({ raw: JSON.stringify({ schemaVersion: 1, surfaces: [surface] }) });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.descriptors[0]!;
}

test('the action gate ignores a non-action message kind from this mount instead of forwarding it', () => {
  const frame = {};
  const descriptor = descriptorOf({ id: 'settings', title: 'Settings', entry: 'index.html', actions: [{ name: 'save', input }] });
  const data = { protocol: 'jini.admin-surface', version: 1, kind: 'open-link', mountId: 'nonce-1', requestId: 'r1', action: 'save', payload: { name: 'x' }, url: 'https://example.com/' };
  expect(validateAdminSurfaceMessage({ event: { origin: 'null', source: frame, data }, mount: { mountId: 'nonce-1', frame, descriptor } })).toEqual({ ok: false, ignored: 'not-an-action-request' });
});

test('a field the caller context carries beyond the known ones never reaches the handler', async () => {
  const descriptor = descriptorOf({ id: 'settings', title: 'Settings', entry: 'index.html', actions: [{ name: 'save', input, result }], handlerModule: 'server/handlers.mjs' });
  const seen: unknown[] = [];
  const { port } = createFakeSurfaceHost();
  const host = createAdminSurfaceHandlerHost({ hostKind: 'hosted', capabilities: port, issuedTokens: createIssuedTokenMemories() });
  host.sync({ loaded: [{ pluginId: 'acme-office', descriptor: descriptor as AdminSurfaceDescriptor & { handlerModule: string }, module: { actions: { save: async ({ context }) => { seen.push(context); return { saved: true }; } } } }], refusals: [] });
  // Malformed input on purpose: a route that spreads request data into the context must not let it reach the plugin.
  const context = { workspaceId: WORKSPACE_ID, pluginId: 'acme-office', surfaceId: 'settings', hostKind: 'desktop', extra: 'x' } as AdminSurfaceHandlerContext;
  await createAdminSurfaceActionDispatcher({ descriptor, handlers: host.handlersFor({ pluginId: 'acme-office', surfaceId: 'settings' }) }).dispatch({ action: 'save', payload: { name: 'x' }, context });
  expect(seen).toHaveLength(1);
  expect(seen[0]).not.toHaveProperty('extra');
  expect(seen[0]).not.toHaveProperty('hostKind', 'desktop');
});
