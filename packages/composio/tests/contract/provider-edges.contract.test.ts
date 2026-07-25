import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ComposioConnectorProvider,
  ConnectorServiceError,
  defineConnectorTool,
  getStaticComposioCatalogDefinitions,
  type ComposioConfig,
  type ComposioConfigStore,
  type ComposioCredentialMaterial,
  type ConnectorCatalogDefinition,
} from '../../src/index.js';
import { writePersistedComposioCatalogCache } from '../../src/composio.js';

interface MutableConfigStore extends ComposioConfigStore {
  setApiKey(apiKey: string): void;
  clearAuthConfigIds(): void;
}

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jini-composio-provider-edges-'));
  temporaryDirectories.push(directory);
  return directory;
}

function mutableConfigStore(
  apiKey = 'project-key',
  authConfigIds: Record<string, string> = {},
): MutableConfigStore {
  let config: ComposioConfig = { apiKey, authConfigIds: { ...authConfigIds } };
  return {
    read: () => ({ apiKey: config.apiKey, authConfigIds: { ...config.authConfigIds } }),
    readPublic: () => ({
      configured: Boolean(config.apiKey),
      apiKeyTail: config.apiKey.slice(-4),
    }),
    write: () => ({
      configured: Boolean(config.apiKey),
      apiKeyTail: config.apiKey.slice(-4),
    }),
    setAuthConfigId: (connectorId, authConfigId) => {
      config = {
        ...config,
        authConfigIds: { ...config.authConfigIds, [connectorId]: authConfigId },
      };
    },
    deleteAuthConfigId: (connectorId) => {
      const next = { ...config.authConfigIds };
      delete next[connectorId];
      config = { ...config, authConfigIds: next };
    },
    setApiKey: (nextApiKey) => {
      config = { ...config, apiKey: nextApiKey };
    },
    clearAuthConfigIds: () => {
      config = { ...config, authConfigIds: {} };
    },
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function bodyFrom(init: RequestInit | undefined): Record<string, unknown> | undefined {
  return typeof init?.body === 'string'
    ? JSON.parse(init.body) as Record<string, unknown>
    : undefined;
}

function githubDefinition(): ConnectorCatalogDefinition {
  return getStaticComposioCatalogDefinitions().find((definition) => definition.id === 'github')!;
}

function githubCredential(overrides: Partial<ComposioCredentialMaterial> = {}): ComposioCredentialMaterial {
  return {
    provider: 'composio',
    providerConnectionId: 'ca_1',
    userId: 'user_1',
    connectorId: 'github',
    toolkitSlug: 'GITHUB',
    authConfigId: 'auth_1',
    validatedAt: '2026-07-24T00:00:00.000Z',
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('ComposioConnectorProvider edge contracts', () => {
  it('deduplicates discovery, retains locally-created auth, honors host identity, and bounds refresh scheduling', async () => {
    let releaseAuthConfigs!: () => void;
    const authConfigsGate = new Promise<void>((resolve) => {
      releaseAuthConfigs = resolve;
    });
    let authConfigReads = 0;
    const requests: Array<{ url: URL; init?: RequestInit }> = [];
    const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      requests.push({ url, init });
      if (url.pathname === '/api/v3.1/auth_configs' && init?.method === 'GET') {
        authConfigReads += 1;
        if (authConfigReads === 1) await authConfigsGate;
        return jsonResponse({ items: [] });
      }
      if (url.pathname === '/api/v3.1/auth_configs' && init?.method === 'POST') {
        // The adapter must safely retain the definition toolkit when the
        // provider omits its redundant toolkit identity in this response.
        return jsonResponse({ id: 'auth_local' }, 201);
      }
      if (url.pathname === '/api/v3.1/toolkits') {
        return jsonResponse({ items: [{ name: 'Missing slug' }] });
      }
      if (url.pathname === '/api/v3/connected_accounts/link') {
        return jsonResponse({});
      }
      throw new Error(`unexpected request: ${init?.method} ${url.pathname}`);
    }) as unknown as typeof fetch;
    const provider = new ComposioConnectorProvider({
      userId: ' user_1 ',
      configStore: mutableConfigStore(),
      fetchFn,
      baseUrl: 'https://composio.example///',
      userAgent: ' jini-host/1.0 ',
      productName: ' Jini Studio ',
    });

    const first = provider.listDefinitions();
    const second = provider.listDefinitions();
    releaseAuthConfigs();
    const [firstDefinitions, secondDefinitions] = await Promise.all([first, second]);
    expect(firstDefinitions).toEqual(secondDefinitions);
    expect(authConfigReads).toBe(1);
    expect(requests[0]?.init?.headers).toMatchObject({ 'user-agent': 'jini-host/1.0' });
    expect(requests[0]?.url.origin).toBe('https://composio.example');

    await expect(provider.connect(githubDefinition(), 'https://host.example/callback')).resolves.toMatchObject({
      kind: 'pending',
    });
    await expect(provider.listDefinitions()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'github' })]),
    );
    expect(provider.isConfigured(githubDefinition())).toBe(true);

    expect(getStaticComposioCatalogDefinitions({
      featuredCatalog: [],
      toolkits: [{ name: 'Acme', slug: 'ACME' }],
      productName: ' Jini Studio ',
    })[0]?.description).toContain('Jini Studio');
    expect(getStaticComposioCatalogDefinitions({
      featuredCatalog: [],
      toolkits: [{ name: 'Acme', slug: 'ACME' }],
      productName: '   ',
    })[0]?.description).toContain('your workspace');
    expect(getStaticComposioCatalogDefinitions({
      featuredCatalog: [],
      toolkits: [{ name: 'Acme Developer', slug: 'ACME_DEVELOPER', category: 'Developer' }],
    })[0]?.description).toContain('developer resources');

    vi.useFakeTimers();
    const offlineFetch = vi.fn(async () => {
      throw new Error('offline refresh must not fetch without an API key');
    }) as unknown as typeof fetch;
    const offline = new ComposioConnectorProvider({
      userId: 'user_1',
      configStore: mutableConfigStore(''),
      fetchFn: offlineFetch,
    });
    offline.startCatalogRefreshLoop();
    offline.startCatalogRefreshLoop();
    await vi.advanceTimersByTimeAsync(1);
    offline.stopCatalogRefreshLoop();
    expect(offlineFetch).not.toHaveBeenCalled();
  });

  it('loads fresh, stale, and absent cache states without granting cache authority', () => {
    const now = Date.parse('2026-07-24T12:00:00.000Z');
    const freshPath = path.join(temporaryDirectory(), 'fresh.json');
    writePersistedComposioCatalogCache(freshPath, {
      schemaVersion: 1,
      provider: 'composio',
      fetchedAt: new Date(now).toISOString(),
      definitions: [githubDefinition()],
    });
    const fresh = new ComposioConnectorProvider({
      userId: 'user_1',
      configStore: mutableConfigStore(),
      catalogCachePath: freshPath,
      fetchFn: vi.fn() as unknown as typeof fetch,
      now: () => now,
    });
    expect(fresh.getPersistedCatalogMetadata()).toEqual({
      fetchedAt: new Date(now).toISOString(),
      stale: false,
    });

    const stalePath = path.join(temporaryDirectory(), 'stale.json');
    writePersistedComposioCatalogCache(stalePath, {
      schemaVersion: 1,
      provider: 'composio',
      fetchedAt: 'not-a-date',
      definitions: [githubDefinition()],
    });
    const stale = new ComposioConnectorProvider({
      userId: 'user_1',
      configStore: mutableConfigStore(''),
      catalogCachePath: stalePath,
      fetchFn: vi.fn() as unknown as typeof fetch,
      now: () => now,
    });
    expect(stale.getPersistedCatalogMetadata()).toMatchObject({ stale: true });

    const missingDirectory = temporaryDirectory();
    stale.configureCatalogCache(missingDirectory);
    expect(stale.getPersistedCatalogMetadata()).toEqual({ stale: true });

    vi.useFakeTimers();
    const scheduledPath = path.join(temporaryDirectory(), 'scheduled.json');
    writePersistedComposioCatalogCache(scheduledPath, {
      schemaVersion: 1,
      provider: 'composio',
      fetchedAt: '2020-01-01T00:00:00.000Z',
      definitions: [githubDefinition()],
    });
    const configuredDirectory = temporaryDirectory();
    const configuredPath = path.join(configuredDirectory, 'connectors', 'composio-catalog-cache.json');
    writePersistedComposioCatalogCache(configuredPath, {
      schemaVersion: 1,
      provider: 'composio',
      fetchedAt: '2020-01-01T00:00:00.000Z',
      definitions: [githubDefinition()],
    });
    const scheduled = new ComposioConnectorProvider({
      userId: 'user_1',
      configStore: mutableConfigStore(),
      catalogCachePath: scheduledPath,
      fetchFn: vi.fn() as unknown as typeof fetch,
      now: () => now,
    });
    scheduled.configureCatalogCache(configuredDirectory);
    scheduled.stopCatalogRefreshLoop();
  });

  it('uses definition ids when no provider toolkit identity has been configured', async () => {
    const custom: ConnectorCatalogDefinition = {
      id: 'custom',
      name: 'Custom',
      provider: 'composio',
      category: 'Test',
      authentication: 'composio',
      tools: [],
      allowedToolNames: [],
      minimumApproval: 'auto',
    };
    const provider = new ComposioConnectorProvider({
      userId: 'user_1',
      configStore: mutableConfigStore(''),
      featuredCatalog: [custom],
      fetchFn: vi.fn(async () => {
        throw new Error('unconfigured provider request');
      }) as unknown as typeof fetch,
    });
    await expect(provider.listDefinitions()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'custom', providerConnectorId: 'custom' }),
      ]),
    );
    await expect(provider.getHydratedDefinition('custom')).resolves.toMatchObject({
      providerConnectorId: 'custom',
    });
    await expect(provider.getPreviewDefinition('custom', {
      toolsLimit: 1,
    })).rejects.toMatchObject({
      message: 'Composio provider is not configured',
    });
  });

  it('normalizes data aliases, missing toolkit fields, cursors, and conservative tool schemas', async () => {
    const customTool = defineConnectorTool({
      name: 'custom.static_read',
      title: 'Static read',
      inputSchemaJson: { type: 'object' },
      requiredScopes: [],
    });
    const customDefinition: ConnectorCatalogDefinition = {
      id: 'custom',
      name: 'Custom',
      provider: 'composio',
      category: 'Test',
      authentication: 'composio',
      tools: [customTool],
      allowedToolNames: [customTool.name],
      minimumApproval: 'auto',
    };
    const requests: URL[] = [];
    const controller = new AbortController();
    const provider = new ComposioConnectorProvider({
      userId: 'user_1',
      configStore: mutableConfigStore(),
      featuredCatalog: [customDefinition],
      fetchFn: vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        requests.push(url);
        if (url.pathname === '/api/v3.1/auth_configs') {
          return jsonResponse({
            data: [
              null,
              { id: 'disabled', status: 'DISABLED', toolkit_slug: 'CUSTOM' },
              { auth_config: { id: 'auth_custom' }, status: 'ENABLED', toolkitSlug: 'CUSTOM' },
            ],
          });
        }
        if (url.pathname === '/api/v3.1/toolkits') {
          return jsonResponse({
            data: [
              null,
              { name: 'Missing slug' },
              {
                slug: 'CUSTOM',
                name: 'Custom Live',
                description: 'Useful live description',
                categories: [{ slug: 'productivity' }],
                meta: { toolsCount: 7 },
              },
            ],
          });
        }
        if (url.pathname === '/api/v3.1/tools') {
          return jsonResponse({
            data: [
              null,
              {
                name: 'Read Things',
                humanDescription: 'Read things safely.',
                toolkit: { slug: 'CUSTOM' },
              },
              {
                slug: 'CUSTOM_BOOLEAN_SCHEMA',
                input_parameters: true,
                toolkit: { slug: 'CUSTOM' },
              },
              {
                slug: 'CUSTOM_WRONG_TOOLKIT',
                input_parameters: false,
                toolkit: { slug: 'OTHER' },
              },
            ],
            nextCursor: 'cursor_2',
            totalItems: 7,
          });
        }
        throw new Error(`unexpected request: ${url.pathname}`);
      }) as unknown as typeof fetch,
    });

    const preview = await provider.getPreviewDefinition('custom', {
      toolsLimit: 3,
      toolsCursor: 'cursor_1',
      signal: controller.signal,
    });
    expect(preview).toMatchObject({
      id: 'custom',
      name: 'Custom Live',
      providerConnectorId: 'CUSTOM',
      category: 'productivity',
      description: 'Useful live description',
      toolCount: 7,
      toolsNextCursor: 'cursor_2',
      toolsHasMore: true,
    });
    expect(preview?.tools.some((candidate) => candidate.inputSchemaUnsupportedReason === 'provider input schema is missing')).toBe(true);
    expect(requests.find((url) => url.pathname === '/api/v3.1/tools')?.searchParams.get('cursor')).toBe('cursor_1');

    const hydrated = await provider.getHydratedDefinition('custom', controller.signal);
    expect(hydrated?.providerConnectorId).toBe('CUSTOM');
    expect(await provider.getDefinition('absent', controller.signal)).toBeUndefined();
    expect(await provider.getHydratedDefinition('absent', controller.signal)).toBeUndefined();
    expect(await provider.getPreviewDefinition('absent', {
      toolsLimit: 1,
      signal: controller.signal,
    })).toBeUndefined();
  });

  it('treats auth-config and toolkit list failures as discovery-only across supported payload shapes', async () => {
    const scenarios: Array<{
      auth: Response;
      toolkits: Response;
    }> = [
      { auth: jsonResponse({}, 500), toolkits: jsonResponse({}, 500) },
      { auth: jsonResponse(null), toolkits: jsonResponse(null) },
      { auth: jsonResponse([]), toolkits: jsonResponse([]) },
      { auth: jsonResponse({ items: 'invalid' }), toolkits: jsonResponse({ items: 'invalid' }) },
      {
        auth: jsonResponse({ data: [{ id: 'auth_1', toolkit: { slug: 'GITHUB' } }, 'invalid'] }),
        toolkits: jsonResponse({ data: [{ slug: 'GITHUB' }, 'invalid'] }),
      },
    ];
    for (const { auth, toolkits } of scenarios) {
      const controller = new AbortController();
      const provider = new ComposioConnectorProvider({
        userId: 'user_1',
        configStore: mutableConfigStore(),
        fetchFn: vi.fn(async (input: string | URL | Request) => {
          const url = new URL(String(input));
          if (url.pathname === '/api/v3.1/auth_configs') return auth.clone();
          if (url.pathname === '/api/v3.1/toolkits') return toolkits.clone();
          throw new Error(`unexpected request: ${url.pathname}`);
        }) as unknown as typeof fetch,
      });
      await expect(provider.listDefinitions(controller.signal)).resolves.toHaveLength(
        getStaticComposioCatalogDefinitions().length,
      );
    }
  });

  it('handles unsupported managed auth through absent, discovered, and malformed store states', async () => {
    const store = mutableConfigStore();
    const controller = new AbortController();
    let mode: 'custom' | 'discovered' = 'custom';
    const provider = new ComposioConnectorProvider({
      userId: 'user_1',
      configStore: store,
      featuredCatalog: [githubDefinition()],
      fetchFn: vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.pathname === '/api/v3.1/auth_configs' && init?.method === 'GET') {
          return mode === 'custom'
            ? jsonResponse({ items: [] })
            : jsonResponse({
              items: [{ id: 'auth_discovered', toolkit: { slug: 'GITHUB' }, status: 'ENABLED' }],
            });
        }
        if (url.pathname === '/api/v3.1/auth_configs' && init?.method === 'POST') {
          return jsonResponse({ message: 'default auth config not found' }, 400);
        }
        if (url.pathname === '/api/v3.1/toolkits') return jsonResponse({ items: [] });
        throw new Error(`unexpected request: ${init?.method} ${url.pathname}`);
      }) as unknown as typeof fetch,
    });
    await expect(provider.prepareAuthConfig(githubDefinition(), controller.signal)).resolves.toMatchObject({
      status: 'custom_required',
    });
    await expect(provider.prepareAuthConfig(githubDefinition(), controller.signal)).resolves.toMatchObject({
      status: 'custom_required',
    });
    mode = 'discovered';
    provider.clearDiscoveryCache();
    // Re-establish the unsupported marker, then populate discovery without
    // persisting it into the host configuration store.
    mode = 'custom';
    await provider.prepareAuthConfig(githubDefinition(), controller.signal);
    mode = 'discovered';
    await provider.listDefinitions(controller.signal);
    await expect(provider.prepareAuthConfig(githubDefinition(), controller.signal)).resolves.toEqual({
      status: 'ready',
      authConfigId: 'auth_discovered',
    });

    const malformedStore: ComposioConfigStore = {
      ...mutableConfigStore(),
      read: () => {
        throw 'non-error store failure';
      },
    };
    const malformed = new ComposioConnectorProvider({
      userId: 'user_1',
      configStore: malformedStore,
      fetchFn: vi.fn() as unknown as typeof fetch,
    });
    await expect(malformed.prepareAuthConfig(githubDefinition())).resolves.toEqual({
      status: 'error',
      message: 'non-error store failure',
    });
  });

  it('does not echo secret-bearing config parse errors through auth preparation', async () => {
    const secret = 'composio-project-secret-must-not-escape';
    const parseError = new SyntaxError(`Malformed config near apiKey "${secret}"`);
    const onError = vi.fn();
    const configStore: ComposioConfigStore = {
      ...mutableConfigStore(),
      read: () => {
        throw parseError;
      },
    };
    const provider = new ComposioConnectorProvider({
      userId: 'user_1',
      configStore,
      fetchFn: vi.fn() as unknown as typeof fetch,
      onError,
    });

    const result = await provider.prepareAuthConfig(githubDefinition());
    expect(result).toMatchObject({ status: 'error' });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toMatchObject({ error: parseError });
  });

  it('filters mismatched auth configs while accepting the requested-toolkit fallback', async () => {
    const controller = new AbortController();
    const provider = new ComposioConnectorProvider({
      userId: 'user_1',
      configStore: mutableConfigStore(),
      fetchFn: vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        if (url.pathname === '/api/v3.1/auth_configs') {
          return jsonResponse({
            items: [
              {},
              { id: 'disabled', status: 'DISABLED', toolkit: { slug: 'GITHUB' } },
              { id: 'wrong', status: 'ENABLED', toolkit: { slug: 'SLACK' } },
              { id: 'auth_fallback' },
            ],
          });
        }
        throw new Error(`unexpected request: ${url.pathname}`);
      }) as unknown as typeof fetch,
    });
    await expect(provider.prepareAuthConfig(githubDefinition(), controller.signal)).resolves.toEqual({
      status: 'ready',
      authConfigId: 'auth_fallback',
    });
  });

  it('rediscovers callback auth ownership and fails closed if configuration disappears', async () => {
    const store = mutableConfigStore('project-key', { github: 'auth_1' });
    let callbackState = '';
    const provider = new ComposioConnectorProvider({
      userId: 'user_1',
      configStore: store,
      fetchFn: vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.pathname === '/api/v3/connected_accounts/link') {
          callbackState = new URL(String(bodyFrom(init)?.callback_url)).searchParams.get('state') ?? '';
          return jsonResponse({ id: 'ca_1' });
        }
        if (url.pathname === '/api/v3.1/auth_configs') {
          return jsonResponse({
            items: [
              { id: 'auth_disabled', status: 'DISABLED', toolkit: { slug: 'GITHUB' } },
              { id: 'auth_1', status: 'ENABLED', toolkit: { slug: 'GITHUB' } },
            ],
          });
        }
        if (url.pathname === '/api/v3/connected_accounts/ca_1') {
          return jsonResponse({
            id: 'ca_1',
            user_id: 'user_1',
            auth_config: { id: 'auth_1' },
            toolkit: { slug: 'GITHUB' },
            status: 'ACTIVE',
          });
        }
        throw new Error(`unexpected request: ${url.pathname}`);
      }) as unknown as typeof fetch,
    });

    await provider.connect(githubDefinition(), 'https://host.example/callback');
    store.clearAuthConfigIds();
    provider.clearDiscoveryCache();
    await expect(provider.completeConnection({
      definition: githubDefinition(),
      state: callbackState,
      providerConnectionId: 'ca_1',
    })).resolves.toMatchObject({ connectorId: 'github' });

    store.setAuthConfigId('github', 'auth_1');
    await provider.connect(githubDefinition(), 'https://host.example/callback');
    store.clearAuthConfigIds();
    provider.clearDiscoveryCache();
    store.setApiKey('');
    await expect(provider.completeConnection({
      definition: githubDefinition(),
      state: callbackState,
      providerConnectionId: 'ca_1',
    })).rejects.toMatchObject({
      message: 'Composio OAuth auth configuration is missing',
    });
  });

  it('covers immediate OAuth aliases, execution result aliases, signals, and non-auth failures', async () => {
    const definition = githubDefinition();
    const tool = definition.tools[0]!;
    const controller = new AbortController();
    let executeIndex = 0;
    const provider = new ComposioConnectorProvider({
      userId: 'user_1',
      configStore: mutableConfigStore('project-key', { github: 'auth_1' }),
      fetchFn: vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.pathname === '/api/v3/connected_accounts/link') {
          return jsonResponse({
            connectedAccountId: 'ca_1',
            status: 'ACTIVE',
          });
        }
        if (url.pathname === '/api/v3/connected_accounts/ca_1' && init?.method === 'GET') {
          return jsonResponse({
            connectedAccountId: 'ca_1',
            status: 'ACTIVE',
            userId: 'user_1',
            accountId: 'account_1',
            auth_config: { id: 'auth_1' },
            toolkit: { slug: 'GITHUB' },
          });
        }
        if (url.pathname.startsWith('/api/v3.1/tools/execute/')) {
          executeIndex += 1;
          if (executeIndex === 1) {
            return jsonResponse({
              successful: true,
              data: { count: 1 },
              logId: 'log_camel',
              sessionInfo: { page: 1 },
            });
          }
          if (executeIndex === 2) {
            return jsonResponse({
              successful: true,
              data: { count: 2 },
              session_info: { page: 2 },
            });
          }
          return jsonResponse({
            successful: false,
            error: { message: 'ordinary provider failure' },
          });
        }
        if (url.pathname === '/api/v3/connected_accounts/ca_1' && init?.method === 'DELETE') {
          return new Response(null, { status: 404 });
        }
        throw new Error(`unexpected request: ${init?.method} ${url.pathname}`);
      }) as unknown as typeof fetch,
    });

    await expect(provider.connect(
      definition,
      'https://host.example/callback',
      controller.signal,
    )).resolves.toMatchObject({
      kind: 'connected',
      providerConnectionId: 'ca_1',
      credentials: {
        userId: 'user_1',
        accountId: 'account_1',
      },
    });

    const credential = githubCredential({ accountId: 'account_1' });
    await expect(provider.execute(
      definition,
      tool,
      { query: 'jini' },
      credential,
      controller.signal,
    )).resolves.toMatchObject({
      providerExecutionId: 'log_camel',
      sessionInfo: { page: 1 },
    });
    await expect(provider.execute(
      definition,
      tool,
      { query: 'jini' },
      credential,
      controller.signal,
    )).resolves.toMatchObject({
      data: { count: 2 },
      sessionInfo: { page: 2 },
    });
    await expect(provider.execute(
      definition,
      tool,
      { query: 'jini' },
      credential,
      controller.signal,
    )).rejects.toMatchObject({
      code: 'CONNECTOR_EXECUTION_FAILED',
      details: {
        connectorId: 'github',
        toolName: tool.name,
      },
    });
    await expect(provider.disconnect(definition, credential, controller.signal)).resolves.toBeUndefined();
  });

  it('fails closed when provider identity lacks toolkit or active-status evidence', async () => {
    const definition = githubDefinition();
    const tool = definition.tools[0]!;
    const controller = new AbortController();
    const missingStatus = new ComposioConnectorProvider({
      userId: 'user_1',
      configStore: mutableConfigStore('project-key', { github: 'auth_1' }),
      fetchFn: vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        if (url.pathname === '/api/v3/connected_accounts/ca_1') {
          return jsonResponse({
            id: 'ca_1',
            user_id: 'user_1',
            auth_config: { id: 'auth_1' },
            toolkit: { slug: 'GITHUB' },
          });
        }
        throw new Error(`unexpected request: ${url.pathname}`);
      }) as unknown as typeof fetch,
    });
    await expect(missingStatus.execute(
      definition,
      tool,
      { query: 'jini' },
      githubCredential(),
      controller.signal,
    )).rejects.toMatchObject({
      details: { providerStatus: null },
    });

    const missingToolkitDefinition = {
      ...definition,
      providerConnectorId: undefined,
    };
    await expect(missingStatus.execute(
      missingToolkitDefinition,
      tool,
      { query: 'jini' },
      githubCredential(),
      controller.signal,
    )).rejects.toMatchObject({
      code: 'CONNECTOR_NOT_CONNECTED',
    });

    const accountValidation = new ComposioConnectorProvider({
      userId: 'user_1',
      configStore: mutableConfigStore('project-key', { github: 'auth_1' }),
      fetchFn: vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        if (url.pathname === '/api/v3/connected_accounts/link') {
          return jsonResponse({ id: 'ca_1', status: 'ACTIVE' });
        }
        if (url.pathname === '/api/v3/connected_accounts/ca_1') {
          return jsonResponse({
            id: 'ca_1',
            user_id: 'user_1',
            auth_config: { id: 'auth_1' },
            toolkit: { slug: 'GITHUB' },
            status: 'ACTIVE',
          });
        }
        throw new Error(`unexpected request: ${url.pathname}`);
      }) as unknown as typeof fetch,
    });
    await expect(accountValidation.connect(
      missingToolkitDefinition,
      'https://host.example/callback',
      controller.signal,
    )).rejects.toMatchObject({
      message: 'Composio connector is missing a toolkit slug',
    });
  });

  it('uses provider tool names when ids are absent and sanitizes both safe and ordinary tool-list errors', async () => {
    const idlessTool = defineConnectorTool({
      name: 'github.idless_read',
      title: 'Idless read',
      description: 'Read without modifying data.',
      inputSchemaJson: { type: 'object' },
      requiredScopes: [],
    });
    const definition = {
      ...githubDefinition(),
      tools: [idlessTool],
      allowedToolNames: [idlessTool.name],
      minimumApproval: 'auto' as const,
    };
    const requestedPaths: string[] = [];
    const provider = new ComposioConnectorProvider({
      userId: 'user_1',
      configStore: mutableConfigStore('project-key', { github: 'auth_1' }),
      fetchFn: vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        requestedPaths.push(url.pathname);
        if (url.pathname === '/api/v3/connected_accounts/ca_1') {
          return jsonResponse({
            id: 'ca_1',
            user_id: 'user_1',
            auth_config: { id: 'auth_1' },
            toolkit: { slug: 'GITHUB' },
            status: 'ACTIVE',
          });
        }
        if (url.pathname === `/api/v3.1/tools/execute/${idlessTool.name}`) {
          return jsonResponse({ successful: true, data: {}, log_id: '' });
        }
        throw new Error(`unexpected request: ${url.pathname}`);
      }) as unknown as typeof fetch,
    });
    await expect(provider.execute(
      definition,
      idlessTool,
      {},
      githubCredential(),
    )).resolves.toMatchObject({
      providerToolId: idlessTool.name,
    });
    expect(requestedPaths).toContain(`/api/v3.1/tools/execute/${idlessTool.name}`);

    for (const [status, payload] of [
      [401, { message: 'bad credentials' }],
      [500, { message: 'ordinary internal failure' }],
    ] as const) {
      const failing = new ComposioConnectorProvider({
        userId: 'user_1',
        configStore: mutableConfigStore(),
        fetchFn: vi.fn(async (input: string | URL | Request) => {
          const url = new URL(String(input));
          if (url.pathname === '/api/v3.1/auth_configs') return jsonResponse({ items: [] });
          if (url.pathname === '/api/v3.1/toolkits') return jsonResponse({ items: [] });
          if (url.pathname === '/api/v3.1/tools') return jsonResponse(payload, status);
          throw new Error(`unexpected request: ${url.pathname}`);
        }) as unknown as typeof fetch,
      });
      await expect(failing.getPreviewDefinition('github', {
        toolsLimit: 1,
      })).rejects.toBeInstanceOf(ConnectorServiceError);
    }

    const empty = new ComposioConnectorProvider({
      userId: 'user_1',
      configStore: mutableConfigStore(),
      fetchFn: vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        if (url.pathname === '/api/v3.1/auth_configs') return jsonResponse({ items: [] });
        if (url.pathname === '/api/v3.1/toolkits') return jsonResponse({ items: [] });
        if (url.pathname === '/api/v3.1/tools') return jsonResponse({ items: 'invalid', data: 'invalid' });
        throw new Error(`unexpected request: ${url.pathname}`);
      }) as unknown as typeof fetch,
    });
    await expect(empty.getPreviewDefinition('github', {
      toolsLimit: 1,
    })).resolves.toMatchObject({
      toolsHasMore: false,
    });
  });
});
