import { describe, expect, it, vi } from 'vitest';

import {
  COMPOSIO_AUTH_CONFIG_PREPARE_LIMIT,
  ComposioConnectorProvider,
  ComposioConnectorService,
  CONNECTOR_MAX_OUTPUT_BYTES,
  CONNECTOR_RUN_RATE_LIMIT_CALLS,
  ConnectorServiceError,
  ConnectorStatusService,
  defineConnectorTool,
  getStaticComposioCatalogDefinitions,
  InMemoryConnectorCredentialStore,
  protectConnectorOutput,
  type ComposioConfigStore,
  type ComposioCredentialMaterial,
  type ConnectorCatalogDefinition,
  type ConnectorExecuteRequest,
  type ConnectorExecutionContext,
  type JsonObject,
} from '../../src/index.js';

function createConfigStore(): ComposioConfigStore {
  return {
    read: () => ({ apiKey: 'project-key', authConfigIds: {} }),
    readPublic: () => ({ configured: true, apiKeyTail: '-key' }),
    write: () => ({ configured: true, apiKeyTail: '-key' }),
    setAuthConfigId: () => undefined,
    deleteAuthConfigId: () => undefined,
  };
}

function createCredential(connectorId: string, toolkitSlug: string): ComposioCredentialMaterial {
  return {
    provider: 'composio',
    providerConnectionId: 'ca_1',
    userId: 'user_1',
    connectorId,
    toolkitSlug,
    authConfigId: 'auth_1',
    validatedAt: '2026-07-23T00:00:00.000Z',
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function bodyFrom(init: RequestInit | undefined): Record<string, unknown> | undefined {
  return typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : undefined;
}

function createCurrentToolItems(
  featuredCatalog: readonly ConnectorCatalogDefinition[],
  connectorId: string,
  toolkitSlug: string,
): unknown[] {
  const definition = featuredCatalog.find((candidate) => candidate.id === connectorId);
  return definition?.tools.map((tool) => ({
    slug: tool.providerToolId ?? tool.name,
    name: tool.title,
    ...(tool.description === undefined ? {} : { description: tool.description }),
    scopes: [...tool.requiredScopes],
    toolkit: { slug: toolkitSlug },
    input_parameters: tool.inputSchemaJson,
  })) ?? [];
}

function createService(options: {
  response?: unknown;
  featuredCatalog?: readonly ConnectorCatalogDefinition[];
  connectorId?: string;
  toolkitSlug?: string;
  preconnected?: boolean;
  immediateConnect?: boolean;
  toolDiscoveryStatus?: number;
  toolDiscoveryItems?: unknown[];
  credentialUserId?: string;
  credentialConnectorId?: string;
  now?: () => number;
} = {}): {
  service: ComposioConnectorService;
  provider: ComposioConnectorProvider;
  fetchFn: ReturnType<typeof vi.fn>;
  executeRequests: ReturnType<typeof vi.fn>;
  oauthState: () => string;
} {
  const connectorId = options.connectorId ?? 'github';
  const toolkitSlug = options.toolkitSlug ?? 'GITHUB';
  const featuredCatalog = options.featuredCatalog ?? getStaticComposioCatalogDefinitions();
  const executeRequests = vi.fn();
  let oauthState = '';
  const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === '/api/v3.1/auth_configs') {
      return jsonResponse({ items: [{ id: 'auth_1', status: 'ENABLED', toolkit: { slug: toolkitSlug } }] });
    }
    if (url.pathname === '/api/v3.1/toolkits') return jsonResponse({ items: [] });
    if (url.pathname === '/api/v3.1/tools') {
      return options.toolDiscoveryStatus === undefined
        ? jsonResponse({
          items: options.toolDiscoveryItems
            ?? createCurrentToolItems(featuredCatalog, connectorId, toolkitSlug),
        })
        : jsonResponse({ message: 'tool discovery unavailable' }, options.toolDiscoveryStatus);
    }
    if (url.pathname === '/api/v3/connected_accounts/link') {
      oauthState = new URL(String(bodyFrom(init)?.callback_url)).searchParams.get('state') ?? '';
      return jsonResponse({
        connected_account_id: 'ca_1',
        ...(options.immediateConnect
          ? { status: 'ACTIVE' }
          : { redirect_url: 'https://connect.example/link' }),
      }, 201);
    }
    if (url.pathname === '/api/v3/connected_accounts/ca_1' && init?.method === 'GET') {
      return jsonResponse({
        id: 'ca_1',
        status: 'ACTIVE',
        user_id: 'user_1',
        auth_config: { id: 'auth_1' },
        toolkit: { slug: toolkitSlug },
      });
    }
    if (url.pathname.startsWith('/api/v3.1/tools/execute/')) {
      executeRequests(url.pathname, init);
      return jsonResponse(options.response ?? {
        successful: true,
        data: {
          count: 1,
          nested: {
            access_token: 'must-not-escape',
            api_key: 'must-not-escape',
            apiKey: 'must-not-escape',
          },
        },
      });
    }
    if (url.pathname === '/api/v3/connected_accounts/ca_1' && init?.method === 'DELETE') {
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected request: ${init?.method} ${url.pathname}`);
  });
  const provider = new ComposioConnectorProvider({
    userId: 'user_1',
    configStore: createConfigStore(),
    fetchFn: fetchFn as unknown as typeof fetch,
    featuredCatalog,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const credentialStore = new InMemoryConnectorCredentialStore();
  if (options.preconnected !== false) {
    credentialStore.set({
      schemaVersion: 1,
      connectorId,
      accountLabel: 'octocat',
      credentials: {
        ...createCredential(connectorId, toolkitSlug),
        ...(options.credentialUserId === undefined ? {} : { userId: options.credentialUserId }),
        ...(options.credentialConnectorId === undefined ? {} : { connectorId: options.credentialConnectorId }),
      },
      updatedAt: '2026-07-23T00:00:00.000Z',
    });
  }
  const statusService = new ConnectorStatusService({
    credentialStore,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  return {
    service: new ComposioConnectorService({
      provider,
      statusService,
      ...(options.now === undefined ? {} : { now: options.now }),
    }),
    provider,
    fetchFn,
    executeRequests,
    oauthState: () => oauthState,
  };
}

function createReadDefinition(inputSchemaJson: JsonObject): ConnectorCatalogDefinition {
  const tool = defineConnectorTool({
    name: 'example.list_items',
    providerToolId: 'EXAMPLE_LIST_ITEMS',
    title: 'List items',
    description: 'List and inspect items without modifying them.',
    inputSchemaJson,
    requiredScopes: ['read'],
  });
  return {
    id: 'example',
    name: 'Example',
    provider: 'composio',
    category: 'Test',
    authentication: 'composio',
    providerConnectorId: 'EXAMPLE',
    tools: [tool],
    allowedToolNames: [tool.name],
    minimumApproval: 'auto',
  };
}

describe('ComposioConnectorService', () => {
  it('executes validated read tools, redacts API-key variants, and canonicalizes run limits', async () => {
    const { service, executeRequests } = createService();
    const request = {
      connectorId: 'github',
      toolName: 'github.github_search_repositories',
      input: { query: 'jini' },
      expectedAccountLabel: 'octocat',
    } as const;

    const first = await service.execute(request, { scopeId: 'WORKSPACE_1', sessionId: ' session_1 ' });
    expect(first.output).toMatchObject({
      data: {
        nested: {
          access_token: '[redacted]',
          api_key: '[redacted]',
          apiKey: '[redacted]',
        },
      },
    });
    expect(first.metadata).toMatchObject({ redacted: true, sessionId: ' session_1 ' });
    expect(first.outputSummary).toBe('github.github_search_repositories: 1 result');

    for (let index = 1; index < CONNECTOR_RUN_RATE_LIMIT_CALLS; index += 1) {
      await service.execute(request, {
        scopeId: index % 2 === 0 ? 'workspace_1' : ' WORKSPACE_1 ',
        sessionId: index % 2 === 0 ? 'SESSION_1' : ' session_1 ',
      });
    }
    await expect(service.execute(request, {
      scopeId: 'workspace_1',
      sessionId: 'session_1',
    })).rejects.toMatchObject({
      code: 'CONNECTOR_RATE_LIMITED',
      status: 429,
    });
    expect(executeRequests).toHaveBeenCalledTimes(CONNECTOR_RUN_RATE_LIMIT_CALLS);
  });

  it('rejects direct Composio credential injection and denies write tools before execution', async () => {
    const writeTool = defineConnectorTool({
      name: 'example.create_item',
      providerToolId: 'EXAMPLE_CREATE_ITEM',
      title: 'Create item',
      inputSchemaJson: { type: 'object', additionalProperties: true },
      requiredScopes: ['write'],
    });
    const definition: ConnectorCatalogDefinition = {
      id: 'example',
      name: 'Example',
      provider: 'composio',
      category: 'Test',
      authentication: 'composio',
      providerConnectorId: 'EXAMPLE',
      tools: [writeTool],
      allowedToolNames: [writeTool.name],
      minimumApproval: 'confirm',
    };
    const { service, executeRequests } = createService({
      featuredCatalog: [definition],
      connectorId: 'example',
      toolkitSlug: 'EXAMPLE',
    });

    await expect(service.connect('example', {
      credentials: createCredential('example', 'EXAMPLE'),
    })).rejects.toMatchObject({ status: 400 });
    await expect(service.execute({
      connectorId: 'example',
      toolName: writeTool.name,
      input: {},
    }, {
      scopeId: 'workspace_1',
      sessionId: 'session_1',
    })).rejects.toMatchObject({
      code: 'CONNECTOR_SAFETY_DENIED',
      status: 403,
    });
    expect(executeRequests).not.toHaveBeenCalled();
  });

  it('fails closed on enum violations and unsupported schema keywords before execution', async () => {
    const enumDefinition = createReadDefinition({
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['safe'] },
      },
      required: ['mode'],
      additionalProperties: false,
    });
    const enumHarness = createService({
      featuredCatalog: [enumDefinition],
      connectorId: 'example',
      toolkitSlug: 'EXAMPLE',
    });
    await expect(enumHarness.service.execute({
      connectorId: 'example',
      toolName: 'example.list_items',
      input: { mode: 'unsafe' },
    }, {
      scopeId: 'workspace_1',
      sessionId: 'session_1',
    })).rejects.toMatchObject({ code: 'CONNECTOR_INPUT_SCHEMA_MISMATCH', status: 400 });
    expect(enumHarness.executeRequests).not.toHaveBeenCalled();

    const unsupportedDefinition = createReadDefinition({
      type: 'object',
      properties: { query: { type: 'string', pattern: '^safe$' } },
      required: ['query'],
    });
    expect(unsupportedDefinition.tools[0]).toMatchObject({
      refreshEligible: false,
      inputSchemaUnsupportedReason: expect.stringContaining('unsupported'),
    });
    const unsupportedHarness = createService({
      featuredCatalog: [unsupportedDefinition],
      connectorId: 'example',
      toolkitSlug: 'EXAMPLE',
    });
    await expect(unsupportedHarness.service.execute({
      connectorId: 'example',
      toolName: 'example.list_items',
      input: { query: 'safe' },
    }, {
      scopeId: 'workspace_1',
      sessionId: 'session_1',
    })).rejects.toMatchObject({ code: 'CONNECTOR_INPUT_SCHEMA_MISMATCH', status: 400 });
    expect(unsupportedHarness.executeRequests).not.toHaveBeenCalled();
  });

  it.each([
    ['cyclic', () => {
      const cyclic: Record<string, unknown> = { query: 'jini' };
      cyclic.self = cyclic;
      return cyclic;
    }],
    ['oversized collection', () => ({
      query: 'jini',
      rows: Array.from({ length: 10_001 }, () => 1),
    })],
    ['oversized string', () => ({
      query: 'x'.repeat(1024 * 1024 + 1),
    })],
    ['oversized serialized body', () => ({
      first: 'x'.repeat(600_000),
      second: 'x'.repeat(600_000),
    })],
    ['null root', () => null],
    ['array root', () => []],
  ] as const)('rejects %s execute input before provider account or tool requests', async (_label, createInput) => {
    const definition = createReadDefinition({
      type: 'object',
      additionalProperties: true,
    });
    const harness = createService({
      featuredCatalog: [definition],
      connectorId: 'example',
      toolkitSlug: 'EXAMPLE',
    });

    await expect(harness.service.execute({
      connectorId: 'example',
      toolName: 'example.list_items',
      input: createInput() as never,
    }, {
      scopeId: 'workspace_1',
      sessionId: 'session_1',
    })).rejects.toMatchObject({
      code: 'CONNECTOR_INPUT_SCHEMA_MISMATCH',
      status: 400,
    });
    expect(harness.executeRequests).not.toHaveBeenCalled();
    expect(harness.fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    ['connectorId', {
      connectorId: `connector_${'x'.repeat(257)}`,
      toolName: 'example.list_items',
    }],
    ['toolName', {
      connectorId: 'example',
      toolName: `example.${'x'.repeat(257)}`,
    }],
  ] as const)('rejects an oversized %s before provider discovery', async (_field, identifiers) => {
    const harness = createService({
      featuredCatalog: [createReadDefinition({ type: 'object', additionalProperties: true })],
      connectorId: 'example',
      toolkitSlug: 'EXAMPLE',
    });

    await expect(harness.service.execute({
      ...identifiers,
      input: {},
    }, {
      scopeId: 'workspace_1',
      sessionId: 'session_1',
    })).rejects.toMatchObject({
      code: 'CONNECTOR_INPUT_SCHEMA_MISMATCH',
      status: 400,
    });
    expect(harness.fetchFn).not.toHaveBeenCalled();
  });

  it('fails execution closed when current per-connector tool hydration fails', async () => {
    const definition = createReadDefinition({
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false,
    });
    const harness = createService({
      featuredCatalog: [definition],
      connectorId: 'example',
      toolkitSlug: 'EXAMPLE',
      toolDiscoveryStatus: 500,
    });

    await expect(harness.service.execute({
      connectorId: 'example',
      toolName: 'example.list_items',
      input: { query: 'jini' },
    }, {
      scopeId: 'workspace_1',
      sessionId: 'session_1',
    })).rejects.toMatchObject({
      code: 'CONNECTOR_EXECUTION_FAILED',
      status: 502,
    });
    expect(harness.executeRequests).not.toHaveBeenCalled();
  });

  it('denies a curated static tool omitted by a successful current tool response', async () => {
    const definition = createReadDefinition({
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false,
    });
    const harness = createService({
      featuredCatalog: [definition],
      connectorId: 'example',
      toolkitSlug: 'EXAMPLE',
      toolDiscoveryItems: [{
        slug: 'EXAMPLE_LIST_OTHER_ITEMS',
        name: 'List other items',
        description: 'Read a different collection.',
        scopes: ['read'],
        toolkit: { slug: 'EXAMPLE' },
        input_parameters: { type: 'object', additionalProperties: false },
      }],
    });

    await expect(harness.service.execute({
      connectorId: 'example',
      toolName: 'example.list_items',
      input: { query: 'jini' },
    }, {
      scopeId: 'workspace_1',
      sessionId: 'session_1',
    })).rejects.toMatchObject({
      code: 'CONNECTOR_TOOL_NOT_FOUND',
      status: 404,
    });
    expect(harness.executeRequests).not.toHaveBeenCalled();
  });

  it.each([
    ['another user', { credentialUserId: 'user_other' }],
    ['another connector', { credentialConnectorId: 'slack' }],
  ] as const)('does not expose a credential or account label for %s', (_label, options) => {
    const { service } = createService(options);

    expect(service.listConnectorStatuses().github).toEqual({ status: 'available' });
  });

  it('independently refuses a provider connected result without credential evidence', async () => {
    const { service, provider } = createService({ preconnected: false });
    vi.spyOn(provider, 'connect').mockResolvedValue({
      kind: 'connected',
      expiresAt: '2026-07-24T01:00:00.000Z',
    });

    await expect(service.connect('github', {
      callbackUrl: 'https://host.example/callback',
    })).rejects.toMatchObject({
      name: 'ConnectorServiceError',
      code: 'CONNECTOR_EXECUTION_FAILED',
      status: 502,
    });
    expect(service.listConnectorStatuses().github).toEqual({ status: 'available' });
  });

  it('rejects aggregate catalog hydration before issuing provider requests', async () => {
    const { service, fetchFn } = createService();

    await expect(service.listHydratedDefinitions()).rejects.toMatchObject({
      name: 'ConnectorServiceError',
      code: 'CONNECTOR_EXECUTION_FAILED',
      status: 400,
    });
    await expect(service.listConnectorDiscovery({ hydrateTools: true })).rejects.toMatchObject({
      name: 'ConnectorServiceError',
      code: 'CONNECTOR_EXECUTION_FAILED',
      status: 400,
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects account drift, invalid inputs, oversized outputs, and oversized auth batches', async () => {
    const { service } = createService({
      response: {
        successful: true,
        data: { text: 'x'.repeat(CONNECTOR_MAX_OUTPUT_BYTES + 1) },
      },
    });
    const base = {
      connectorId: 'github',
      toolName: 'github.github_search_repositories',
    };
    const context = { scopeId: 'workspace_1', sessionId: 'session_1' };

    for (const malformed of [
      { ...base, connectorId: 1, input: { query: 'jini' } },
      { ...base, toolName: 1, input: { query: 'jini' } },
    ]) {
      await expect(service.execute(
        malformed as unknown as ConnectorExecuteRequest,
        context,
      )).rejects.toMatchObject({
        code: 'CONNECTOR_INPUT_SCHEMA_MISMATCH',
        status: 400,
      });
    }

    await expect(service.execute({
      ...base,
      input: { query: 'jini' },
      expectedAccountLabel: 'different-account',
    }, context)).rejects.toMatchObject({ code: 'CONNECTOR_NOT_CONNECTED', status: 409 });
    await expect(service.execute({
      ...base,
      input: {},
    }, context)).rejects.toMatchObject({ code: 'CONNECTOR_INPUT_SCHEMA_MISMATCH', status: 400 });
    await expect(service.execute({
      ...base,
      input: { query: 'jini' },
    }, context)).rejects.toMatchObject({ code: 'CONNECTOR_OUTPUT_TOO_LARGE', status: 502 });

    const connectorIds = Array.from(
      { length: COMPOSIO_AUTH_CONFIG_PREPARE_LIMIT + 1 },
      (_, index) => `connector_${index}`,
    );
    await expect(service.prepareAuthConfigs(connectorIds)).rejects.toMatchObject({
      code: 'CONNECTOR_RATE_LIMITED',
      status: 413,
    });
  });

  it('redacts nested secret-like keys without mutating input', () => {
    const input = {
      ok: true,
      headers: { authorization: 'Bearer secret' },
      rows: [{
        passwordHash: 'secret',
        api_key: 'secret',
        apiKey: 'secret',
        privateKey: 'secret',
        title: 'safe',
      }],
    };
    const result = protectConnectorOutput(input);

    expect(result).toMatchObject({
      redacted: true,
      output: {
        ok: true,
        headers: '[redacted]',
        rows: [{
          passwordHash: '[redacted]',
          api_key: '[redacted]',
          apiKey: '[redacted]',
          privateKey: '[redacted]',
          title: 'safe',
        }],
      },
    });
    expect(input.headers.authorization).toBe('Bearer secret');
  });

  it('preserves typed connector errors', () => {
    const error = new ConnectorServiceError('CONNECTOR_NOT_FOUND', 'missing', 404);
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      name: 'ConnectorServiceError',
      code: 'CONNECTOR_NOT_FOUND',
      status: 404,
    });
  });

  it('covers status-store transitions without treating unvalidated records as effects authority', () => {
    const credentials = new InMemoryConnectorCredentialStore();
    const status = new ConnectorStatusService({
      credentialStore: credentials,
      now: () => 0,
      initialStatuses: {
        initial: { status: 'error', accountLabel: 'initial-account', lastError: 'initial-error' },
      },
    });
    const readTool = defineConnectorTool({
      name: 'local.list',
      title: 'List',
      inputSchemaJson: { type: 'object' },
      requiredScopes: [],
    });
    const local: ConnectorCatalogDefinition = {
      id: 'local',
      name: 'Local',
      provider: 'local',
      category: 'Test',
      authentication: 'local',
      tools: [readTool],
      allowedToolNames: [readTool.name],
    };
    const remote = { ...local, id: 'remote', authentication: 'oauth' as const };
    const disabled = { ...remote, id: 'disabled', disabled: true };

    expect(status.getStatus(local)).toEqual({ status: 'connected', accountLabel: 'Local' });
    expect(status.getStatus(remote)).toEqual({ status: 'available' });
    expect(status.getStatus(disabled)).toEqual({ status: 'disabled' });
    expect(status.listStatuses().initial).toEqual({
      status: 'error',
      accountLabel: 'initial-account',
      lastError: 'initial-error',
    });
    expect(status.connect(disabled)).toEqual({ status: 'disabled' });
    expect(status.disconnect(disabled)).toEqual({ status: 'disabled' });
    expect(status.setError(disabled, 'ignored')).toEqual({ status: 'disabled' });
    expect(status.connect(remote)).toEqual({ status: 'connected', accountLabel: 'Local' });
    status.clear('remote');
    expect(status.connect(remote, 'account')).toEqual({ status: 'connected', accountLabel: 'account' });
    expect(status.listStatuses()).toMatchObject({ remote: { status: 'connected' } });
    expect(status.setError(remote, 'failed', 'account')).toMatchObject({ status: 'error', lastError: 'failed' });
    expect(status.markAuthenticationExpired(remote, 'expired')).toMatchObject({ status: 'error' });
    expect(status.disconnect(remote)).toEqual({ status: 'available' });
    expect(status.disconnect(local)).toEqual({ status: 'connected', accountLabel: 'Local' });
    status.clear('remote');
    status.setCredentialStore(new InMemoryConnectorCredentialStore());
    status.connect(remote, 'account', { provider: 'composio' });
    status.deleteCredentialsByProvider('composio');
    expect(status.getStatus(remote)).toEqual({ status: 'available' });
  });

  it('exposes catalog/status facades and performs a validated OAuth lifecycle', async () => {
    const { service, oauthState } = createService({ preconnected: false });

    expect((await service.listDefinitions()).length).toBeGreaterThan(100);
    expect(service.listFastDefinitions().length).toBeGreaterThan(100);
    expect(service.getFastDefinition('github')?.id).toBe('github');
    expect((await service.getDefinition('github'))?.id).toBe('github');
    expect((await service.getHydratedDefinition('github'))?.id).toBe('github');
    expect((await service.getPreviewDefinition('github', { toolsLimit: 1 }))?.id).toBe('github');
    expect((await service.listConnectors()).length).toBeGreaterThan(100);
    expect(service.listConnectorStatuses().github).toMatchObject({ status: 'available' });
    expect((await service.listConnectorDiscovery()).meta).toEqual({ provider: 'composio' });
    expect((await service.listConnectorDiscovery({ refresh: true })).meta).toEqual({
      provider: 'composio',
      refreshRequested: true,
    });
    expect((await service.getConnector('github')).id).toBe('github');
    expect((await service.getHydratedConnector('github')).id).toBe('github');
    expect((await service.getPreviewConnector('github', { toolsLimit: 1 })).id).toBe('github');
    await expect(service.getConnector('missing')).rejects.toMatchObject({ code: 'CONNECTOR_NOT_FOUND' });
    await expect(service.getHydratedConnector('missing')).rejects.toMatchObject({ code: 'CONNECTOR_NOT_FOUND' });
    await expect(service.getPreviewConnector('missing', { toolsLimit: 1 })).rejects.toMatchObject({ code: 'CONNECTOR_NOT_FOUND' });
    await expect(service.connect('missing', {
      callbackUrl: 'https://host.example/callback',
    })).rejects.toMatchObject({ code: 'CONNECTOR_NOT_FOUND' });
    await expect(service.execute({
      connectorId: 'missing',
      toolName: 'missing.list',
      input: {},
    }, {
      scopeId: 'workspace_1',
      sessionId: 'session_1',
    })).rejects.toMatchObject({ code: 'CONNECTOR_NOT_FOUND' });

    const prepared = await service.prepareAuthConfigs(['github', 'missing', ' github ']);
    expect(prepared.results.github).toMatchObject({ status: 'ready', authConfigId: 'auth_1' });
    expect(prepared.results.missing).toMatchObject({ status: 'error' });

    await expect(service.connect('github')).rejects.toMatchObject({ status: 400 });
    const started = await service.connect('github', { callbackUrl: 'https://host.example/callback' });
    expect(started.auth).toMatchObject({
      kind: 'redirect_required',
      redirectUrl: 'https://connect.example/link',
      providerConnectionId: 'ca_1',
    });
    expect(oauthState()).not.toBe('');
    expect((await service.cancelPendingAuthorization('github')).id).toBe('github');
    await expect(service.completeComposioConnection({
      connectorId: 'github',
      state: oauthState(),
      providerConnectionId: 'ca_1',
    })).rejects.toMatchObject({ status: 400 });

    await service.connect('github', { callbackUrl: 'https://host.example/callback' });
    const connected = await service.completeComposioConnection({
      connectorId: 'github',
      state: oauthState(),
      providerConnectionId: 'ca_1',
      status: 'success',
    });
    expect(connected.status).toBe('connected');
    expect((await service.disconnect('github')).status).toBe('available');
    await expect(service.disconnect('missing')).rejects.toMatchObject({ code: 'CONNECTOR_NOT_FOUND' });
    await expect(service.cancelPendingAuthorization('missing')).rejects.toMatchObject({ code: 'CONNECTOR_NOT_FOUND' });
    await expect(service.completeComposioConnection({
      connectorId: 'missing',
      state: 'state',
    })).rejects.toMatchObject({ code: 'CONNECTOR_NOT_FOUND' });

    service.setCredentialStore(new InMemoryConnectorCredentialStore());
    service.deleteCredentialsByProvider('composio');
  });

  it('fails closed for disconnected, disabled, missing, and policy-inconsistent tools', async () => {
    const baseRequest = {
      connectorId: 'example',
      toolName: 'example.list_items',
      input: {},
    } as const;
    const context = { scopeId: 'workspace_1', sessionId: 'session_1' };
    const readDefinition = createReadDefinition({ type: 'object', additionalProperties: false });

    const disconnected = createService({
      featuredCatalog: [readDefinition],
      connectorId: 'example',
      toolkitSlug: 'EXAMPLE',
      preconnected: false,
    });
    await expect(disconnected.service.execute(baseRequest, context)).rejects.toMatchObject({
      code: 'CONNECTOR_NOT_CONNECTED',
      status: 403,
    });

    const disabled = createService({
      featuredCatalog: [{ ...readDefinition, disabled: true }],
      connectorId: 'example',
      toolkitSlug: 'EXAMPLE',
    });
    await expect(disabled.service.execute(baseRequest, context)).rejects.toMatchObject({
      code: 'CONNECTOR_DISABLED',
      status: 403,
    });

    const notAllowed = createService({
      featuredCatalog: [{ ...readDefinition, allowedToolNames: [] }],
      connectorId: 'example',
      toolkitSlug: 'EXAMPLE',
    });
    await expect(notAllowed.service.execute(baseRequest, context)).rejects.toMatchObject({
      code: 'CONNECTOR_TOOL_NOT_FOUND',
      message: 'connector tool is not allowed',
    });

    const missingTool = createService({
      featuredCatalog: [{ ...readDefinition, tools: [], allowedToolNames: ['example.list_items'] }],
      connectorId: 'example',
      toolkitSlug: 'EXAMPLE',
    });
    await expect(missingTool.service.execute(baseRequest, context)).rejects.toMatchObject({
      code: 'CONNECTOR_TOOL_NOT_FOUND',
      message: 'connector tool is not allowed',
    });

    const policyDenied = createService({
      featuredCatalog: [{ ...readDefinition, minimumApproval: 'confirm' }],
      connectorId: 'example',
      toolkitSlug: 'EXAMPLE',
    });
    await expect(policyDenied.service.execute(baseRequest, context)).rejects.toMatchObject({
      code: 'CONNECTOR_SAFETY_DENIED',
      status: 403,
    });
  });

  it('invalidates credentials and records an error when Composio reports stale authentication', async () => {
    const { service } = createService({
      response: {
        successful: false,
        error: { message: 'access token expired', api_key: 'must-not-escape' },
      },
    });
    const request = {
      connectorId: 'github',
      toolName: 'github.github_search_repositories',
      input: { query: 'jini' },
    } as const;

    const failure = await service.execute(request, {
      scopeId: 'workspace_1',
      sessionId: 'session_1',
    }).then(() => undefined, (error: unknown) => error);
    expect(failure).toMatchObject({
      code: 'CONNECTOR_EXECUTION_FAILED',
      details: { authStale: true },
    });
    expect(JSON.stringify(failure)).not.toContain('must-not-escape');
    expect(service.getCredential('github')).toBeUndefined();
    expect(service.getStatus(service.getFastDefinition('github')!)).toMatchObject({
      status: 'error',
      accountLabel: 'octocat',
      lastError: 'GitHub authorization expired. Reconnect GitHub.',
    });
  });

  it('enforces canonical identifiers, no-session buckets, rolling windows, and total run limits', async () => {
    let now = 0;
    const { service, executeRequests } = createService({ now: () => now });
    const request = {
      connectorId: 'github',
      toolName: 'github.github_search_repositories',
      input: { query: 'jini' },
    } as const;

    await expect(service.execute(request, {
      scopeId: 'contains spaces',
      sessionId: 'session_1',
    })).rejects.toMatchObject({ code: 'CONNECTOR_RATE_LIMITED', status: 400 });
    await expect(service.execute(request, {
      scopeId: 'workspace_1',
      sessionId: 'x'.repeat(257),
    })).rejects.toMatchObject({ code: 'CONNECTOR_RATE_LIMITED', status: 400 });

    for (let index = 0; index < CONNECTOR_RUN_RATE_LIMIT_CALLS; index += 1) {
      await service.execute(request, {
        scopeId: 'workspace_no_session',
        purpose: 'background_refresh',
      });
    }
    await expect(service.execute(request, {
      scopeId: 'workspace_no_session',
      purpose: 'background_refresh',
    })).rejects.toMatchObject({ code: 'CONNECTOR_RATE_LIMITED', status: 429 });

    await expect(service.execute(request, {
      scopeId: 'workspace_default_purpose',
    })).resolves.toMatchObject({ ok: true });

    for (let index = 0; index < 60; index += 1) {
      if (index > 0 && index % CONNECTOR_RUN_RATE_LIMIT_CALLS === 0) {
        now += 60_001;
      }
      await service.execute(request, {
        scopeId: 'workspace_total',
        sessionId: 'session_total',
      });
    }
    now += 60_001;
    await expect(service.execute(request, {
      scopeId: 'workspace_total',
      sessionId: 'session_total',
    })).rejects.toMatchObject({
      code: 'CONNECTOR_RATE_LIMITED',
      details: { totalCallLimit: 60 },
    });
    expect(executeRequests).toHaveBeenCalledTimes(CONNECTOR_RUN_RATE_LIMIT_CALLS + 1 + 60);

    now += 15 * 60_000;
    await expect(service.execute(request, {
      scopeId: 'workspace_total',
      sessionId: 'session_total',
    })).resolves.toMatchObject({ ok: true });
  });

  it('summarizes provider result shapes and supports the default status service', async () => {
    const request = {
      connectorId: 'github',
      toolName: 'github.github_search_repositories',
      input: { query: 'jini' },
    } as const;
    const context = { scopeId: 'workspace_1', sessionId: 'session_1' };
    const cases: Array<[unknown, string]> = [
      [{ successful: true, data: { count: 2 } }, 'github.github_search_repositories: 2 results'],
      [{ successful: true, data: { path: '/repo' } }, 'github.github_search_repositories: /repo'],
      [{ successful: true, data: { isRepository: true } }, 'github.github_search_repositories: repository found'],
      [{ successful: true, data: { isRepository: false } }, 'github.github_search_repositories: not a repository'],
      [{ successful: true, data: 'ok' }, 'github.github_search_repositories'],
    ];
    for (const [response, summary] of cases) {
      const harness = createService({ response });
      await expect(harness.service.execute(request, context)).resolves.toMatchObject({
        outputSummary: summary,
      });
    }

    const { provider } = createService({ preconnected: false });
    const defaultService = new ComposioConnectorService({ provider, now: () => 0 });
    expect(defaultService.getStatus(defaultService.getFastDefinition('github')!)).toEqual({
      status: 'available',
    });

    class ExposedService extends ComposioConnectorService {
      invokeUnresolvedProvider(): Promise<JsonObject> {
        return this.executeConnectorProviderTool({
          connectorId: 'missing',
          toolName: 'missing.list',
          input: {},
        }, {
          scopeId: 'workspace_1',
          sessionId: 'session_1',
        });
      }
    }
    await expect(new ExposedService({ provider }).invokeUnresolvedProvider()).rejects.toMatchObject({
      status: 501,
      message: 'connector provider is not implemented',
    });
  });

  it('commits immediate validated connections and enforces run-limit bucket capacity', async () => {
    const immediate = createService({ preconnected: false, immediateConnect: true });
    await expect(immediate.service.connect('github', {
      callbackUrl: 'https://host.example/callback',
    })).resolves.toMatchObject({
      connector: { status: 'connected' },
      auth: { kind: 'connected', providerConnectionId: 'ca_1' },
    });

    const capacity = createService({ now: () => 0 });
    const runLimits = (capacity.service as unknown as {
      runLimits: Map<string, {
        windowStartedAt: number;
        lastSeenAt: number;
        windowCalls: number;
        totalCalls: number;
      }>;
    }).runLimits;
    for (let index = 0; index < 10_000; index += 1) {
      runLimits.set(`occupied-${index}`, {
        windowStartedAt: 0,
        lastSeenAt: 0,
        windowCalls: 0,
        totalCalls: 0,
      });
    }
    await expect(capacity.service.execute({
      connectorId: 'github',
      toolName: 'github.github_search_repositories',
      input: { query: 'jini' },
    }, {
      scopeId: 'workspace_capacity',
      sessionId: 'session_capacity',
    })).rejects.toMatchObject({
      code: 'CONNECTOR_RATE_LIMITED',
      details: { bucketLimit: 10_000 },
    });
    expect(capacity.executeRequests).not.toHaveBeenCalled();
  });

  it('omits summaries when a provider result has no tool identity', async () => {
    const harness = createService();
    class MissingIdentityService extends ComposioConnectorService {
      protected override async executeConnectorProviderTool(): Promise<JsonObject> {
        return { data: { ok: true } };
      }
    }
    const store = new InMemoryConnectorCredentialStore();
    store.set({
      schemaVersion: 1,
      connectorId: 'github',
      accountLabel: 'octocat',
      credentials: createCredential('github', 'GITHUB'),
      updatedAt: '2026-07-23T00:00:00.000Z',
    });
    const service = new MissingIdentityService({ provider: harness.provider });
    service.setCredentialStore(store);
    const response = await service.execute({
      connectorId: 'github',
      toolName: 'github.github_search_repositories',
      input: { query: 'jini' },
    }, {
      scopeId: 'workspace_1',
      sessionId: 'session_1',
    });
    expect(response.outputSummary).toBeUndefined();
  });

  it('preserves service behavior across optional auth, non-Composio, and disabled branches', async () => {
    const harness = createService({ preconnected: false });
    const github = harness.service.getFastDefinition('github')!;
    const localTool = defineConnectorTool({
      name: 'local.list',
      title: 'List',
      inputSchemaJson: { type: 'object' },
      requiredScopes: [],
    });
    const local: ConnectorCatalogDefinition = {
      id: 'local',
      name: 'Local',
      provider: 'local',
      category: 'Test',
      authentication: 'local',
      tools: [localTool],
      allowedToolNames: [localTool.name],
    };

    const fast = vi.spyOn(harness.provider, 'getFastDefinitions').mockReturnValue([local]);
    const definition = vi.spyOn(harness.provider, 'getDefinition').mockResolvedValue(local);
    await expect(harness.service.prepareAuthConfigs(['local'])).resolves.toEqual({
      results: {
        local: { status: 'error', message: 'connector is not backed by Composio' },
      },
    });
    await expect(harness.service.connect('local')).resolves.toMatchObject({
      connector: { id: 'local', status: 'connected' },
    });
    await expect(harness.service.completeComposioConnection({
      connectorId: 'local',
      state: 'state',
    })).rejects.toMatchObject({
      status: 400,
      message: 'connector is not backed by Composio',
    });
    fast.mockRestore();
    definition.mockRestore();

    const disabled = { ...github, disabled: true };
    const disabledFast = vi.spyOn(harness.provider, 'getFastDefinitions').mockReturnValue([disabled]);
    const connect = vi.spyOn(harness.provider, 'connect').mockResolvedValue({
      kind: 'connected',
      providerConnectionId: 'ca_1',
      expiresAt: '2026-07-23T00:10:00.000Z',
      credentials: createCredential('github', 'GITHUB'),
    });
    await expect(harness.service.connect('github', {
      callbackUrl: 'https://host.example/callback',
    })).rejects.toMatchObject({ code: 'CONNECTOR_DISABLED' });
    connect.mockRestore();

    const pending = vi.spyOn(harness.provider, 'connect').mockResolvedValue({ kind: 'pending' });
    await expect(harness.service.connect('github', {
      callbackUrl: 'https://host.example/callback',
    })).resolves.toEqual({
      connector: expect.objectContaining({ id: 'github' }),
      auth: { kind: 'pending' },
    });
    pending.mockRestore();
    disabledFast.mockRestore();
  });

  it('reports absent account labels and no-session total limits without ambiguous nullability', async () => {
    let now = 0;
    const harness = createService({ preconnected: false, now: () => now });
    const credentialStore = new InMemoryConnectorCredentialStore();
    credentialStore.set({
      schemaVersion: 1,
      connectorId: 'github',
      credentials: createCredential('github', 'GITHUB'),
      updatedAt: '2026-07-23T00:00:00.000Z',
    });
    const status = new ConnectorStatusService({
      credentialStore,
      now: () => now,
    });
    class StableOutputService extends ComposioConnectorService {
      protected override async executeConnectorProviderTool(): Promise<JsonObject> {
        return { toolName: 'github.github_search_repositories', data: { ok: true } };
      }
    }
    const service = new StableOutputService({
      provider: harness.provider,
      statusService: status,
      now: () => now,
    });
    const request = {
      connectorId: 'github',
      toolName: 'github.github_search_repositories',
      input: { query: 'jini' },
      expectedAccountLabel: 'octocat',
    } as const;
    await expect(service.execute(request, {
      scopeId: 'workspace_1',
      sessionId: 'session_1',
    })).rejects.toMatchObject({
      details: { currentAccountLabel: null },
    });

    const response = await service.execute({
      ...request,
      expectedAccountLabel: undefined,
    }, {
      scopeId: 'workspace_1',
      sessionId: 'session_1',
    });
    expect(response.accountLabel).toBeUndefined();

    for (let index = 0; index < 60; index += 1) {
      if (index > 0 && index % CONNECTOR_RUN_RATE_LIMIT_CALLS === 0) now += 60_001;
      await service.execute({
        ...request,
        expectedAccountLabel: undefined,
      }, {
        scopeId: 'workspace_no_session_total',
      });
    }
    now += 60_001;
    await expect(service.execute({
      ...request,
      expectedAccountLabel: undefined,
    }, {
      scopeId: 'workspace_no_session_total',
    })).rejects.toMatchObject({
      details: { sessionId: null },
    });
  });

  it('covers approval ordering, credential-label defaults, callback options, and protected execution fallback', async () => {
    const harness = createService({ preconnected: false });
    const github = harness.provider.getFastDefinitions().find((definition) => definition.id === 'github')!;

    const status = new ConnectorStatusService({
      credentialStore: new InMemoryConnectorCredentialStore(),
    });
    expect(status.connect(github, undefined, createCredential('github', 'GITHUB'))).toMatchObject({
      status: 'connected',
      accountLabel: 'GitHub',
    });
    status.setError(github, 'explicit failure');
    const statusService = new ComposioConnectorService({
      provider: harness.provider,
      statusService: status,
    });
    await expect(statusService.getConnector('github')).resolves.toMatchObject({
      lastError: 'explicit failure',
    });

    const complete = vi.spyOn(harness.provider, 'completeConnection').mockResolvedValue({
      connectorId: 'github',
      accountLabel: 'octocat',
      credentials: createCredential('github', 'GITHUB'),
    });
    const controller = new AbortController();
    await harness.service.completeComposioConnection({
      connectorId: 'github',
      state: 'state',
      providerConnectionId: 'ca_1',
      status: 'success',
      signal: controller.signal,
    });
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      providerConnectionId: 'ca_1',
      status: 'success',
      signal: controller.signal,
    }));
    await harness.service.completeComposioConnection({
      connectorId: 'github',
      state: 'state-with-provider-default',
    });
    expect(complete).toHaveBeenLastCalledWith(expect.not.objectContaining({
      providerConnectionId: expect.anything(),
    }));
    complete.mockRestore();

    const baseTool = github.tools[0]!;
    const minimumDisabled = { ...github, minimumApproval: 'disabled' as const };
    vi.spyOn(harness.provider, 'listDefinitions').mockResolvedValue([minimumDisabled]);
    vi.spyOn(harness.provider, 'getHydratedDefinition').mockResolvedValue(minimumDisabled);
    await expect(harness.service.execute({
      connectorId: github.id,
      toolName: baseTool.name,
      input: { query: 'jini' },
    }, {
      scopeId: 'workspace_disabled_approval',
    })).rejects.toMatchObject({
      code: 'CONNECTOR_SAFETY_DENIED',
      details: { approvalPolicy: 'disabled' },
    });

    const confirmTool = {
      ...baseTool,
      safety: { sideEffect: 'read', approval: 'confirm', reason: 'host confirmation' } as const,
    };
    const confirmDefinition = {
      ...github,
      tools: [confirmTool],
      allowedToolNames: [confirmTool.name],
      minimumApproval: 'auto' as const,
    };
    vi.mocked(harness.provider.getHydratedDefinition).mockResolvedValue(confirmDefinition);
    await expect(harness.service.execute({
      connectorId: github.id,
      toolName: confirmTool.name,
      input: { query: 'jini' },
    }, {
      scopeId: 'workspace_confirm_approval',
    })).rejects.toMatchObject({
      code: 'CONNECTOR_SAFETY_DENIED',
      details: { approvalPolicy: 'confirm' },
    });

    const noMinimum = { ...github, minimumApproval: undefined };
    vi.mocked(harness.provider.getHydratedDefinition).mockResolvedValue(noMinimum);
    await expect(harness.service.execute({
      connectorId: github.id,
      toolName: baseTool.name,
      input: { query: 'jini' },
    }, {
      scopeId: 'workspace_default_approval',
    })).rejects.toMatchObject({
      code: 'CONNECTOR_SAFETY_DENIED',
      details: { approvalPolicy: 'disabled' },
    });

    class ExposedProviderFallbackService extends ComposioConnectorService {
      runProviderFallback(
        request: ConnectorExecuteRequest,
        context: ConnectorExecutionContext,
        definition: ConnectorCatalogDefinition,
      ): Promise<JsonObject> {
        return this.executeConnectorProviderTool(request, context, definition);
      }
    }
    const exposed = new ExposedProviderFallbackService({
      provider: harness.provider,
      statusService: status,
    });
    vi.spyOn(harness.provider, 'execute').mockResolvedValue({
      toolName: baseTool.name,
      data: { ok: true },
    });
    await expect(exposed.runProviderFallback({
      connectorId: github.id,
      toolName: baseTool.name,
      input: { query: 'jini' },
    }, {
      scopeId: 'workspace_provider_fallback',
    }, github)).resolves.toMatchObject({
      toolName: baseTool.name,
    });
  });
});
