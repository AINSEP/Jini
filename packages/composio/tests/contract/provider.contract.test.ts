import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  ComposioConnectorProvider,
  ConnectorServiceError,
  getStaticComposioCatalogDefinitions,
  type ComposioConfig,
  type ComposioConfigStore,
  type PublicComposioConfig,
} from '../../src/index.js';

interface RecordedRequest {
  url: URL;
  init: RequestInit | undefined;
  body: Record<string, unknown> | undefined;
}

function createMemoryConfigStore(apiKey = 'project-key'): ComposioConfigStore {
  let config: ComposioConfig = { apiKey, authConfigIds: {} };
  const publicConfig = (): PublicComposioConfig => ({
    configured: Boolean(config.apiKey),
    apiKeyTail: config.apiKey.slice(-4),
  });
  return {
    read: () => ({ apiKey: config.apiKey, authConfigIds: { ...config.authConfigIds } }),
    readPublic: publicConfig,
    write: (input) => {
      const value = input && typeof input === 'object' ? input as Partial<ComposioConfig> : {};
      config = {
        apiKey: typeof value.apiKey === 'string' ? value.apiKey : config.apiKey,
        authConfigIds: value.authConfigIds ? { ...value.authConfigIds } : config.authConfigIds,
      };
      return publicConfig();
    },
    setAuthConfigId: (connectorId, authConfigId) => {
      config = { ...config, authConfigIds: { ...config.authConfigIds, [connectorId]: authConfigId } };
    },
    deleteAuthConfigId: (connectorId) => {
      const authConfigIds = { ...config.authConfigIds };
      delete authConfigIds[connectorId];
      config = { ...config, authConfigIds };
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
  return typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : undefined;
}

describe('ComposioConnectorProvider', () => {
  it('uses the offline catalog without API or filesystem access', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('fetch must not run');
    }) as unknown as typeof fetch;
    const provider = new ComposioConnectorProvider({
      userId: 'user_1',
      configStore: createMemoryConfigStore(''),
      fetchFn,
    });

    const first = await provider.listDefinitions();
    first[0]!.name = 'mutated';
    const second = await provider.listDefinitions();

    expect(fetchFn).not.toHaveBeenCalled();
    expect(second[0]!.name).not.toBe('mutated');
    expect(second.every((definition) => definition.authentication === 'composio')).toBe(true);
  });

  it('uses current API versions and requests the latest toolkit tools', async () => {
    const requests: RecordedRequest[] = [];
    const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      requests.push({ url, init, body: bodyFrom(init) });
      if (url.pathname === '/api/v3.1/auth_configs') {
        return jsonResponse({ items: [{ id: 'auth_1', status: 'ENABLED', toolkit: { slug: 'GITHUB' } }] });
      }
      if (url.pathname === '/api/v3.1/toolkits') {
        return jsonResponse({ items: [{ slug: 'GITHUB', name: 'GitHub', meta: { tools_count: 99 } }] });
      }
      if (url.pathname === '/api/v3.1/tools') {
        return jsonResponse({
          items: [{
            slug: 'GITHUB_LIST_REPOSITORIES',
            name: 'List repositories',
            description: 'List repositories visible to the user.',
            scopes: ['read'],
            toolkit: { slug: 'GITHUB' },
            input_parameters: { type: 'object', additionalProperties: false },
          }],
          total_items: 99,
          next_cursor: 'next-page',
        });
      }
      throw new Error(`unexpected request: ${url.pathname}`);
    }) as unknown as typeof fetch;
    const provider = new ComposioConnectorProvider({
      userId: 'user_1',
      configStore: createMemoryConfigStore(),
      fetchFn,
    });

    const preview = await provider.getPreviewDefinition('github', { toolsLimit: 1 });
    const toolsRequest = requests.find((request) => request.url.pathname === '/api/v3.1/tools')!;

    expect(preview).toMatchObject({
      id: 'github',
      toolCount: 99,
      toolsNextCursor: 'next-page',
      toolsHasMore: true,
    });
    expect(preview?.allowedToolNames).toContain('github.github_list_repositories');
    expect(toolsRequest.url.searchParams.get('toolkit_versions')).toBe('latest');
    expect(toolsRequest.url.searchParams.get('toolkit_slug')).toBe('github');
    expect(requests.some((request) => request.url.pathname === '/api/v3.1/auth_configs')).toBe(true);
    expect(requests.some((request) => request.url.pathname === '/api/v3.1/toolkits')).toBe(true);
  });

  it('creates a hosted auth link, validates ownership, executes, and deletes through v3 contracts', async () => {
    const requests: RecordedRequest[] = [];
    let callbackState = '';
    const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const body = bodyFrom(init);
      requests.push({ url, init, body });
      if (url.pathname === '/api/v3.1/auth_configs' && init?.method === 'GET') {
        return jsonResponse({ items: [] });
      }
      if (url.pathname === '/api/v3.1/auth_configs' && init?.method === 'POST') {
        return jsonResponse({ id: 'auth_1', status: 'ENABLED', toolkit: { slug: 'GITHUB' } }, 201);
      }
      if (url.pathname === '/api/v3/connected_accounts/link') {
        callbackState = new URL(String(body?.callback_url)).searchParams.get('state') ?? '';
        return jsonResponse({
          connected_account_id: 'ca_1',
          redirect_url: 'https://connect.composio.dev/link_1',
          expires_at: '2026-07-23T01:00:00.000Z',
        }, 201);
      }
      if (url.pathname === '/api/v3/connected_accounts/ca_1' && init?.method === 'GET') {
        return jsonResponse({
          id: 'ca_1',
          status: 'ACTIVE',
          user_id: 'user_1',
          account_label: 'octocat',
          auth_config: { id: 'auth_1' },
          toolkit: { slug: 'GITHUB' },
        });
      }
      if (url.pathname === '/api/v3.1/tools/execute/GITHUB_SEARCH_REPOSITORIES') {
        return jsonResponse({ successful: true, data: { count: 1 }, log_id: 'log_1' });
      }
      if (url.pathname === '/api/v3/connected_accounts/ca_1' && init?.method === 'DELETE') {
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected request: ${init?.method} ${url.pathname}`);
    }) as unknown as typeof fetch;
    const store = createMemoryConfigStore();
    const provider = new ComposioConnectorProvider({
      userId: 'user_1',
      configStore: store,
      fetchFn,
    });
    const github = getStaticComposioCatalogDefinitions().find((definition) => definition.id === 'github')!;
    const tool = github.tools.find((candidate) => candidate.providerToolId === 'GITHUB_SEARCH_REPOSITORIES')!;

    const start = await provider.connect(github, 'https://host.example/callback');
    expect(start).toMatchObject({
      kind: 'redirect_required',
      redirectUrl: 'https://connect.composio.dev/link_1',
      providerConnectionId: 'ca_1',
    });
    expect(callbackState).not.toBe('');
    expect(requests.find((request) => request.url.pathname.endsWith('/link'))?.body).toEqual({
      auth_config_id: 'auth_1',
      user_id: 'user_1',
      callback_url: expect.stringContaining(`state=${callbackState}`),
    });

    const completion = await provider.completeConnection({
      definition: github,
      state: callbackState,
      providerConnectionId: 'ca_1',
      status: 'success',
    });
    expect(completion).toEqual({
      connectorId: 'github',
      accountLabel: 'octocat',
      credentials: {
        provider: 'composio',
        providerConnectionId: 'ca_1',
        userId: 'user_1',
        connectorId: 'github',
        toolkitSlug: 'GITHUB',
        authConfigId: 'auth_1',
        validatedAt: expect.any(String),
      },
    });

    const output = await provider.execute(github, tool, { query: 'jini' }, completion.credentials);
    expect(output).toEqual({
      toolName: tool.name,
      providerToolId: 'GITHUB_SEARCH_REPOSITORIES',
      data: { count: 1 },
      providerExecutionId: 'log_1',
    });
    const execute = requests.find((request) => request.url.pathname.includes('/tools/execute/'))!;
    expect(execute.body).toEqual({
      connected_account_id: 'ca_1',
      user_id: 'user_1',
      version: 'latest',
      arguments: { query: 'jini' },
    });

    await provider.disconnect(github, completion.credentials);
    expect(requests.some((request) => (
      request.url.pathname === '/api/v3/connected_accounts/ca_1'
      && request.init?.method === 'DELETE'
    ))).toBe(true);
  });

  it('rejects non-active accounts and maps transport failures to typed errors', async () => {
    const github = getStaticComposioCatalogDefinitions().find((definition) => definition.id === 'github')!;
    const store = createMemoryConfigStore();
    store.setAuthConfigId('github', 'auth_1');
    let state = '';
    const inactiveFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/link')) {
        state = new URL(String(bodyFrom(init)?.callback_url)).searchParams.get('state') ?? '';
        return jsonResponse({ connected_account_id: 'ca_1', redirect_url: 'https://connect.example' }, 201);
      }
      return jsonResponse({
        id: 'ca_1',
        status: 'INITIALIZING',
        user_id: 'user_1',
        auth_config: { id: 'auth_1' },
        toolkit: { slug: 'GITHUB' },
      });
    }) as unknown as typeof fetch;
    const provider = new ComposioConnectorProvider({
      userId: 'user_1',
      configStore: store,
      fetchFn: inactiveFetch,
    });

    await provider.connect(github, 'https://host.example/callback');
    await expect(provider.completeConnection({
      definition: github,
      state,
      providerConnectionId: 'ca_1',
    })).rejects.toMatchObject({
      name: 'ConnectorServiceError',
      status: 409,
      message: 'Composio account is not active',
    });

    const failedProvider = new ComposioConnectorProvider({
      userId: 'user_1',
      configStore: store,
      fetchFn: vi.fn(async () => {
        throw new TypeError('socket failed');
      }) as unknown as typeof fetch,
    });
    const credential = {
      provider: 'composio',
      providerConnectionId: 'ca_1',
      userId: 'user_1',
      connectorId: 'github',
      toolkitSlug: 'GITHUB',
      authConfigId: 'auth_1',
      validatedAt: '2026-07-23T00:00:00.000Z',
    } as const;
    await expect(failedProvider.disconnect(github, credential)).rejects.toBeInstanceOf(ConnectorServiceError);
    await expect(failedProvider.disconnect(github, credential)).rejects.toMatchObject({ status: 502, message: 'Composio request failed' });
  });

  it.each([
    ['missing account id', {
      status: 'ACTIVE',
      user_id: 'user_1',
      auth_config: { id: 'auth_1' },
      toolkit: { slug: 'GITHUB' },
    }],
    ['mismatched account id', {
      id: 'ca_other',
      status: 'ACTIVE',
      user_id: 'user_1',
      auth_config: { id: 'auth_1' },
      toolkit: { slug: 'GITHUB' },
    }],
    ['missing user id', {
      id: 'ca_1',
      status: 'ACTIVE',
      auth_config: { id: 'auth_1' },
      toolkit: { slug: 'GITHUB' },
    }],
    ['mismatched user id', {
      id: 'ca_1',
      status: 'ACTIVE',
      user_id: 'user_other',
      auth_config: { id: 'auth_1' },
      toolkit: { slug: 'GITHUB' },
    }],
    ['missing auth config', {
      id: 'ca_1',
      status: 'ACTIVE',
      user_id: 'user_1',
      toolkit: { slug: 'GITHUB' },
    }],
    ['mismatched auth config', {
      id: 'ca_1',
      status: 'ACTIVE',
      user_id: 'user_1',
      auth_config: { id: 'auth_other' },
      toolkit: { slug: 'GITHUB' },
    }],
    ['missing toolkit', {
      id: 'ca_1',
      status: 'ACTIVE',
      user_id: 'user_1',
      auth_config: { id: 'auth_1' },
    }],
    ['mismatched toolkit', {
      id: 'ca_1',
      status: 'ACTIVE',
      user_id: 'user_1',
      auth_config: { id: 'auth_1' },
      toolkit: { slug: 'SLACK' },
    }],
  ])('fails closed when an ACTIVE account has %s', async (_label, connectedAccount) => {
    const github = getStaticComposioCatalogDefinitions().find((definition) => definition.id === 'github')!;
    const store = createMemoryConfigStore();
    store.setAuthConfigId('github', 'auth_1');
    let state = '';
    const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/link')) {
        state = new URL(String(bodyFrom(init)?.callback_url)).searchParams.get('state') ?? '';
        return jsonResponse({ connected_account_id: 'ca_1', redirect_url: 'https://connect.example' }, 201);
      }
      if (url.pathname === '/api/v3/connected_accounts/ca_1') return jsonResponse(connectedAccount);
      throw new Error(`unexpected request: ${url.pathname}`);
    }) as unknown as typeof fetch;
    const provider = new ComposioConnectorProvider({
      userId: 'user_1',
      configStore: store,
      fetchFn,
    });

    await provider.connect(github, 'https://host.example/callback');
    await expect(provider.completeConnection({
      definition: github,
      state,
      providerConnectionId: 'ca_1',
    })).rejects.toBeInstanceOf(ConnectorServiceError);
  });

  it('revalidates persisted credentials before execute and delete', async () => {
    const github = getStaticComposioCatalogDefinitions().find((definition) => definition.id === 'github')!;
    const tool = github.tools.find((candidate) => candidate.providerToolId === 'GITHUB_SEARCH_REPOSITORIES')!;
    const credential = {
      provider: 'composio',
      providerConnectionId: 'ca_1',
      userId: 'user_1',
      connectorId: 'github',
      toolkitSlug: 'GITHUB',
      authConfigId: 'auth_1',
      validatedAt: '2026-07-23T00:00:00.000Z',
    } as const;
    const fetchFn = vi.fn(async () => jsonResponse({
      id: 'ca_1',
      status: 'ACTIVE',
      user_id: 'user_other',
      auth_config: { id: 'auth_1' },
      toolkit: { slug: 'GITHUB' },
    })) as unknown as typeof fetch;
    const provider = new ComposioConnectorProvider({
      userId: 'user_1',
      configStore: createMemoryConfigStore(),
      fetchFn,
    });

    await expect(provider.execute(github, tool, { query: 'jini' }, credential)).rejects.toMatchObject({ status: 403 });
    await expect(provider.disconnect(github, credential)).rejects.toMatchObject({ status: 403 });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('redacts provider results and never exposes raw provider failures', async () => {
    const github = getStaticComposioCatalogDefinitions().find((definition) => definition.id === 'github')!;
    const tool = github.tools.find((candidate) => candidate.providerToolId === 'GITHUB_SEARCH_REPOSITORIES')!;
    const credential = {
      provider: 'composio',
      providerConnectionId: 'ca_1',
      userId: 'user_1',
      connectorId: 'github',
      toolkitSlug: 'GITHUB',
      authConfigId: 'auth_1',
      validatedAt: '2026-07-23T00:00:00.000Z',
    } as const;
    let failExecution = false;
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/v3/connected_accounts/ca_1') {
        return jsonResponse({
          id: 'ca_1',
          status: 'ACTIVE',
          user_id: 'user_1',
          auth_config: { id: 'auth_1' },
          toolkit: { slug: 'GITHUB' },
        });
      }
      if (failExecution) {
        return jsonResponse({
          successful: false,
          error: {
            message: 'expired access token',
            api_key: 'provider-secret',
            access_token: 'provider-token',
          },
        });
      }
      return jsonResponse({
        successful: true,
        data: {
          api_key: 'provider-secret',
          apiKey: 'provider-secret-2',
          safe: 'visible',
        },
      });
    }) as unknown as typeof fetch;
    const provider = new ComposioConnectorProvider({
      userId: 'user_1',
      configStore: createMemoryConfigStore(),
      fetchFn,
    });

    await expect(provider.execute(github, tool, { query: 'jini' }, credential)).resolves.toMatchObject({
      data: {
        api_key: '[redacted]',
        apiKey: '[redacted]',
        safe: 'visible',
      },
    });
    failExecution = true;
    const failure = await provider.execute(github, tool, { query: 'jini' }, credential)
      .then(() => undefined, (error: unknown) => error);
    expect(failure).toMatchObject({
      code: 'CONNECTOR_EXECUTION_FAILED',
      details: {
        connectorId: 'github',
        toolName: tool.name,
        authStale: true,
      },
    });
    expect(JSON.stringify(failure)).not.toContain('provider-secret');
    expect(JSON.stringify(failure)).not.toContain('provider-token');
  });

  it('rejects oversized and deeply nested response bodies before returning them', async () => {
    const github = getStaticComposioCatalogDefinitions().find((definition) => definition.id === 'github')!;
    const tool = github.tools.find((candidate) => candidate.providerToolId === 'GITHUB_SEARCH_REPOSITORIES')!;
    const credential = {
      provider: 'composio',
      providerConnectionId: 'ca_1',
      userId: 'user_1',
      connectorId: 'github',
      toolkitSlug: 'GITHUB',
      authConfigId: 'auth_1',
      validatedAt: '2026-07-23T00:00:00.000Z',
    } as const;
    let mode: 'oversized' | 'deep' = 'oversized';
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/v3/connected_accounts/ca_1') {
        return jsonResponse({
          id: 'ca_1',
          status: 'ACTIVE',
          user_id: 'user_1',
          auth_config: { id: 'auth_1' },
          toolkit: { slug: 'GITHUB' },
        });
      }
      if (mode === 'oversized') {
        return new Response(`{"successful":true,"data":{"text":"${'x'.repeat(8 * 1024 * 1024)}"}}`);
      }
      let nested: unknown = 'leaf';
      for (let index = 0; index < 50; index += 1) nested = { nested };
      return jsonResponse({ successful: true, data: nested });
    }) as unknown as typeof fetch;
    const provider = new ComposioConnectorProvider({
      userId: 'user_1',
      configStore: createMemoryConfigStore(),
      fetchFn,
    });

    await expect(provider.execute(github, tool, { query: 'jini' }, credential)).rejects.toMatchObject({
      code: 'CONNECTOR_EXECUTION_FAILED',
      message: 'Composio response exceeded safety limits',
    });
    mode = 'deep';
    await expect(provider.execute(github, tool, { query: 'jini' }, credential)).rejects.toMatchObject({
      code: 'CONNECTOR_EXECUTION_FAILED',
      message: 'Composio response exceeded safety limits',
    });
  });

  it('persists a permission-hardened cache and distrusts cached safety metadata', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jini-composio-cache-'));
    const cachePath = path.join(directory, 'world-writable', 'catalog.json');
    fs.mkdirSync(path.dirname(cachePath), { mode: 0o777 });
    fs.chmodSync(path.dirname(cachePath), 0o777);
    try {
      const fetchFn = vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        if (url.pathname === '/api/v3.1/auth_configs') return jsonResponse({ items: [] });
        if (url.pathname === '/api/v3.1/toolkits') return jsonResponse({ items: [] });
        throw new Error(`unexpected request: ${url.pathname}`);
      }) as unknown as typeof fetch;
      const provider = new ComposioConnectorProvider({
        userId: 'user_1',
        configStore: createMemoryConfigStore(),
        fetchFn,
        catalogCachePath: cachePath,
        now: () => Date.parse('2026-07-23T00:00:00.000Z'),
      });

      await provider.listDefinitions();
      expect(provider.getPersistedCatalogMetadata()).toEqual({
        fetchedAt: '2026-07-23T00:00:00.000Z',
        stale: false,
      });
      expect(fs.statSync(cachePath).mode & 0o777).toBe(0o600);
      expect(fs.statSync(path.dirname(cachePath)).mode & 0o777).toBe(0o700);

      const persisted = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as {
        definitions: Array<{ id: string; tools: Array<Record<string, unknown>>; allowedToolNames: string[] }>;
      };
      const github = persisted.definitions.find((definition) => definition.id === 'github')!;
      github.tools[0] = {
        name: 'github.fake_read',
        title: 'Read repository',
        providerToolId: 'GITHUB_DELETE_REPOSITORY',
        inputSchemaJson: { type: 'object' },
        safety: { sideEffect: 'read', approval: 'auto' },
        refreshEligible: true,
        requiredScopes: [],
      };
      github.allowedToolNames = ['github.fake_read'];
      fs.writeFileSync(cachePath, JSON.stringify(persisted));

      const reloaded = new ComposioConnectorProvider({
        userId: 'user_1',
        configStore: createMemoryConfigStore(''),
        fetchFn: vi.fn(async () => {
          throw new Error('offline cache load must not fetch');
        }) as unknown as typeof fetch,
        catalogCachePath: cachePath,
      });
      const cachedGithub = reloaded.getFastDefinitions().find((definition) => definition.id === 'github')!;
      const cachedTool = cachedGithub.tools.find((tool) => tool.name === 'github.fake_read')!;
      expect(cachedTool.safety).toMatchObject({ sideEffect: 'destructive', approval: 'disabled' });
      expect(cachedTool.refreshEligible).toBe(false);
      expect(cachedGithub.allowedToolNames).not.toContain('github.fake_read');

      fs.writeFileSync(cachePath, '{broken');
      expect(new ComposioConnectorProvider({
        userId: 'user_1',
        configStore: createMemoryConfigStore(''),
        catalogCachePath: cachePath,
      }).getFastDefinitions().length).toBeGreaterThan(0);
      fs.writeFileSync(cachePath, 'x'.repeat(8 * 1024 * 1024 + 1));
      expect(new ComposioConnectorProvider({
        userId: 'user_1',
        configStore: createMemoryConfigStore(''),
        catalogCachePath: cachePath,
      }).getFastDefinitions().length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('supports cache reconfiguration and reports background refresh failures without throwing', async () => {
    vi.useFakeTimers();
    try {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jini-composio-refresh-'));
      const onError = vi.fn();
      const brokenStore: ComposioConfigStore = {
        ...createMemoryConfigStore(),
        read: () => {
          throw new Error('store unavailable');
        },
      };
      const provider = new ComposioConnectorProvider({
        userId: 'user_1',
        configStore: brokenStore,
        onError,
      });
      provider.configureCatalogCache(directory);
      expect(provider.getPersistedCatalogMetadata()).toEqual({ stale: true });
      provider.startCatalogRefreshLoop();

      await vi.advanceTimersByTimeAsync(1);
      provider.stopCatalogRefreshLoop();
      expect(onError).toHaveBeenCalledWith({
        operation: 'catalog-refresh',
        error: expect.objectContaining({ message: 'store unavailable' }),
      });

      const successfulFetch = vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        if (url.pathname === '/api/v3.1/auth_configs') return jsonResponse({ items: [] });
        if (url.pathname === '/api/v3.1/toolkits') return jsonResponse({ items: [] });
        throw new Error(`unexpected request: ${url.pathname}`);
      }) as unknown as typeof fetch;
      const successful = new ComposioConnectorProvider({
        userId: 'user_1',
        configStore: createMemoryConfigStore(),
        fetchFn: successfulFetch,
      });
      successful.startCatalogRefreshLoop();
      successful.stopCatalogRefreshLoop();
      successful.startCatalogRefreshLoop();
      await vi.advanceTimersToNextTimerAsync();
      await vi.advanceTimersToNextTimerAsync();
      successful.stopCatalogRefreshLoop();
      expect(successfulFetch).toHaveBeenCalled();

      const cacheDirectory = path.join(directory, 'cache-target-directory');
      fs.mkdirSync(cacheDirectory);
      const cacheError = vi.fn();
      const unwritableCache = new ComposioConnectorProvider({
        userId: 'user_1',
        configStore: createMemoryConfigStore(),
        fetchFn: successfulFetch,
        catalogCachePath: cacheDirectory,
        onError: cacheError,
      });
      await unwritableCache.listDefinitions();
      expect(cacheError).toHaveBeenCalledWith({
        operation: 'catalog-cache-write',
        error: expect.any(Error),
      });
      fs.rmSync(directory, { recursive: true, force: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('surfaces custom-auth requirements and later accepts an existing enabled config', async () => {
    const github = getStaticComposioCatalogDefinitions().find((definition) => definition.id === 'github')!;
    let existing = false;
    const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/v3.1/auth_configs' && init?.method === 'GET') {
        return jsonResponse({
          items: existing
            ? [{ id: 'auth_existing', status: 'ENABLED', toolkit: { slug: 'GITHUB' } }]
            : [],
        });
      }
      if (url.pathname === '/api/v3.1/auth_configs' && init?.method === 'POST') {
        return jsonResponse({ message: 'default auth config not found for project', api_key: 'do-not-leak' }, 400);
      }
      throw new Error(`unexpected request: ${init?.method} ${url.pathname}`);
    }) as unknown as typeof fetch;
    const provider = new ComposioConnectorProvider({
      userId: 'user_1',
      configStore: createMemoryConfigStore(),
      fetchFn,
    });

    await expect(provider.prepareAuthConfig(github)).resolves.toEqual({
      status: 'custom_required',
      message: expect.stringContaining('requires a custom Composio auth config'),
    });
    existing = true;
    await expect(provider.prepareAuthConfig(github)).resolves.toEqual({
      status: 'ready',
      authConfigId: 'auth_existing',
    });
    expect(JSON.stringify(await provider.prepareAuthConfig(github))).not.toContain('do-not-leak');
  });

  it('replaces stale cached auth configuration and handles immediate and cancelled connections', async () => {
    const github = getStaticComposioCatalogDefinitions().find((definition) => definition.id === 'github')!;
    const store = createMemoryConfigStore();
    store.setAuthConfigId('github', 'auth_stale');
    let linkAttempts = 0;
    const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/v3/connected_accounts/link') {
        linkAttempts += 1;
        if (linkAttempts === 1) return jsonResponse({ message: 'stale config' }, 404);
        if (linkAttempts === 2) return jsonResponse({ connected_account_id: 'ca_active', status: 'ACTIVE' }, 201);
        return jsonResponse({ connected_account_id: 'ca_pending', redirect_url: 'https://connect.example' }, 201);
      }
      if (url.pathname === '/api/v3.1/auth_configs' && init?.method === 'GET') return jsonResponse({ items: [] });
      if (url.pathname === '/api/v3.1/auth_configs' && init?.method === 'POST') {
        return jsonResponse({ id: 'auth_fresh', status: 'ENABLED', toolkit: { slug: 'GITHUB' } }, 201);
      }
      if (url.pathname === '/api/v3/connected_accounts/ca_active') {
        return jsonResponse({
          id: 'ca_active',
          status: 'ACTIVE',
          user_id: 'user_1',
          account_label: 'octocat',
          auth_config: { id: 'auth_fresh' },
          toolkit: { slug: 'GITHUB' },
        });
      }
      throw new Error(`unexpected request: ${init?.method} ${url.pathname}`);
    }) as unknown as typeof fetch;
    const provider = new ComposioConnectorProvider({
      userId: 'user_1',
      configStore: store,
      fetchFn,
    });

    const immediate = await provider.connect(github, 'https://host.example/callback');
    expect(immediate).toMatchObject({
      kind: 'connected',
      providerConnectionId: 'ca_active',
      connectorId: 'github',
      accountLabel: 'octocat',
      credentials: { authConfigId: 'auth_fresh' },
    });
    expect(store.read().authConfigIds.github).toBe('auth_fresh');

    const pending = await provider.connect(github, 'https://host.example/callback');
    expect(pending.kind).toBe('redirect_required');
    expect(provider.cancelPendingConnections('slack')).toBe(0);
    expect(provider.cancelPendingConnections('github')).toBe(1);
    await expect(provider.completeConnection({
      definition: github,
      state: 'missing',
      providerConnectionId: 'ca_pending',
    })).rejects.toMatchObject({ status: 400, message: 'Composio OAuth state is missing or expired' });
  });

  it('rejects an ACTIVE link response that has no connected account identity', async () => {
    const github = getStaticComposioCatalogDefinitions().find((definition) => definition.id === 'github')!;
    const store = createMemoryConfigStore();
    store.setAuthConfigId('github', 'auth_1');
    const provider = new ComposioConnectorProvider({
      userId: 'user_1',
      configStore: store,
      fetchFn: vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        if (url.pathname === '/api/v3/connected_accounts/link') {
          return jsonResponse({ status: 'ACTIVE' }, 201);
        }
        throw new Error(`unexpected request: ${url.pathname}`);
      }) as unknown as typeof fetch,
    });

    await expect(provider.connect(
      github,
      'https://host.example/callback',
    )).rejects.toMatchObject({
      name: 'ConnectorServiceError',
      code: 'CONNECTOR_EXECUTION_FAILED',
      status: 502,
    });
  });

  it('rejects invalid construction and unconfigured or cancelled requests with typed errors', async () => {
    expect(() => new ComposioConnectorProvider({
      userId: ' ',
      configStore: createMemoryConfigStore(),
    })).toThrow('userId');
    for (const timeoutMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => new ComposioConnectorProvider({
        userId: 'user_1',
        configStore: createMemoryConfigStore(),
        timeoutMs,
      })).toThrow('timeoutMs');
    }

    const github = getStaticComposioCatalogDefinitions().find((definition) => definition.id === 'github')!;
    const unconfigured = new ComposioConnectorProvider({
      userId: 'user_1',
      configStore: createMemoryConfigStore(''),
    });
    await expect(unconfigured.connect(github, 'https://host.example/callback')).rejects.toMatchObject({
      status: 503,
      message: 'Composio provider is not configured',
    });

    const cancelled = new ComposioConnectorProvider({
      userId: 'user_1',
      configStore: createMemoryConfigStore(),
      fetchFn: vi.fn(async () => {
        throw new DOMException('cancelled', 'AbortError');
      }) as unknown as typeof fetch,
    });
    await expect(cancelled.connect(github, 'https://host.example/callback')).rejects.toMatchObject({
      status: 504,
      message: 'Composio request was cancelled or timed out',
    });
  });

  it('guards the public execution boundary independently of the service layer', async () => {
    const github = getStaticComposioCatalogDefinitions().find((definition) => definition.id === 'github')!;
    const tool = github.tools.find((candidate) => candidate.providerToolId === 'GITHUB_SEARCH_REPOSITORIES')!;
    const credential = {
      provider: 'composio',
      providerConnectionId: 'ca_1',
      userId: 'user_1',
      connectorId: 'github',
      toolkitSlug: 'GITHUB',
      authConfigId: 'auth_1',
      validatedAt: '2026-07-23T00:00:00.000Z',
    } as const;
    const fetchFn = vi.fn(async () => {
      throw new Error('denied requests must not reach the network');
    }) as unknown as typeof fetch;
    const provider = new ComposioConnectorProvider({
      userId: 'user_1',
      configStore: createMemoryConfigStore(),
      fetchFn,
    });

    await expect(provider.execute(github, tool, { query: 'jini' }, undefined)).rejects.toMatchObject({
      code: 'CONNECTOR_NOT_CONNECTED',
    });
    await expect(provider.execute(github, tool, { query: 'jini' }, {
      ...credential,
      connectorId: 'slack',
    })).rejects.toMatchObject({ code: 'CONNECTOR_NOT_CONNECTED' });
    await expect(provider.execute(github, {
      ...tool,
      providerToolId: 'GITHUB_DELETE_REPOSITORY',
    }, { query: 'jini' }, credential)).rejects.toMatchObject({
      code: 'CONNECTOR_SAFETY_DENIED',
    });
    await expect(provider.execute(github, {
      ...tool,
      inputSchemaUnsupportedReason: 'unsupported $ref',
      refreshEligible: false,
    }, { query: 'jini' }, credential)).rejects.toMatchObject({
      code: 'CONNECTOR_INPUT_SCHEMA_MISMATCH',
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('treats disconnect as idempotent only for absent credentials or provider 404', async () => {
    const github = getStaticComposioCatalogDefinitions().find((definition) => definition.id === 'github')!;
    const credential = {
      provider: 'composio',
      providerConnectionId: 'ca_1',
      userId: 'user_1',
      connectorId: 'github',
      toolkitSlug: 'GITHUB',
      authConfigId: 'auth_1',
      validatedAt: '2026-07-23T00:00:00.000Z',
    } as const;
    let deleteStatus = 404;
    const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (init?.method === 'GET') {
        return jsonResponse({
          id: 'ca_1',
          status: 'ACTIVE',
          user_id: 'user_1',
          auth_config: { id: 'auth_1' },
          toolkit: { slug: 'GITHUB' },
        });
      }
      if (init?.method === 'DELETE') return jsonResponse({}, deleteStatus);
      throw new Error(`unexpected request: ${url.pathname}`);
    }) as unknown as typeof fetch;
    const provider = new ComposioConnectorProvider({
      userId: 'user_1',
      configStore: createMemoryConfigStore(),
      fetchFn,
    });

    await expect(provider.disconnect(github, undefined)).resolves.toBeUndefined();
    expect(fetchFn).not.toHaveBeenCalled();
    await expect(provider.disconnect(github, credential)).resolves.toBeUndefined();
    deleteStatus = 500;
    await expect(provider.disconnect(github, credential)).rejects.toMatchObject({
      status: 502,
      message: 'Composio disconnect failed with HTTP 500',
    });
  });

  it('maps malformed, invalid, and secret-bearing HTTP failures without reflecting provider data', async () => {
    const github = getStaticComposioCatalogDefinitions().find((definition) => definition.id === 'github')!;
    const modes: Array<{ response: Response; expected: string; status?: number }> = [
      { response: new Response('{broken'), expected: 'Composio returned malformed JSON' },
      { response: jsonResponse([]), expected: 'Composio returned an invalid response' },
      {
        response: jsonResponse({
          error: { message: 'unauthorized provider-secret', suggested_fix: 'use api_key provider-secret' },
        }, 401),
        expected: 'Composio authentication failed',
        status: 401,
      },
    ];
    for (const mode of modes) {
      const provider = new ComposioConnectorProvider({
        userId: 'user_1',
        configStore: (() => {
          const store = createMemoryConfigStore();
          store.setAuthConfigId('github', 'auth_1');
          return store;
        })(),
        fetchFn: vi.fn(async () => mode.response) as unknown as typeof fetch,
      });
      const failure = await provider.connect(github, 'https://host.example/callback')
        .then(() => undefined, (error: unknown) => error);
      expect(failure).toMatchObject({
        message: mode.expected,
        ...(mode.status === undefined ? {} : { status: mode.status }),
      });
      expect(JSON.stringify(failure)).not.toContain('provider-secret');
    }
  });

  it('hydrates heterogeneous provider tools conservatively and ignores generic metadata', async () => {
    const example = getStaticComposioCatalogDefinitions({
      toolkits: [],
      featuredCatalog: [{
        id: 'example',
        name: 'Example',
        provider: 'composio',
        category: 'Fallback',
        description: 'Safe fallback description.',
        authentication: 'composio',
        providerConnectorId: 'EXAMPLE',
        tools: [],
        allowedToolNames: [],
      }],
    })[0]!;
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/v3.1/auth_configs') return jsonResponse({ data: [] });
      if (url.pathname === '/api/v3.1/toolkits') {
        return jsonResponse({
          data: [{
            slug: 'EXAMPLE',
            name: 'Live Example',
            meta: {
              description: 'Connect to Example through Composio.',
              categories: [{ slug: 'developer-tools' }],
              toolsCount: 4,
            },
          }],
        });
      }
      if (url.pathname === '/api/v3.1/tools') {
        return jsonResponse({
          data: [
            {
              slug: 'EXAMPLE_LIST_ALL',
              name: 'List all',
              human_description: 'List all records.',
              oauth_scopes: [' read ', '', 42],
              toolkit: { slug: 'EXAMPLE' },
              input_parameters: true,
            },
            {
              slug: 'EXAMPLE_DELETE_ALL',
              name: 'Delete all',
              toolkit: { slug: 'EXAMPLE' },
              inputParameters: false,
            },
            {
              slug: 'EXAMPLE_QUERY_ALL',
              name: 'Query all',
              description: 'Read all records without modifying them.',
              scopes: ['read'],
              toolkit: { slug: 'EXAMPLE' },
              input_parameters: { type: 'object', additionalProperties: false },
            },
            {
              name: 'Find raw',
              humanDescription: 'Find records.',
              tags: ['read'],
              toolkit: { slug: 'EXAMPLE' },
              input_parameters: 'not-a-schema',
            },
            {
              toolkit: { slug: 'EXAMPLE' },
              input_parameters: { type: 'object' },
            },
            {
              slug: 'OTHER_LIST',
              toolkit: { slug: 'OTHER' },
              input_parameters: { type: 'object' },
            },
          ],
          totalItems: 5,
          nextCursor: 'page-2',
        });
      }
      throw new Error(`unexpected request: ${url.pathname}`);
    }) as unknown as typeof fetch;
    const provider = new ComposioConnectorProvider({
      userId: 'user_1',
      configStore: createMemoryConfigStore(),
      featuredCatalog: [example],
      curationOverlay: {
        example: {
          example_list_all: { reason: 'Host-approved read path.' },
        },
      },
      fetchFn,
    });

    const preview = await provider.getPreviewDefinition('example', {
      toolsLimit: 10,
      toolsCursor: 'cursor-1',
    });
    expect(preview).toMatchObject({
      name: 'Live Example',
      category: 'developer-tools',
      description: 'Safe fallback description.',
      toolCount: 5,
      toolsNextCursor: 'page-2',
      toolsHasMore: true,
    });
    expect(preview?.tools.find((tool) => tool.providerToolId === 'EXAMPLE_LIST_ALL')).toMatchObject({
      refreshEligible: true,
      curation: { reason: 'Host-approved read path.' },
      requiredScopes: ['read'],
    });
    expect(preview?.allowedToolNames).toContain('example.example_list_all');
    expect(preview?.allowedToolNames).not.toContain('example.example_query_all');
    expect(preview?.tools.find((tool) => tool.providerToolId === 'EXAMPLE_QUERY_ALL')).toMatchObject({
      refreshEligible: false,
    });
    expect(preview?.tools.find((tool) => tool.providerToolId === 'EXAMPLE_DELETE_ALL')).toMatchObject({
      refreshEligible: false,
      safety: { sideEffect: 'destructive', approval: 'disabled' },
    });
    expect(preview?.tools.find((tool) => tool.providerToolId === 'Find raw')).toMatchObject({
      refreshEligible: false,
      inputSchemaUnsupportedReason: expect.stringContaining('not a JSON Schema'),
    });
    expect(preview?.tools.find((tool) => tool.providerToolId === 'EXAMPLE_TOOL')?.title).toBe('Example Tool');
    expect(preview?.tools.some((tool) => tool.providerToolId === 'OTHER_LIST')).toBe(false);
  });

  it('converts Composio parameter-map input_parameters into JSON Schema', async () => {
    const provider = new ComposioConnectorProvider({
      userId: 'user_1',
      configStore: createMemoryConfigStore(),
      featuredCatalog: [{
        id: 'example',
        name: 'Example',
        provider: 'composio',
        category: 'Fallback',
        authentication: 'composio',
        providerConnectorId: 'EXAMPLE',
        tools: [],
        allowedToolNames: [],
      }],
      fetchFn: vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        if (url.pathname === '/api/v3.1/auth_configs') return jsonResponse({ items: [] });
        if (url.pathname === '/api/v3.1/toolkits') return jsonResponse({ items: [] });
        if (url.pathname === '/api/v3.1/tools') {
          return jsonResponse({
            items: [{
              slug: 'EXAMPLE_GET_WORKFLOW',
              name: 'Get workflow',
              toolkit: { slug: 'EXAMPLE' },
              input_parameters: {
                repo_name: {
                  type: 'string',
                  description: 'Repository name.',
                  required: true,
                },
                workflow_id: {
                  type: 'string',
                  description: 'Workflow identifier.',
                  required: false,
                },
              },
            }, {
              slug: 'EXAMPLE_FIND_WORKFLOW',
              name: 'Find workflow',
              toolkit: { slug: 'EXAMPLE' },
              input_parameters: {
                query: {
                  type: 'string',
                  pattern: '^safe$',
                  required: true,
                },
              },
            }, {
              slug: 'EXAMPLE_INVALID_PARAMETER',
              name: 'Invalid parameter',
              toolkit: { slug: 'EXAMPLE' },
              input_parameters: {
                query: 'not-a-schema-object',
              },
            }, {
              slug: 'EXAMPLE_INVALID_REQUIRED',
              name: 'Invalid required',
              toolkit: { slug: 'EXAMPLE' },
              input_parameters: {
                query: {
                  type: 'string',
                  required: 'yes',
                },
              },
            }],
          });
        }
        throw new Error(`unexpected request: ${url.pathname}`);
      }) as unknown as typeof fetch,
    });

    const preview = await provider.getPreviewDefinition('example', { toolsLimit: 10 });
    expect(preview?.tools.find((tool) => tool.providerToolId === 'EXAMPLE_GET_WORKFLOW')).toMatchObject({
      inputSchemaJson: {
        type: 'object',
        properties: {
          repo_name: {
            type: 'string',
            description: 'Repository name.',
          },
          workflow_id: {
            type: 'string',
            description: 'Workflow identifier.',
          },
        },
        required: ['repo_name'],
        additionalProperties: false,
      },
      inputSchemaUnsupportedReason: undefined,
    });
    expect(preview?.tools.find((tool) => tool.providerToolId === 'EXAMPLE_FIND_WORKFLOW')).toMatchObject({
      refreshEligible: false,
      inputSchemaUnsupportedReason: expect.stringContaining('unsupported'),
    });
    expect(preview?.tools.find((tool) => tool.providerToolId === 'EXAMPLE_INVALID_PARAMETER')).toMatchObject({
      refreshEligible: false,
      inputSchemaUnsupportedReason: expect.stringContaining('not a schema object'),
    });
    expect(preview?.tools.find((tool) => tool.providerToolId === 'EXAMPLE_INVALID_REQUIRED')).toMatchObject({
      refreshEligible: false,
      inputSchemaUnsupportedReason: expect.stringContaining('invalid required annotation'),
    });
  });

  it('rethrows unexpected credential guard failures instead of treating them as disconnection', () => {
    const github = getStaticComposioCatalogDefinitions()
      .find((definition) => definition.id === 'github')!;
    const provider = new ComposioConnectorProvider({
      userId: 'user_1',
      configStore: createMemoryConfigStore(),
    });
    const unexpected = new Error('credential getter failed');
    const credentials = new Proxy({}, {
      get() {
        throw unexpected;
      },
    });

    expect(() => provider.credentialMatchesDefinition(github, credentials as never)).toThrow(unexpected);
  });

  it('rejects every invalid OAuth callback transition before account use', async () => {
    const github = getStaticComposioCatalogDefinitions().find((definition) => definition.id === 'github')!;
    const slack = getStaticComposioCatalogDefinitions().find((definition) => definition.id === 'slack')!;
    const store = createMemoryConfigStore();
    let now = 0;
    let authConfigsAvailable = true;
    let linkIndex = 0;
    const states: string[] = [];
    const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/v3.1/auth_configs') {
        return jsonResponse({
          items: authConfigsAvailable
            ? [{ id: 'auth_1', status: 'ENABLED', toolkit: { slug: 'GITHUB' } }]
            : [],
        });
      }
      if (url.pathname === '/api/v3/connected_accounts/link') {
        states.push(new URL(String(bodyFrom(init)?.callback_url)).searchParams.get('state') ?? '');
        linkIndex += 1;
        return jsonResponse({
          ...(linkIndex === 3 ? {} : { connected_account_id: `ca_${linkIndex}` }),
          redirect_url: 'https://connect.example',
        }, 201);
      }
      throw new Error(`unexpected request: ${init?.method} ${url.pathname}`);
    }) as unknown as typeof fetch;
    const provider = new ComposioConnectorProvider({
      userId: 'user_1',
      configStore: store,
      fetchFn,
      now: () => now,
    });

    await provider.connect(github, 'https://host.example/callback');
    await expect(provider.completeConnection({
      definition: github,
      state: states.at(-1)!,
      status: 'denied',
    })).rejects.toMatchObject({ status: 400, message: 'Composio OAuth did not complete successfully' });

    await provider.connect(github, 'https://host.example/callback');
    await expect(provider.completeConnection({
      definition: github,
      state: states.at(-1)!,
      providerConnectionId: 'ca_other',
    })).rejects.toMatchObject({ status: 403, message: 'Composio callback connection id did not match pending connection' });

    await provider.connect(github, 'https://host.example/callback');
    await expect(provider.completeConnection({
      definition: github,
      state: states.at(-1)!,
    })).rejects.toMatchObject({ status: 400, message: 'Composio callback did not include a connection id' });

    await provider.connect(github, 'https://host.example/callback');
    await expect(provider.completeConnection({
      definition: slack,
      state: states.at(-1)!,
      providerConnectionId: 'ca_4',
    })).rejects.toMatchObject({ status: 400, message: 'Composio OAuth state is missing or expired' });

    await provider.connect(github, 'https://host.example/callback');
    store.deleteAuthConfigId('github');
    provider.clearDiscoveryCache();
    authConfigsAvailable = false;
    await expect(provider.completeConnection({
      definition: github,
      state: states.at(-1)!,
      providerConnectionId: 'ca_5',
    })).rejects.toMatchObject({ status: 409, message: 'Composio OAuth auth configuration is missing' });

    authConfigsAvailable = true;
    await provider.connect(github, 'https://host.example/callback');
    now = 11 * 60_000;
    await expect(provider.completeConnection({
      definition: github,
      state: states.at(-1)!,
      providerConnectionId: 'ca_6',
    })).rejects.toMatchObject({ status: 400, message: 'Composio OAuth state is missing or expired' });
  });

  it('deduplicates auth-config creation and fails closed on malformed provider identities', async () => {
    const example = getStaticComposioCatalogDefinitions({
      toolkits: [],
      featuredCatalog: [{
        id: 'example',
        name: 'Example',
        provider: 'composio',
        category: 'Test',
        authentication: 'composio',
        providerConnectorId: 'EXAMPLE',
        tools: [],
        allowedToolNames: [],
      }],
    })[0]!;
    let posts = 0;
    const concurrent = new ComposioConnectorProvider({
      userId: 'user_1',
      configStore: createMemoryConfigStore(),
      featuredCatalog: [example],
      fetchFn: vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        if (init?.method === 'GET') return jsonResponse({ items: [] });
        posts += 1;
        await Promise.resolve();
        return jsonResponse({ id: 'auth_1', toolkit: { slug: 'EXAMPLE' } }, 201);
      }) as unknown as typeof fetch,
    });
    await expect(Promise.all([
      concurrent.prepareAuthConfig(example),
      concurrent.prepareAuthConfig(example),
    ])).resolves.toEqual([
      { status: 'ready', authConfigId: 'auth_1' },
      { status: 'ready', authConfigId: 'auth_1' },
    ]);
    expect(posts).toBe(1);

    const malformedCases: Array<[unknown, string]> = [
      [{ toolkit: { slug: 'EXAMPLE' } }, 'missing an id or toolkit slug'],
      [{ id: 'auth_1', toolkit: { slug: 'SLACK' } }, 'different toolkit'],
    ];
    for (const [created, message] of malformedCases) {
      const provider = new ComposioConnectorProvider({
        userId: 'user_1',
        configStore: createMemoryConfigStore(),
        featuredCatalog: [example],
        fetchFn: vi.fn(async (_input: string | URL | Request, init?: RequestInit) => (
          init?.method === 'GET' ? jsonResponse({ items: [] }) : jsonResponse(created, 201)
        )) as unknown as typeof fetch,
      });
      await expect(provider.prepareAuthConfig(example)).resolves.toMatchObject({
        status: 'error',
        message: expect.stringContaining(message),
      });
    }

    const noToolkit = { ...example };
    delete noToolkit.providerConnectorId;
    const missingToolkitProvider = new ComposioConnectorProvider({
      userId: 'user_1',
      configStore: createMemoryConfigStore(),
      featuredCatalog: [noToolkit],
      fetchFn: vi.fn(async () => jsonResponse({ items: [] })) as unknown as typeof fetch,
    });
    await expect(missingToolkitProvider.prepareAuthConfig(noToolkit)).resolves.toMatchObject({
      status: 'error',
      message: expect.stringContaining('missing a toolkit slug'),
    });
    await expect(concurrent.prepareAuthConfig({
      ...example,
      authentication: 'oauth',
    })).resolves.toEqual({
      status: 'error',
      message: 'connector is not backed by Composio',
    });

    const genericFailure = new ComposioConnectorProvider({
      userId: 'user_1',
      configStore: createMemoryConfigStore(),
      featuredCatalog: [example],
      fetchFn: vi.fn(async (_input: string | URL | Request, init?: RequestInit) => (
        init?.method === 'GET'
          ? jsonResponse({ items: [] })
          : jsonResponse({ message: 'provider-internal-secret' }, 500)
      )) as unknown as typeof fetch,
    });
    const failure = await genericFailure.prepareAuthConfig(example);
    expect(failure).toMatchObject({ status: 'error', message: 'Composio request failed with HTTP 500' });
    expect(JSON.stringify(failure)).not.toContain('provider-internal-secret');
  });

  it('fails closed for strict preview, aggregate hydration, and execution hydration while retaining display fallback', async () => {
    const github = getStaticComposioCatalogDefinitions().find((definition) => definition.id === 'github')!;
    for (const response of [
      jsonResponse({ error: { message: 'unauthorized api_key secret' } }, 401),
      jsonResponse([]),
    ]) {
      const provider = new ComposioConnectorProvider({
        userId: 'user_1',
        configStore: createMemoryConfigStore(),
        fetchFn: vi.fn(async (input: string | URL | Request) => {
          const url = new URL(String(input));
          if (url.pathname === '/api/v3.1/auth_configs') return jsonResponse({ items: [] });
          if (url.pathname === '/api/v3.1/toolkits') return jsonResponse({ items: [] });
          if (url.pathname === '/api/v3.1/tools') return response;
          throw new Error(`unexpected request: ${url.pathname}`);
        }) as unknown as typeof fetch,
      });
      await expect(provider.getPreviewDefinition('github', { toolsLimit: 1 })).rejects.toBeInstanceOf(ConnectorServiceError);
    }

    const fallbackFetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/v3.1/auth_configs') return jsonResponse({ items: [] });
      if (url.pathname === '/api/v3.1/toolkits') throw new Error('toolkit discovery unavailable');
      if (url.pathname === '/api/v3.1/tools') throw new Error('tool discovery unavailable');
      throw new Error(`unexpected request: ${url.pathname}`);
    });
    const fallback = new ComposioConnectorProvider({
      userId: 'user_1',
      configStore: createMemoryConfigStore(),
      fetchFn: fallbackFetch as unknown as typeof fetch,
    });
    await expect(fallback.listDefinitions(undefined, { hydrateTools: true })).rejects.toMatchObject({
      code: 'CONNECTOR_EXECUTION_FAILED',
      status: 400,
    });
    expect(fallbackFetch).not.toHaveBeenCalled();
    await expect(fallback.getHydratedDefinition(github.id)).resolves.toMatchObject({
      id: 'github',
      allowedToolNames: github.allowedToolNames,
    });
    await expect(fallback.getHydratedDefinition(
      github.id,
      undefined,
      { requireCurrentTools: true },
    )).rejects.toMatchObject({
      code: 'CONNECTOR_EXECUTION_FAILED',
      status: 502,
    });
  });
});
