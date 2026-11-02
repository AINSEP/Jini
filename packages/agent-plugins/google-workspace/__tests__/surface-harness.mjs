/**
 * @file Test harness for the plugin's admin surfaces: the REAL Jini seam (descriptor parser, handler
 * host with its capability session, action dispatcher with its schema checks) around the plugin's
 * real handler modules, over in-memory host ports and the 127.0.0.1 fake Google. Nothing here talks
 * to Google or any third party; `fake.fetch` throws for every other host.
 */
import { readFile } from 'node:fs/promises';

import {
  createAdminSurfaceActionDispatcher, createAdminSurfaceHandlerHost, parseAdminSurfacesFile,
} from '@jini-ai/agent-plugins/admin-surfaces';
import { createIssuedTokenMemories } from '@jini-ai/agent-plugins/lifecycle/tools';

import { createConnectionPanelHandlers } from '../ui/connection-panel.handler.mjs';
import { createDestinationPanelHandlers } from '../ui/destination-panel.handler.mjs';
import { createPickerHandlers } from '../ui/picker.handler.mjs';
import { SPREADSHEET_MIME_TYPE } from '../lib/picker-selection.mjs';

export const PLUGIN = 'google-workspace';
export const WORKSPACE = 'ws-1';
export const ADMIN = 'admin-1';
export const FILE_ID = '1AbC-dEf_ghIJklmnOPqrs';
export const OTHER_FILE_ID = '1ZyX-wVu_tsRQponmLKjih';
/** Built at runtime: never a literal secret-shaped string in the repo. */
export const TOKEN = 'ya' + '29.' + 's'.repeat(40);
export const ACCOUNT_ACCESS = 'https://myaccount.google.com/connections';

/**
 * In-memory host ports, typed against Jini's `AdminSurfaceCapabilities`. `bindings` is the host's
 * delivery-binding list in the surface's view; {@link destinationBinding} builds an entry as the
 * destination panel saves it.
 * @param {{ connected?: boolean, granted?: string[], revocation?: 'confirmed' | 'pending' | 'not-needed', publicConfig?: Record<string, string> }} [options]
 */
export function createHostPorts(options = {}) {
  const state = new Map();
  const inbox = new Map();
  const calls = { begin: [], getAccessToken: 0, disconnect: 0, confirmSwitch: 0, cancelSwitch: 0 };
  const connection = {
    status: options.connected === false ? 'disconnected' : 'connected',
    accountLabel: options.connected === false ? null : 'Alice', grantedScopeSetIds: options.granted ?? ['sheets'], pendingSwitchAccountLabel: null,
  };
  let attempts = 0;
  /** @type {import('@jini-ai/agent-plugins/admin-surfaces').AdminSurfaceConnections} */
  const connections = {
    async getAccessToken() { calls.getAccessToken += 1; return TOKEN; },
    async status() { return { connectionId: 'account', ...connection }; },
    async begin(required, optional = {}) {
      calls.begin.push({ ...required, ...optional });
      attempts += 1;
      return { authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?attempt=${attempts}`, attemptId: `attempt-${attempts}`, expiresAt: new Date(Date.parse('2030-01-01T00:10:00Z')).toISOString() };
    },
    async confirmSwitch() { calls.confirmSwitch += 1; Object.assign(connection, { accountLabel: connection.pendingSwitchAccountLabel, pendingSwitchAccountLabel: null }); return { connectionId: 'account', ...connection }; },
    async cancelSwitch() { calls.cancelSwitch += 1; connection.pendingSwitchAccountLabel = null; return { connectionId: 'account', ...connection }; },
    async disconnect() {
      calls.disconnect += 1;
      const revocation = options.revocation ?? 'confirmed';
      Object.assign(connection, { status: revocation === 'pending' ? 'revocation-pending' : 'disconnected', accountLabel: null, grantedScopeSetIds: [] });
      return { connectionId: 'account', ...connection, revocation };
    },
    async takeCallbackFields({ attemptId }) { const fields = inbox.get(attemptId) ?? null; inbox.delete(attemptId); return fields; },
  };
  /** @type {import('@jini-ai/agent-plugins/admin-surfaces').AdminSurfaceState} */
  const stateStore = {
    async get({ key }) { return state.has(key) ? structuredClone(state.get(key)) : null; },
    async set({ key, value }) { state.set(key, structuredClone(value)); },
    async delete({ key }) { state.delete(key); },
  };
  const config = options.publicConfig ?? {};
  const bindings = [];
  let bindingIds = 0;
  /** The host's binding store as the surface sees it (the host assigns ids; refs never reach the plugin). @type {import('@jini-ai/agent-plugins/admin-surfaces').AdminSurfaceDeliveryBindings} */
  const deliveryBindings = {
    async list() { return structuredClone(bindings); },
    async save(draft) {
      const binding = { ...structuredClone(draft), bindingId: draft.bindingId ?? `binding-${(bindingIds += 1)}` };
      const index = bindings.findIndex((entry) => entry.bindingId === binding.bindingId);
      bindings.splice(index < 0 ? bindings.length : index, index < 0 ? 0 : 1, binding);
      return structuredClone(binding);
    },
    async remove({ bindingId }) { bindings.splice(bindings.findIndex((entry) => entry.bindingId === bindingId), 1); },
  };
  return { state, inbox, calls, connection, connections, stateStore, bindings, deliveryBindings,
    ...(options.forms === undefined ? {} : { forms: { async list() { return structuredClone(options.forms); } } }),
    publicConfig: { async get({ name }) { return config[name] ?? null; } } };
}

/**
 * One form's destination binding as the destination panel saves it.
 * @param {string} formSlug
 * @param {{ spreadsheetId?: string, sheetId?: number, accountId?: string, title?: string, tabTitle?: string }} [destination]
 */
export function destinationBinding(formSlug, destination = {}) {
  const { spreadsheetId = FILE_ID, sheetId = 7, accountId = 'perm-alice', title = 'Leads', tabTitle = 'Leads' } = destination;
  return {
    bindingId: `binding-${formSlug}`, adapterId: 'google-sheets', connectionId: 'account', enabled: true, formIds: [formSlug],
    config: { spreadsheetId, accountId, tabs: { [formSlug]: { sheetId } }, title, tabTitle },
  };
}

/** The surfaces file as Jini parses it. */
export async function surfaceDescriptors() {
  const parsed = parseAdminSurfacesFile({ raw: await readFile(new URL('../tovu-admin-surfaces.json', import.meta.url), 'utf8') });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.descriptors;
}

/**
 * Boots the handler host with the plugin's three handler modules.
 * @param {{ fake: { fetch: Function }, ports: ReturnType<typeof createHostPorts> }} required
 * @param {{ now?: () => number, randomId?: () => string, hostKind?: 'hosted' | 'desktop', principalId?: string | null }} [optional] The Picker flow's clock and id source; the host kind (default hosted).
 */
export async function bootSurfaces(required, optional = {}) {
  const { fake, ports } = required;
  const descriptors = await surfaceDescriptors();
  const modules = {
    connection: createConnectionPanelHandlers(),
    picker: createPickerHandlers({}, optional),
    'form-destinations': createDestinationPanelHandlers({}, optional),
  };
  /** @type {import('@jini-ai/agent-plugins/admin-surfaces').AdminSurfaceCapabilitiesPort} */
  const capabilities = () => ({
    http: { fetch: fake.fetch },
    limiter: { async check() { return { allowed: true }; } },
    artifacts: { async write() { throw new Error('admin surfaces write no artifacts'); } },
    connections: ports.connections, state: ports.stateStore, publicConfig: ports.publicConfig, deliveryBindings: ports.deliveryBindings,
    ...(ports.forms === undefined ? {} : { forms: ports.forms }),
  });
  const host = createAdminSurfaceHandlerHost({ capabilities, issuedTokens: createIssuedTokenMemories(), hostKind: optional.hostKind ?? 'hosted' });
  const { refusals } = host.sync({ loaded: descriptors.map((descriptor) => ({ pluginId: PLUGIN, descriptor, module: modules[descriptor.id] })), refusals: [] });
  if (refusals.length > 0) throw new Error(refusals.join('\n'));
  const errors = [];
  const context = (surfaceId) => ({ workspaceId: WORKSPACE, ...(optional.principalId === null ? {} : { principalId: optional.principalId ?? ADMIN }), pluginId: PLUGIN, surfaceId });
  return {
    errors,
    /** One action through the real dispatcher (payload schema, handler, result schema). */
    dispatch(surfaceId, action, payload = {}) {
      const descriptor = descriptors.find((entry) => entry.id === surfaceId);
      const dispatcher = createAdminSurfaceActionDispatcher({ descriptor, handlers: host.handlersFor({ pluginId: PLUGIN, surfaceId }) }, { onHandlerError: ({ error }) => errors.push(error) });
      return dispatcher.dispatch({ action, payload, context: context(surfaceId) });
    },
    bootstrap(surfaceId) { return host.bootstrapData({ context: context(surfaceId) }); },
  };
}

/** Fake Google resources: the account, one spreadsheet's Drive metadata and Sheets answer. */
export function serveGoogle(fake, { accountId = 'perm-alice', mimeType = SPREADSHEET_MIME_TYPE, fileStatus = 200, tabs = [{ sheetId: 0, title: 'Sheet1' }, { sheetId: 7, title: 'Leads' }] } = {}) {
  fake.route({ method: 'GET', path: '/drive/v3/about' }, () => [200, { user: { permissionId: accountId, displayName: 'Alice', emailAddress: 'alice@example.test' } }]);
  fake.route({ method: 'GET', path: `/drive/v3/files/${FILE_ID}` }, () => (fileStatus === 200
    ? [200, { id: FILE_ID, name: 'Leads', mimeType, trashed: false }]
    : [fileStatus, { error: { code: fileStatus, message: `File not found: ${FILE_ID}`, status: 'NOT_FOUND' } }]));
  fake.route({ method: 'GET', path: `/v4/spreadsheets/${FILE_ID}` }, (_req, _body, url) => [200, url.searchParams.get('fields')?.startsWith('sheets')
    ? { sheets: tabs.map((tab) => ({ properties: { ...tab, sheetType: 'GRID' } })) }
    : { spreadsheetId: FILE_ID, properties: { title: 'Leads' } }]);
}
