/**
 * EXTRACT-S5 H3 second host: a host that is not the product the hosted-MCP code came from wires the REAL
 * `@jini-ai/oauth` flow operations, the REAL hosted store and connection gate (`@jini-ai/mcp/federation/hosted`)
 * and the REAL sign-in service (`@jini-ai/integrations/api-connections/hosted-mcp`) by ports, against an
 * in-process fake OAuth server and a Higgsfield-shaped fake provider (one hosted MCP server, device sign-in,
 * one media tool). It signs in, calls the tool, has its refresh denied, gets the terminal do-not-retry error,
 * and reconnects. Its permission, ids, paths and registration identity differ from the first host's, and no
 * provider canary (token, secret, URL, path) reaches model-facing text. No real credentials, no network.
 */
import { describe, expect, it } from 'vitest';
import * as hosted from '@jini-ai/mcp/federation/hosted';
import type { HostedMcpStorePorts } from '@jini-ai/mcp/federation/hosted';
import { createOAuthUrlGuard, defaultOAuthMessages, isOAuthError, OAuthError, oauthFlowOperations, type OAuthFetch } from '@jini-ai/oauth';
import { formatAad } from '@jini-ai/platform/secrets';
import { createDeviceAuthorizationStore, createHostedMcpSignInService, type HostedMcpSignInPorts } from '@jini-ai/integrations/api-connections/hosted-mcp';
import type { VaultErrorCode, VaultKind, VaultMetaParsers, VaultRecord, VaultRepoPort } from '@jini-ai/core/contracts/vault';
import type { OAuthProviderDescriptor } from '@jini-ai/core/contracts/oauth';

const WS = 'studio-ws-41' as never;
const SERVER = 'lumafield-studio';
const TOOL = 'generate_clip';
const IDP = 'https://auth.lumafield.test';
const CANARIES = ['at-CANARY-lf-7', 'sk-CANARY-lf-secret', 'https://canary.invalid/leak?code=9', '/var/lib/lumafield/secret.json'] as const;
const FIRST_HOST_WORDS = ['Tovu', 'tovu', 'Settings → External MCP', 'plugins_set_enabled', '[external-mcp]', 'TOVU_PUBLIC_URL', '/settings/external-mcp'];

class StudioVaultError extends Error { constructor(readonly code: VaultErrorCode) { super(`studio vault: ${code}`); } }
class StudioInputError extends Error { constructor(message: string, readonly field: string) { super(message); } }
class StudioValidationError extends Error { constructor(message: string, readonly field: string) { super(message); } }
/** The host's canonical terminal error: the model is told not to retry and where a person reconnects. */
class StudioRelinkError extends Error {
  readonly code = 'STUDIO_RELINK_REQUIRED';
  readonly retryable = false;
  constructor(readonly serverId: string, label: string | null | undefined) {
    super(`"${label ?? serverId}" needs to be linked again by a studio admin at Studio console › Linked tools. Do not retry this tool.`);
  }
}
class StudioRevokedError extends Error { constructor(readonly reason: string) { super(`Studio: this linked tool is unavailable (${reason}).`); } }

const KINDS: VaultKind[] = ['site-assistant', 'personal-execution', 'media-provider', 'publish-peer', 'database-destination', 'vendor', 'source-control', 'mcp-env', 'mcp-auth', 'api-connection', 'custom'];
const aadOf = (r: { workspaceId: string; kind: string; ownerKey: string; principalId: string | null; binding: string | null; id: string }) =>
  JSON.stringify([r.workspaceId, r.kind, r.ownerKey, r.principalId, r.binding, r.id]);

function vaultRepo(): VaultRepoPort {
  const rows = new Map<string, VaultRecord>();
  const key = (i: { workspaceId: string; id: string }) => `${i.workspaceId}/${i.id}`;
  return {
    find: async (i) => structuredClone(rows.get(key(i)) ?? null),
    list: async () => [...rows.values()],
    put: async ({ record }) => { const saved: VaultRecord = { ...record, isDefault: record.isDefault ?? false }; rows.set(key(record), saved); return structuredClone(saved); },
    patchMeta: async () => { throw new StudioVaultError('conflict'); },
    delete: async (i) => rows.delete(key(i)),
  };
}

/** The host's own store ports: its vault service, credential policy, settings path and reauth code. */
const storePorts: HostedMcpStorePorts = {
  vault: {
    createMemoryRepo: vaultRepo,
    createService: (deps) => ({
      put: async (input) => {
        await deps.authorize({ action: 'put', context: input });
        const meta = deps.metaParsers[input.kind]({ meta: input.meta, provider: input.provider });
        const sealed = await deps.sealer.seal({ plaintext: JSON.stringify(input.payload), key: await deps.keyring.activeKey({}), aad: aadOf(input) });
        const now = deps.now();
        await deps.repo.put({ expectedRevision: input.expectedRevision, record: { workspaceId: input.workspaceId, id: input.id, kind: input.kind, ownerKey: input.ownerKey,
          principalId: input.principalId, binding: input.binding, provider: input.provider, label: input.label, revision: 1, tokenLength: null, last4: null,
          meta, sealed, createdAt: now, updatedAt: now } });
        return input;
      },
      get: async (input) => {
        await deps.authorize({ action: 'get', context: input });
        const record = await deps.repo.find(input);
        if (!record?.sealed) return null;
        return { payload: JSON.parse(await deps.sealer.open({ sealed: record.sealed }, { aad: aadOf(record) })) };
      },
    }),
  },
  vaultErrors: { create: ({ code }) => new StudioVaultError(code) },
  metaParsers: ({ validateMeta }) => Object.fromEntries(KINDS.map((kind) => [kind, ({ meta }: { meta: unknown }) => validateMeta({ kind, meta: meta as never })])) as unknown as VaultMetaParsers,
  assertFreeField: ({ value, field }) => { if (value.startsWith('sk-')) throw new StudioInputError('Studio: keep keys out of plain fields.', field); },
  credential: {
    normalize: ({ value, field = 'token' }) => { if (typeof value !== 'string' || value.trim() === '') throw new StudioInputError('Studio: empty token.', field); return value.trim(); },
    assert: ({ value }) => { if (typeof value !== 'string' || /\s/.test(value)) throw new StudioInputError('Studio: token has spaces.', 'token'); },
    hint: ({ token }) => ({ length: token.length, last4: token.length >= 12 ? token.slice(-4) : null }),
    messages: { env: 'Studio: bad env.', ascii: 'Studio: ascii only.', storage: 'Studio: vault offline.', blank: 'Studio: blank env.', url: 'Studio: bad url.' },
    limit: 4096,
    InputError: StudioInputError,
  },
  settingsLink: 'Studio console › Linked tools',
  reauthRequiredCode: 'STUDIO_RELINK_REQUIRED',
};
/** A toy reversible sealer: the AAD must match on open, exactly like a real one. */
const sealer = {
  seal: async ({ plaintext, aad }: { plaintext: string; aad: string }) => ({ keyId: 'studio-k1', ciphertext: Buffer.from(`${aad}\n${plaintext}`).toString('base64'), nonce: 'bm9uY2U=', alg: 'studio-toy' }),
  open: async ({ sealed }: { sealed: { ciphertext: string } }, optional?: { aad?: string }) => {
    const [aad, ...rest] = Buffer.from(sealed.ciphertext, 'base64').toString().split('\n');
    if (aad !== optional?.aad) throw new Error('studio: aad mismatch');
    return rest.join('\n');
  },
} as never;
const keyring = { activeKey: async () => ({ id: 'studio-k1', bytes: new Uint8Array(32) }), deriveSigningSecret: async () => new Uint8Array(), derive: async () => new Uint8Array() } as never;

const provider: OAuthProviderDescriptor = { providerId: 'lumafield-idp', label: 'Lumafield', supportedGrants: ['device_code'],
  deviceAuthorizationEndpoint: `${IDP}/device`, tokenEndpoint: `${IDP}/token`, defaultScopes: ['clips.create'], usesPkce: false, clientAuth: 'none' };

/** In-process fake OAuth server (device grant + refresh) and Higgsfield-shaped MCP tool. Never touches the network. */
function fakeLumafield() {
  const state = { approved: false, denyRefresh: false, issued: 0, valid: new Set<string>(), requests: [] as string[] };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const issue = () => {
    state.issued += 1;
    const accessToken = `lf-at-${state.issued}`;
    state.valid.clear();
    state.valid.add(accessToken);
    return json(200, { access_token: accessToken, refresh_token: `lf-rt-${state.issued}`, token_type: 'Bearer', expires_in: 600, scope: 'clips.create' });
  };
  const fetchFn: OAuthFetch = async ({ url }, init) => {
    const href = String(url);
    if (!href.startsWith(IDP)) throw new Error('fake server refused a foreign host');
    const form = new URLSearchParams(String(init?.body ?? ''));
    state.requests.push(`${new URL(href).pathname}:${form.get('grant_type') ?? 'device-start'}`);
    if (href.endsWith('/device')) {
      return json(200, { device_code: `lf-dc-${state.requests.length}`, user_code: 'LUMA-4821', verification_uri: `${IDP}/activate`, expires_in: 900, interval: 5 });
    }
    if (form.get('grant_type') === 'urn:ietf:params:oauth:grant-type:device_code') {
      return state.approved ? issue() : json(400, { error: 'authorization_pending' });
    }
    if (form.get('grant_type') === 'refresh_token') {
      if (state.denyRefresh) return json(400, { error: 'invalid_grant', error_description: `refresh denied ${CANARIES.join(' ')}`, error_uri: CANARIES[2] });
      return issue();
    }
    return json(400, { error: 'unsupported_grant_type' });
  };
  /** The provider's one media tool: accepts only a currently valid bearer. */
  const generateClip = (bearer: string, prompt: string) => {
    if (!state.valid.has(bearer)) throw new Error(`401 from ${CANARIES[2]}`);
    return { content: [{ type: 'text', text: `clip queued for "${prompt}"` }] };
  };
  return { state, fetchFn, generateClip };
}

function studioHost() {
  const clock = { now: Date.parse('2031-03-04T05:06:07.000Z'), nowMs() { return this.now; }, nowIso() { return new Date(this.now).toISOString(); } };
  const server = fakeLumafield();
  const repo = new hosted.InMemoryExternalMcpServerRepo(storePorts);
  const logs: string[] = [];
  const ports: HostedMcpSignInPorts = {
    flow: oauthFlowOperations,
    errors: {
      oauth: (input) => new OAuthError(input),
      isOAuthError: (error): error is OAuthError => isOAuthError({ value: error }),
      validation: (message, field) => new StudioValidationError(message, field),
      isUnconfigured: (error) => error instanceof hosted.ExternalMcpSecretStoreUnconfiguredError,
      reauthRequired: ({ serverId, label }) => new StudioRelinkError(serverId, label),
    },
    store: {
      openPayload: (open, record) => hosted.openExternalMcpOAuthPayload({ sealer: open, ...storePorts }, record),
      sealPayload: (deps, identity, payload) => hosted.sealExternalMcpOAuthPayload({ ...deps, ...storePorts }, identity, payload),
    },
    projections: { authMode: hosted.resolveExternalMcpAuthMode, oauthStatus: hosted.resolveExternalMcpOAuthStatus },
    aad: { format: formatAad },
    signInLink: ({ serverId, callbackUrl }) => `/studio/link/${encodeURIComponent(serverId)}?back=${encodeURIComponent(callbackUrl)}`,
    registrationIdentity: { softwareId: 'studio-agent', clientName: (record) => `Studio ${record.label ?? record.serverId}`, sharedClientName: 'Studio' },
    oauthMessages: defaultOAuthMessages,
    discoveryPolicy: () => { throw new Error('this host configures its provider explicitly; no discovery expected'); },
    withCopy: async ({ call }) => call(),
    copy: {
      actions: { noProvider: 'Pick a provider in Studio console › Linked tools.', noClientId: 'Add a client id in Studio console › Linked tools.',
        chooseGrant: 'Choose a sign-in method in Studio console › Linked tools.', noRegistration: 'Add a client id in Studio console › Linked tools.',
        restartDevice: 'Start linking again from Studio console › Linked tools.', restartShared: 'Start linking again.' },
      noSupportedGrant: ({ serverId }) => `Studio cannot sign in to ${serverId} with any offered method.`,
      noPublicOrigin: ({ serverId }) => `Studio has no public address for ${serverId}; set STUDIO_ORIGIN.`,
      sharedLocalOnly: 'Studio: shared linking is not offered here.', sharedUnavailable: 'Studio: shared link unavailable.', sharedOwnerOnly: 'Studio: owner only.',
    },
    log: { postConnectFailed: ({ serverId }) => { logs.push(`post-connect ${serverId}`); } },
  };
  const connected: string[] = [];
  const service = createHostedMcpSignInService({ workspaceId: WS, repo, sealer, keyring, clock, devices: createDeviceAuthorizationStore(),
    httpPorts: { fetchFn: server.fetchFn, guard: createOAuthUrlGuard({ assertAllowed: () => undefined }) },
    lookupProvider: () => provider, ports, onConnected: async (serverId) => { connected.push(serverId); } });
  const gate = hosted.createHostedMcpConnectionGate({ workspaceId: WS, repo, isPluginEnabled: async (pluginId) => pluginId === 'studio.media.lumafield',
    reauthRequired: ports.errors.reauthRequired,
    revoked: ({ reason }) => new StudioRevokedError(reason),
    recovery: { accessHint: ({ pluginId }) => `Ask a studio admin to approve ${pluginId} in Studio console › Linked tools.`, pluginOff: ({ pluginId }) => `Studio: ${pluginId} is switched off.` },
    logUnreadableRow: ({ connectionId }) => { logs.push(`unreadable ${connectionId}`); } });
  /** What the host recorded when it admitted the tool (its roster row's admission revision at that moment). */
  const admitted = { revision: '' };
  const admit = async () => { admitted.revision = hosted.externalMcpAdmissionRevision((await repo.findByServerId({ workspaceId: WS, serverId: SERVER }))!); };
  /** One model-facing tool call: gate, token, provider tool. */
  const callTool = async (prompt: string) => {
    await gate(SERVER, { remoteName: TOOL, declaredAnnotations: undefined, origin: { kind: 'roster', admissionRevision: admitted.revision }, requiresWriteGrant: false } as unknown as Parameters<typeof gate>[1]);
    const bearer = await service.tokenResolver.resolveAccessToken({ serverId: SERVER });
    return server.generateClip(bearer, prompt);
  };
  return { clock, server, repo, service, gate, admit, callTool, connected, logs };
}

async function signIn(host: ReturnType<typeof studioHost>) {
  const started = await host.service.beginConnect({ serverId: SERVER });
  expect(started.kind).toBe('device_code');
  expect(await host.service.pollDeviceAuthorization({ serverId: SERVER })).toMatchObject({ status: 'pending' });
  host.server.state.approved = true;
  expect(await host.service.pollDeviceAuthorization({ serverId: SERVER })).toEqual({ status: 'connected' });
  host.server.state.approved = false;
  return started;
}

async function rejection(pending: Promise<unknown>): Promise<Error> {
  return pending.then(() => { throw new Error('expected a refusal'); }, (error: unknown) => error as Error);
}

function modelSafe(text: string): void {
  for (const canary of CANARIES) expect(text).not.toContain(canary);
  for (const word of FIRST_HOST_WORDS) expect(text).not.toContain(word);
  expect(text).not.toContain('refresh denied');
}

describe('a second host signs in to a Higgsfield-shaped hosted MCP provider through public entries only', () => {
  it('signs in, calls the tool, gets a terminal do-not-retry error when refresh is denied, and reconnects', async () => {
    const host = studioHost();
    await hosted.saveExternalMcpServer({ repo: host.repo, sealer, keyring, clock: host.clock, ...storePorts } as never, {
      workspaceId: WS, serverId: SERVER, label: 'Lumafield Studio', transport: 'streamable_http', authMode: 'oauth', enabled: true, command: '',
      url: 'https://mcp.lumafield.test/mcp', args: '', allowedToolNames: TOOL, writeAllowedToolNames: '', principalId: 'studio-admin-3',
      provisionedByPluginId: 'studio.media.lumafield',
      oauth: { providerId: 'lumafield-idp', grant: 'device_code', clientId: 'lumafield-public' },
    } as never);
    const row = await host.repo.findByServerId({ workspaceId: WS, serverId: SERVER });
    if (row?.provisionedByPluginId !== 'studio.media.lumafield') await host.repo.upsert({ ...row!, provisionedByPluginId: 'studio.media.lumafield' });
    await host.admit();

    // Sign in (device grant against the fake server); the tool call carries the issued bearer.
    const started = await signIn(host);
    modelSafe(JSON.stringify(started));
    expect(host.connected).toEqual([SERVER]);
    expect(await host.callTool('a fox at dawn')).toEqual({ content: [{ type: 'text', text: 'clip queued for "a fox at dawn"' }] });
    const saved = await host.repo.findByServerId({ workspaceId: WS, serverId: SERVER });
    expect(saved?.oauthStatus).toBe('connected');
    expect(JSON.stringify(saved)).not.toContain('lf-at-1');

    // Expire the token and deny the refresh: the refusal is the host's terminal error, with no provider text.
    host.clock.now += 3_600_000;
    host.server.state.denyRefresh = true;
    const denied = await rejection(host.callTool('a fox at dusk'));
    expect(denied).toBeInstanceOf(StudioRelinkError);
    expect(denied).toMatchObject({ code: 'STUDIO_RELINK_REQUIRED', retryable: false, serverId: SERVER });
    expect(denied.message).toContain('Do not retry this tool.');
    modelSafe(denied.message);
    expect((await host.repo.findByServerId({ workspaceId: WS, serverId: SERVER }))?.oauthStatus).toBe('needs_reauth');

    // The next call is refused by the gate's row read alone: no token endpoint request is made.
    const before = host.server.state.requests.length;
    const again = await rejection(host.callTool('a fox at night'));
    expect(again).toBeInstanceOf(StudioRelinkError);
    modelSafe(again.message);
    expect(host.server.state.requests.length).toBe(before);

    // Reconnect: a fresh sign-in restores the tool with a new bearer.
    host.server.state.denyRefresh = false;
    await signIn(host);
    expect(host.connected).toEqual([SERVER, SERVER]);
    expect((await host.callTool('a fox, again')).content[0]!.text).toBe('clip queued for "a fox, again"');
    expect(host.server.state.valid.has('lf-at-2')).toBe(true);
    expect(host.logs).toEqual([]);
  });

  it('the gate refuses with the host vocabulary when the provisioning plugin is off; provider text never surfaces', async () => {
    const host = studioHost();
    await hosted.saveExternalMcpServer({ repo: host.repo, sealer, keyring, clock: host.clock, ...storePorts } as never, {
      workspaceId: WS, serverId: SERVER, label: 'Lumafield Studio', transport: 'streamable_http', authMode: 'oauth', enabled: true, command: '',
      url: 'https://mcp.lumafield.test/mcp', args: '', allowedToolNames: TOOL, writeAllowedToolNames: '', principalId: 'studio-admin-3',
      oauth: { providerId: 'lumafield-idp', grant: 'device_code', clientId: 'lumafield-public' },
    } as never);
    const row = await host.repo.findByServerId({ workspaceId: WS, serverId: SERVER });
    await host.repo.upsert({ ...row!, provisionedByPluginId: 'studio.media.other' });
    const off = await rejection(host.gate(SERVER, { remoteName: TOOL, declaredAnnotations: undefined, origin: { kind: 'roster' } } as never));
    expect(off.message).toBe('Studio: studio.media.other is switched off.');
    modelSafe(off.message);
  });
});
