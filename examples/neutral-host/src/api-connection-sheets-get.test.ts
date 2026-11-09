/**
 * F4 second host: a host that is not the product the google-workspace plugin came from wires, with
 * public `@jini-ai/*` factories only, the REAL API-connection host (`createApiConnectionHost`) over its
 * own in-memory record/token stores, the REAL tool capabilities (`createAgentPluginToolCapabilities`)
 * over `host.toolConnections`, and the REAL tool projection. It signs in through the host's hosted
 * start (`startApiConnectionSignIn` → sign-in hand-off) and finish (`serviceFor().complete`, which runs
 * the code exchange and `finishAuthorization`) against an in-process fake Google (token endpoint, Drive
 * `about` for the account, Sheets), then runs the shipped `sheets_get` tool. The bearer the fake Sheets
 * API receives is the one the fake token endpoint issued for that sign-in: nothing hands the tool a
 * token except the host. No real network, no real credentials.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ApiConnectionError, asApiConnectionHooksModule, checkApiConnectionClientNamespace, createApiConnectionHost, parseApiConnectionDescriptor,
  parseApiConnectionsFile, startApiConnectionSignIn,
  type ApiConnectionAttempt, type ApiConnectionCallbackFieldRules, type ApiConnectionDeclaration, type ApiConnectionHooksModule,
  type ApiConnectionHostMessages, type ApiConnectionHostRecordStore, type ApiConnectionOAuthCapabilities, type ApiConnectionRecord,
  type ApiConnectionTokenStore, type DeclaredApiConnection, type PluginHttp,
} from '@jini-ai/integrations/api-connections';
import { createAgentPluginToolCapabilities, createFrozenConnectionAccounts } from '@jini-ai/agent-plugins/connect/executable';
import { createAgentPluginToolProjection, createIssuedTokenMemories, defineAgentPluginToolContribution, type AgentPluginStateValue } from '@jini-ai/agent-plugins/lifecycle/tools';
import { createPluginContributionLoader, defineExecutablePluginContribution, type TrustedPluginPackage } from '@jini-ai/agent-plugins/lifecycle';
import { createAdminSurfaceCallbackInbox } from '@jini-ai/agent-plugins/admin-surfaces';
import { createPluginContributionRegistry, pluginToolIdFor } from '@jini-ai/plugins/host';
import { createMemoryCounterStore, createRateLimiter } from '@jini-ai/http-kit/rate-limit';
import {
  createOAuthUrlGuard, createPendingAuthorizationStore, generateOAuthState, invalidPendingAuthorizationState, isCallbackFieldName, isOAuthError,
  MAX_AUTHORIZATION_STATE_LENGTH, MAX_CALLBACK_FIELD_LENGTH, MAX_CALLBACK_FIELDS, oauthFlowOperations, PENDING_AUTHORIZATION_STATE_BYTES,
  secureEqualsForOwnerBinding, startLoopbackAuthorizationReceiver,
} from '@jini-ai/oauth';
import type { Clock, HttpClientPort, HttpResponse } from '@jini-ai/core/primitives';
import type { OAuthFetch, OAuthTokenSet } from '@jini-ai/core/contracts/oauth';

const PLUGIN_ID = 'google-workspace';
const WORKSPACE = 'studio-ws-7';
const ADMIN = 'studio-admin-3';
const SITE = 'https://studio.example.test';
const CALLBACK_PATH = '/studio/linked-accounts/return';
const RETURN_ORIGINS_SETTING = 'STUDIO_LINKED_ACCOUNT_RETURN_ORIGINS';
const WEB_CLIENT_ID = 'studio-web-client-41';
const WEB_CLIENT_SECRET = `fake-secret-${'s'.repeat(24)}`;
const SHEET_ID = 'sheet-one-0001';
const SHEET_BODY = { spreadsheetId: SHEET_ID, properties: { title: 'Leads' }, sheets: [{ properties: { sheetId: 0, title: 'Sheet1' } }] };
const ACCOUNT = { permissionId: 'perm-ada-01', emailAddress: 'ada@studio.example.test', displayName: 'Ada' };

const clock: Clock = { nowMs: () => Date.now() };

/** The host's one binding of the real `@jini-ai/oauth` exports the API-connection entry requires. */
const callbackFieldRules: ApiConnectionCallbackFieldRules = { maxFields: MAX_CALLBACK_FIELDS, maxLength: MAX_CALLBACK_FIELD_LENGTH, acceptsName: isCallbackFieldName };
const oauth: ApiConnectionOAuthCapabilities = {
  flow: oauthFlowOperations, generateState: generateOAuthState, pendingStateBytes: PENDING_AUTHORIZATION_STATE_BYTES,
  invalidPendingState: invalidPendingAuthorizationState, secureEquals: secureEqualsForOwnerBinding, isOAuthError,
  maxAuthorizationStateLength: MAX_AUTHORIZATION_STATE_LENGTH, callbackFieldRules, createPendingAuthorizationStore,
};

const messages: ApiConnectionHostMessages = {
  callbackOriginsEnv: RETURN_ORIGINS_SETTING,
  notConfigured: ({ label, what }) => `Studio: ${label} has no ${what} configured.`,
  missingReturnAddress: ({ label }) => `Studio: ${label} has no registered return address.`,
  unregisteredOrigin: ({ label }) => `Studio: ${label} cannot return to this address.`,
  noPublicOrigin: ({ label }) => `Studio: ${label} needs a public address.`,
};

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * An in-process fake Google: OAuth consent + token endpoint, Drive `about` (the account hook) and
 * Sheets. Its APIs accept only bearers its own token endpoint issued; anything else is a 401.
 */
function fakeGoogle() {
  const issued: string[] = [];
  const tokenForms: URLSearchParams[] = [];
  const apiRequests: { readonly method: string; readonly url: string; readonly authorization: string | undefined }[] = [];
  const state = { refuseExchange: false, issued, tokenForms, apiRequests };
  const codes = new Map<string, { readonly challenge: string | null; readonly clientId: string; readonly redirectUri: string; readonly scope: string }>();

  /** The person consents at Google's authorization URL; Google mints a code bound to that request. */
  function consent(authorizationUrl: string): { readonly code: string; readonly state: string } {
    const url = new URL(authorizationUrl);
    expect(url.origin).toBe('https://accounts.google.com');
    const code = `fake-code-${codes.size + 1}-${'a'.repeat(16)}`;
    codes.set(code, { challenge: url.searchParams.get('code_challenge'), clientId: url.searchParams.get('client_id') ?? '',
      redirectUri: url.searchParams.get('redirect_uri') ?? '', scope: url.searchParams.get('scope') ?? '' });
    return { code, state: url.searchParams.get('state') ?? '' };
  }

  /** `https://oauth2.googleapis.com/token`: the authorization-code exchange, PKCE and client checked. */
  const oauthFetch: OAuthFetch = async ({ url }, init) => {
    const href = url instanceof Request ? url.url : String(url);
    if (href !== 'https://oauth2.googleapis.com/token') throw new Error(`fake Google refused an unexpected OAuth URL: ${href}`);
    const form = new URLSearchParams(String(init?.body ?? ''));
    state.tokenForms.push(form);
    const grant = codes.get(form.get('code') ?? '');
    codes.delete(form.get('code') ?? '');
    const verifier = form.get('code_verifier') ?? '';
    const pkceOk = grant?.challenge === null || grant?.challenge === createHash('sha256').update(verifier).digest('base64url');
    if (state.refuseExchange || !grant || !pkceOk || grant.clientId !== form.get('client_id') || grant.redirectUri !== form.get('redirect_uri')) {
      return json(400, { error: 'invalid_grant' });
    }
    const accessToken = `fake-access-${state.issued.length + 1}-${'c'.repeat(24)}`;
    state.issued.push(accessToken);
    return json(200, { access_token: accessToken, refresh_token: `fake-refresh-${'d'.repeat(24)}`, token_type: 'Bearer', expires_in: 3600, scope: grant.scope });
  };

  /** Drive `about` and Sheets `spreadsheets.get`; only an issued bearer is served. */
  function api(method: string, href: string, headers: Readonly<Record<string, string>>): { readonly status: number; readonly body: unknown } {
    const authorization = Object.entries(headers).find(([name]) => name.toLowerCase() === 'authorization')?.[1];
    state.apiRequests.push({ method, url: href, authorization });
    if (!state.issued.some((token) => authorization === `Bearer ${token}`)) return { status: 401, body: { error: { code: 401, status: 'UNAUTHENTICATED' } } };
    const url = new URL(href);
    if (method === 'GET' && url.origin === 'https://www.googleapis.com' && url.pathname === '/drive/v3/about') return { status: 200, body: { user: ACCOUNT } };
    if (method === 'GET' && url.origin === 'https://sheets.googleapis.com' && url.pathname === `/v4/spreadsheets/${SHEET_ID}`) return { status: 200, body: SHEET_BODY };
    return { status: 404, body: { error: { code: 404, status: 'NOT_FOUND' } } };
  }

  /** The hooks' HTTP (the account read during the finish). */
  const pluginHttp: PluginHttp = {
    async fetch({ url }, options = {}) {
      const answer = api(options.method ?? 'GET', url, options.headers ?? {});
      return json(answer.status, answer.body);
    },
  };
  /** The tools' guarded HTTP client port. */
  const httpClient: HttpClientPort = {
    async send({ request }): Promise<HttpResponse> {
      const answer = api(request.method, request.url, request.headers);
      return { status: answer.status, headers: { 'content-type': 'application/json' }, bodyText: JSON.stringify(answer.body), bodyTruncated: false };
    },
  };
  return { state, consent, oauthFetch, pluginHttp, httpClient };
}

/** This host's own record store: one map per kind, revision compare-and-set. */
function memoryRecords(): ApiConnectionHostRecordStore {
  const rows = new Map<string, ApiConnectionRecord>();
  const attempts = new Map<string, ApiConnectionAttempt>();
  return {
    read: async ({ key }) => rows.get(key) ?? null,
    compareAndSet: async ({ key, expectedRevision, record }) => {
      if ((rows.get(key)?.revision ?? 0) !== expectedRevision) return false;
      rows.set(key, record);
      return true;
    },
    putAttempt: async ({ attempt }) => { attempts.set(attempt.state, attempt); },
    takeAttempt: async ({ state }) => {
      const attempt = attempts.get(state) ?? null;
      attempts.delete(state);
      return attempt;
    },
    peekAttempt: async ({ state }) => attempts.get(state) ?? null,
  };
}

/** This host's own token store: bound to its owner (incl. client id) and fenced on the record's generation. */
function memoryTokenStorage(records: ApiConnectionHostRecordStore) {
  const rows = new Map<string, { readonly tokens: OAuthTokenSet; readonly generation: number }>();
  const liveGeneration = async (key: string): Promise<number> => (await records.read({ key }))?.generation ?? 0;
  return {
    rows,
    tokensFor({ owner }: { owner: { workspaceId: string; pluginId: string; connectionId: string; clientId: string } }): ApiConnectionTokenStore {
      const slot = (key: string): string => JSON.stringify([owner.workspaceId, owner.pluginId, owner.connectionId, owner.clientId, key]);
      return {
        async load({ key }) {
          const row = rows.get(slot(key));
          return row && row.generation === await liveGeneration(key) ? row.tokens : null;
        },
        async persist({ key, tokens }) {
          const row = rows.get(slot(key));
          if (!row) throw new Error('studio token store: nothing to persist over');
          rows.set(slot(key), { ...row, tokens });
        },
        async markNeedsReauth({ key }) { rows.delete(slot(key)); },
        async install({ key, tokens, generation }) {
          if (generation !== await liveGeneration(key)) throw new Error('studio token store: stale generation');
          rows.set(slot(key), { tokens, generation });
        },
        loadForRevocation: async ({ key }) => rows.get(slot(key))?.tokens ?? null,
        async delete({ key }) { rows.delete(slot(key)); },
      };
    },
  };
}

/** This host's plugin settings store (what an admin panel would write); tools get a read-only view. */
function memoryPluginState() {
  const values = new Map<string, AgentPluginStateValue>();
  const id = (scope: { readonly workspaceId: string; readonly pluginId: string }, key: string): string => JSON.stringify([scope.workspaceId, scope.pluginId, key]);
  return {
    set(scope: { readonly workspaceId: string; readonly pluginId: string }, key: string, value: AgentPluginStateValue): void { values.set(id(scope, key), value); },
    readerFor: (scope: { readonly workspaceId: string; readonly pluginId: string }) => ({ get: async ({ key }: { readonly key: string }) => values.get(id(scope, key)) ?? null }),
  };
}

/** The one shipped file whose name ends with `suffix` (contribution file names are host-chosen; no public loader names them). */
async function shippedFileEndingWith(packageRoot: string, suffix: string): Promise<string> {
  const [only, ...others] = (await readdir(packageRoot)).filter((name) => name.endsWith(suffix));
  if (only === undefined || others.length > 0) throw new Error(`expected exactly one *${suffix} in the plugin package`);
  return only;
}

/** The client-setting prefix the shipped declaration was written with, ahead of the plugin's own segment. */
function adoptedClientNamespace(raw: string, pluginSegment: string): string {
  const prefix = new RegExp(`"clientIdEnv"\\s*:\\s*"([A-Z][A-Z0-9_]*?_)${pluginSegment}`).exec(raw)?.[1];
  if (prefix === undefined) throw new Error('the shipped connection names no client setting');
  return prefix;
}

/** Discovers the shipped plugin from its public package export and loads its declarations through Jini's contribution loader. */
async function shippedPlugin() {
  const plugin: TrustedPluginPackage = { pluginId: PLUGIN_ID, packageRoot: path.dirname(createRequire(import.meta.url).resolve(`@jini-ai/agent-plugins/${PLUGIN_ID}`)) };
  const loader = createPluginContributionLoader({
    findPackages: async () => [{ trusted: plugin }],
    readFile: ({ plugin: trusted, filename }) => readFile(path.join(trusted.packageRoot, filename), 'utf8'),
    importModule: async ({ plugin: trusted, modulePath }) => {
      const imported: { readonly default?: unknown } = await import(pathToFileURL(path.join(trusted.packageRoot, modulePath)).href);
      return { exported: imported.default };
    },
  });
  const connectionsFile = await shippedFileEndingWith(plugin.packageRoot, '-connections.json');
  const toolsFile = await shippedFileEndingWith(plugin.packageRoot, '-agent-tools.json');
  // The shipped declaration names its client settings in the namespace of the host it was written
  // for; Jini's parser requires the host to name that namespace. This host adopts whatever prefix
  // precedes the plugin's own `<PLUGIN>_OAUTH_` segment (the encoding `checkApiConnectionClientNamespace` checks).
  const pluginSegment = `${PLUGIN_ID.toUpperCase().replaceAll('.', '__').replaceAll('-', '_')}_OAUTH_`;
  const rawConnections = await readFile(path.join(plugin.packageRoot, connectionsFile), 'utf8');
  const clientNamespace = adoptedClientNamespace(rawConnections, pluginSegment);
  const connectionContribution = defineExecutablePluginContribution<ApiConnectionDeclaration, ApiConnectionHooksModule>({
    filename: connectionsFile, contribution: 'API connections',
    parse: ({ raw }) => parseApiConnectionsFile({ raw, clientNamespace }),
    modulePath: ({ descriptor }) => descriptor.module,
    validate: ({ exported }) => asApiConnectionHooksModule({ exported }),
    refusal: ({ plugin: trusted, descriptor, reason }) => `API connection '${descriptor.id}' from '${trusted.pluginId}' was not loaded: ${reason}`,
  });
  /** The host's declaration loader port, read fresh on every call. */
  async function loadDeclaredConnections(): Promise<{ connections: readonly DeclaredApiConnection[]; refusals: readonly string[] }> {
    const loaded = await loader.loadPluginContributionsFromSource({ plugin, definition: connectionContribution });
    const connections = loaded.items.map((item): DeclaredApiConnection => {
      checkApiConnectionClientNamespace({ pluginId: item.pluginId, clients: item.descriptor.clients, clientNamespace });
      const descriptor = parseApiConnectionDescriptor({ callbackFieldRules, value: { ...item.descriptor.descriptor, pluginId: item.pluginId, connectionId: item.descriptor.id } });
      const { clients, budgets, scopeSets, apiOrigins, byoClient } = item.descriptor;
      return { pluginId: item.pluginId, descriptor, clients, budgets, scopeSets, apiOrigins, byoClient, module: item.module };
    });
    return { connections, refusals: loaded.refusals };
  }
  const loadTools = () => loader.loadPluginContributionsFromSource({ plugin, definition: defineAgentPluginToolContribution({ filename: toolsFile }) });
  return { loadDeclaredConnections, loadTools };
}

async function onlyConnection(listed: Promise<readonly DeclaredApiConnection[]>): Promise<DeclaredApiConnection> {
  const [connection, ...others] = await listed;
  if (connection === undefined || others.length > 0) throw new Error('expected the shipped plugin to declare exactly one connection');
  return connection;
}

/** The whole second host: API-connection host, tool capabilities, tool projection. */
async function studioHost() {
  const google = fakeGoogle();
  const shipped = await shippedPlugin();
  const declared = await shipped.loadDeclaredConnections();
  expect(declared.refusals).toEqual([]);
  const web = declared.connections[0]?.clients.web;
  if (web?.clientSecretEnv === undefined) throw new Error('the shipped connection declares no confidential web client');
  // Host configuration: the client settings the declaration names, and this site as a registered return origin.
  const env = { [web.clientIdEnv]: WEB_CLIENT_ID, [web.clientSecretEnv]: WEB_CLIENT_SECRET, [RETURN_ORIGINS_SETTING]: SITE };
  const records = memoryRecords();
  const tokenStorage = memoryTokenStorage(records);
  const pluginState = memoryPluginState();
  const limiterFor = (profile: { readonly windowSeconds: number; readonly max: number; readonly burst: number }) => createRateLimiter({ profile, clock, store: createMemoryCounterStore({}) });
  const host = createApiConnectionHost({
    workspaceId: WORKSPACE, clock, runtime: 'hosted', env, publicOrigin: () => SITE, callbackPath: CALLBACK_PATH, messages, oauth,
    oauthHttp: { fetchFn: google.oauthFetch, guard: createOAuthUrlGuard({ assertAllowed: () => undefined }) },
    pluginHttp: google.pluginHttp, pluginState, callbackInbox: createAdminSurfaceCallbackInbox({ now: () => clock.nowMs() }),
    startLoopback: startLoopbackAuthorizationReceiver,
    apiConnectionStorage: { records, tokensFor: tokenStorage.tokensFor },
    loadDeclaredConnections: shipped.loadDeclaredConnections,
    createSharedConnections: () => { throw new Error('this host offers no shared connections'); },
    appIdentity: { clientDisplayName: 'Studio', softwareId: 'studio-host' },
    byoCredentials: {
      read: async () => null,
      refuse: ({ label }) => new ApiConnectionError({ code: 'configuration-invalid', message: `Studio: the saved client "${label}" cannot be used.` }),
    },
    createLimiter: ({ profile }) => limiterFor(profile),
  });

  // The REAL capabilities factory over the host's own connection port; nothing else can hand out a token.
  const capabilities = createAgentPluginToolCapabilities({
    connections: host.toolConnections, http: google.httpClient, limiter: limiterFor({ windowSeconds: 60, max: 240, burst: 40 }),
    frozen: createFrozenConnectionAccounts(), state: (scope) => host.pluginState.readerFor(scope), apiOrigins: host.apiOriginsFor,
  });
  const registry = createPluginContributionRegistry({});
  const projection = createAgentPluginToolProjection({ registry, toolIdFor: pluginToolIdFor, capabilities, issuedTokens: createIssuedTokenMemories() });
  const tools = await shipped.loadTools();
  expect(projection.sync({ loaded: tools.items, refusals: tools.refusals }).refusals).toEqual([]);
  const snapshot = registry.list({}).find((candidate) => candidate.pluginId === PLUGIN_ID);
  const sheetsGet = snapshot?.tools.find((tool) => tool.name === 'sheets_get');
  if (snapshot === undefined || sheetsGet === undefined) throw new Error('sheets_get was not projected');
  // The plugin's Sheets product is switched on in its settings (what its admin panel writes).
  pluginState.set({ workspaceId: WORKSPACE, pluginId: PLUGIN_ID }, 'products', { sheets: true });

  const connection = await onlyConnection(host.listConnections({ pluginId: PLUGIN_ID }));
  const { connectionRef } = await host.statusOf({ connection });
  // What the plugin tool contract hands a handler: the snapshot's SDK slot and the caller's auth.
  const callSheetsGet = async (): Promise<unknown> => sheetsGet.handler({
    pluginId: PLUGIN_ID, sdk: snapshot.sdk, auth: { access: 'admin', workspaceId: WORKSPACE, principalId: ADMIN }, input: { connectionRef, spreadsheetId: SHEET_ID },
  });

  /** Hosted sign-in: the host's start and hand-off, consent at Google, then the callback's finish. */
  async function signIn() {
    const handoffs: string[] = [];
    const started = await startApiConnectionSignIn({
      host, connection, actorId: ADMIN, intent: 'connect', scopeSetIds: ['sheets'],
      signInLink: ({ callbackUrl, handoffId }) => { handoffs.push(handoffId); return `${SITE}/studio/link?back=${encodeURIComponent(callbackUrl)}`; },
      messages: { toolError: ({ message }) => message, sharedUnavailable: 'Studio: shared linking is not offered.' },
    });
    expect(started.authorizationUrl.startsWith(`${SITE}/studio/link?`)).toBe(true);
    // The admin's browser opens the host link: the host takes its hand-off (provider URL + browser binding).
    const handoff = host.signInHandoffs.take({ handoffId: handoffs[0] ?? '', actorId: ADMIN });
    if (handoff === null) throw new Error('the sign-in hand-off was not issued');
    const consented = google.consent(handoff.authorizationUrl);
    // Google redirects back to the host's registered callback, which redeems the code.
    const callbackUrl = host.hostedCallbackUrl({ connection });
    expect(callbackUrl).toBe(`${SITE}${CALLBACK_PATH}`);
    const completed = await host.serviceFor({ connection }).complete({
      workspaceId: WORKSPACE, actorId: ADMIN, redirectUri: callbackUrl, callbackParams: { state: consented.state, code: consented.code }, browserBinding: handoff.browserBinding,
    });
    return { consented, completed, callbackUrl };
  }
  return { google, host, connection, connectionRef, callSheetsGet, signIn, tokenStorage };
}

async function rejection(pending: Promise<unknown>): Promise<unknown> {
  return pending.then(() => { throw new Error('expected a refusal'); }, (error: unknown) => error);
}

describe('a second host signs in to Google through the public API-connection host and runs the shipped sheets_get', () => {
  it('sends the bearer issued by that sign-in to fake Sheets and returns its answer; before sign-in and after a refused exchange it refuses without calling Sheets', async () => {
    const studio = await studioHost();
    const { google } = studio;

    // Before any sign-in: the host refuses the token, so the tool refuses and Google sees nothing.
    expect(await studio.host.statusOf({ connection: studio.connection })).toMatchObject({ status: 'disconnected' });
    expect(await rejection(studio.callSheetsGet())).toMatchObject({ code: 'not-connected', nextAction: 'connect' });
    expect(google.state.apiRequests).toEqual([]);
    expect(google.state.tokenForms).toEqual([]);

    // A sign-in whose code exchange Google refuses connects nothing; the tool still refuses.
    google.state.refuseExchange = true;
    const refused = await rejection(studio.signIn());
    expect(refused).toBeInstanceOf(ApiConnectionError);
    expect(refused).toMatchObject({ code: 'authorization-failed' });
    google.state.refuseExchange = false;
    expect(google.state.tokenForms).toHaveLength(1);
    expect(google.state.issued).toEqual([]);
    expect(await studio.host.statusOf({ connection: studio.connection })).toMatchObject({ status: 'disconnected' });
    expect(await rejection(studio.callSheetsGet())).toMatchObject({ code: 'not-connected' });
    expect(google.state.apiRequests).toEqual([]);

    // A real sign-in: the token endpoint receives the authorization code and this host's client.
    const { consented, completed, callbackUrl } = await studio.signIn();
    expect(google.state.tokenForms).toHaveLength(2);
    const exchange = google.state.tokenForms[1];
    expect(exchange?.get('grant_type')).toBe('authorization_code');
    expect(exchange?.get('code')).toBe(consented.code);
    expect(exchange?.get('client_id')).toBe(WEB_CLIENT_ID);
    expect(exchange?.get('client_secret')).toBe(WEB_CLIENT_SECRET);
    expect(exchange?.get('redirect_uri')).toBe(callbackUrl);
    expect(google.state.issued).toHaveLength(1);
    const issued = google.state.issued[0];
    expect(completed).toMatchObject({ connectionRef: studio.connectionRef, outcome: 'connected', account: { accountId: ACCOUNT.permissionId } });
    expect(await studio.host.statusOf({ connection: studio.connection })).toMatchObject({ status: 'connected', connectionRef: studio.connectionRef });
    // The finish read the account with the freshly issued bearer, and that is all Google has seen so far.
    expect(google.state.apiRequests).toEqual([{ method: 'GET', url: expect.stringContaining('https://www.googleapis.com/drive/v3/about'), authorization: `Bearer ${issued}` }]);

    // The shipped tool: one GET to Sheets carrying exactly the bearer that sign-in issued; its answer is Google's body.
    const answer = await studio.callSheetsGet();
    expect(answer).toEqual(SHEET_BODY);
    expect(google.state.apiRequests).toHaveLength(2);
    const sheetsRequest = google.state.apiRequests[1];
    expect(sheetsRequest?.method).toBe('GET');
    expect(new URL(sheetsRequest?.url ?? 'https://invalid.test').origin).toBe('https://sheets.googleapis.com');
    expect(new URL(sheetsRequest?.url ?? 'https://invalid.test').pathname).toBe(`/v4/spreadsheets/${SHEET_ID}`);
    expect(sheetsRequest?.authorization).toBe(`Bearer ${issued}`);
    // The token the tool used never left the host's store in the answer.
    expect(JSON.stringify(answer)).not.toContain(issued);
  });
});
