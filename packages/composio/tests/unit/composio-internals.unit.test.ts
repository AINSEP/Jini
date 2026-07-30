import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  applyComposioToolCuration,
  cloneConnectorDefinition,
  connectorIdForToolkitSlug,
  fallbackComposioDescription,
  firstCategoryName,
  getComposioAuthConfigId,
  getComposioConnectionId,
  getComposioSafeErrorMessage,
  getComposioToolkitDescription,
  getComposioToolkitSlug,
  getComposioToolkitToolCount,
  getCustomAuthRequiredMessage,
  isCachedAuthConfigRejection,
  isComposioAuthenticationFailure,
  isErrno,
  isGenericComposioDescription,
  mergeToolDefinition,
  normalizePersistedConnectorDefinition,
  normalizePersistedConnectorToolDefinition,
  normalizeToolName,
  readPersistedComposioCatalogCache,
  writePersistedComposioCatalogCache,
  type PersistedComposioCatalogCache,
} from '../../src/composio.js';
import {
  ConnectorServiceError,
  defineConnectorTool,
  type ConnectorCatalogDefinition,
  type ConnectorCatalogToolDefinition,
} from '../../src/index.js';

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jini-composio-internals-'));
  temporaryDirectories.push(directory);
  return directory;
}

function cache(definitions: ConnectorCatalogDefinition[] = []): PersistedComposioCatalogCache {
  return {
    schemaVersion: 1,
    provider: 'composio',
    fetchedAt: '2026-07-24T00:00:00.000Z',
    definitions,
  };
}

function tool(overrides: Partial<ConnectorCatalogToolDefinition> = {}): ConnectorCatalogToolDefinition {
  return {
    ...defineConnectorTool({
      name: 'github.search',
      providerToolId: 'GITHUB_SEARCH',
      title: 'Search',
      description: 'Search without changing provider data.',
      inputSchemaJson: { type: 'object', additionalProperties: false },
      outputSchemaJson: { type: 'object', additionalProperties: true },
      requiredScopes: ['read'],
    }),
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('Composio internal normalization contracts', () => {
  it('merges live tool metadata without discarding static fallback capability', () => {
    const staticTool = {
      ...tool(),
      inputSchemaUnsupportedReason: 'old unsupported reason',
      curation: { useCases: ['static use'], reason: 'static reason' },
    };
    expect(mergeToolDefinition(staticTool, undefined)).toBe(staticTool);

    const sparseLive: ConnectorCatalogToolDefinition = {
      name: staticTool.name,
      title: staticTool.title,
      safety: { sideEffect: 'read', approval: 'auto' },
      refreshEligible: true,
      requiredScopes: [],
    };
    expect(mergeToolDefinition(staticTool, sparseLive)).toMatchObject({
      description: staticTool.description,
      inputSchemaJson: staticTool.inputSchemaJson,
      outputSchemaJson: staticTool.outputSchemaJson,
      providerToolId: staticTool.providerToolId,
      requiredScopes: staticTool.requiredScopes,
      curation: staticTool.curation,
    });
    expect(mergeToolDefinition(staticTool, sparseLive).inputSchemaUnsupportedReason).toBeUndefined();

    const completeLive = {
      ...tool({
        description: 'Live description',
        inputSchemaJson: { type: 'object', properties: { q: { type: 'string' } } },
        outputSchemaJson: { type: 'array' },
        providerToolId: 'LIVE_SEARCH',
        requiredScopes: ['live:read'],
        curation: { useCases: ['live use'] },
      }),
      inputSchemaUnsupportedReason: 'live unsupported reason',
    };
    expect(mergeToolDefinition(staticTool, completeLive)).toMatchObject({
      description: 'Live description',
      inputSchemaJson: completeLive.inputSchemaJson,
      outputSchemaJson: completeLive.outputSchemaJson,
      providerToolId: 'LIVE_SEARCH',
      requiredScopes: ['live:read'],
      curation: { useCases: ['live use'] },
      inputSchemaUnsupportedReason: 'live unsupported reason',
    });

    const noCurationStatic = { ...staticTool, curation: undefined };
    expect(mergeToolDefinition(noCurationStatic, sparseLive).curation).toBeUndefined();
  });

  it('clones every optional definition shape without retaining mutable references', () => {
    const minimalTool: ConnectorCatalogToolDefinition = {
      name: 'minimal.read',
      title: 'Read',
      safety: { sideEffect: 'read', approval: 'auto' },
      refreshEligible: false,
      requiredScopes: [],
    };
    const minimal: ConnectorCatalogDefinition = {
      id: 'minimal',
      name: 'Minimal',
      provider: 'composio',
      category: 'Test',
      authentication: 'composio',
      tools: [minimalTool],
      allowedToolNames: [],
    };
    expect(cloneConnectorDefinition(minimal)).toEqual(minimal);

    const complete: ConnectorCatalogDefinition = {
      ...minimal,
      providerConnectorId: 'MINIMAL',
      tools: [{
        ...tool(),
        inputSchemaUnsupportedReason: 'unsupported',
        curation: { useCases: ['inspect'], reason: 'curated' },
      }],
      allowedToolNames: ['github.search'],
      curatedToolNames: ['github.search'],
      featuredToolNames: ['github.search'],
      toolCount: 12,
      toolsNextCursor: 'cursor_2',
      toolsHasMore: true,
    };
    const cloned = cloneConnectorDefinition(complete);
    expect(cloned).toEqual(complete);
    expect(cloned).not.toBe(complete);
    expect(cloned.tools).not.toBe(complete.tools);
    expect(cloned.tools[0]!.curation).not.toBe(complete.tools[0]!.curation);

    expect(cloneConnectorDefinition({
      ...minimal,
      tools: [
        { ...minimalTool, curation: { useCases: ['use'] } },
        { ...minimalTool, name: 'minimal.reason', curation: { reason: 'reason' } },
      ],
    }).tools).toMatchObject([
      { curation: { useCases: ['use'] } },
      { curation: { reason: 'reason' } },
    ]);
  });

  it('fails closed for malformed cached definitions and retains only callable tools', () => {
    for (const invalid of [
      undefined,
      null,
      [],
      {},
      { id: 1, name: 'Name', provider: 'composio', category: 'Test', authentication: 'composio' },
      { id: 'id', name: 1, provider: 'composio', category: 'Test', authentication: 'composio' },
      { id: 'id', name: 'Name', provider: 'other', category: 'Test', authentication: 'composio' },
      { id: 'id', name: 'Name', provider: 'composio', category: 1, authentication: 'composio' },
      { id: 'id', name: 'Name', provider: 'composio', category: 'Test', authentication: 'other' },
    ]) {
      expect(normalizePersistedConnectorDefinition(invalid)).toBeUndefined();
    }

    const base = {
      id: 'github',
      name: 'GitHub',
      provider: 'composio',
      category: 'Developer',
      authentication: 'composio',
      description: 'Description',
      providerConnectorId: 'GITHUB',
      curatedToolNames: ['github.search', 1],
      featuredToolNames: ['github.search', 1],
      toolCount: 2,
      disabled: false,
      toolsNextCursor: 'next',
      toolsHasMore: true,
      tools: [
        {
          name: 'github.search',
          title: 'Search',
          inputSchemaJson: { type: 'object' },
          outputSchemaJson: { type: 'object' },
          requiredScopes: ['read'],
          providerToolId: 'GITHUB_SEARCH',
        },
        null,
      ],
      allowedToolNames: ['github.search', 'unknown', 1],
    };
    for (const minimumApproval of ['auto', 'confirm', 'disabled'] as const) {
      expect(normalizePersistedConnectorDefinition({ ...base, minimumApproval })).toMatchObject({
        description: 'Description',
        providerConnectorId: 'GITHUB',
        minimumApproval,
        disabled: false,
        toolsNextCursor: 'next',
        toolsHasMore: true,
        allowedToolNames: ['github.search'],
      });
    }

    expect(normalizePersistedConnectorDefinition({
      ...base,
      tools: 'not-an-array',
      allowedToolNames: 'not-an-array',
      toolCount: Number.NaN,
      minimumApproval: 'unknown',
      disabled: 'false',
      toolsNextCursor: 1,
      toolsHasMore: 'true',
    })).toMatchObject({ tools: [], allowedToolNames: [] });
  });

  it('normalizes cached tools across valid, unsupported, and malformed wire shapes', () => {
    for (const invalid of [undefined, null, [], {}, { name: 'only-name' }, { name: 1, title: 'Title' }]) {
      expect(normalizePersistedConnectorToolDefinition(invalid)).toBeUndefined();
    }

    expect(normalizePersistedConnectorToolDefinition({
      name: 'missing.schema',
      title: 'Missing schema',
    })).toMatchObject({
      inputSchemaUnsupportedReason: 'persisted provider input schema is missing or invalid',
      requiredScopes: [],
    });

    expect(normalizePersistedConnectorToolDefinition({
      name: 'full.read',
      title: 'Full read',
      description: 'Description',
      inputSchemaJson: { type: 'object' },
      outputSchemaJson: { type: 'object' },
      curation: {
        useCases: ['one', '', 2, 'two'],
        reason: 'reason',
      },
      requiredScopes: ['read', 2],
      providerToolId: 'FULL_READ',
    })).toMatchObject({
      description: 'Description',
      inputSchemaJson: { type: 'object' },
      outputSchemaJson: { type: 'object' },
      curation: { useCases: ['one', 'two'], reason: 'reason' },
      requiredScopes: ['read'],
      providerToolId: 'FULL_READ',
    });

    for (const curation of [null, 'curation', [], {}, { useCases: false }, { useCases: [] }, { reason: 1 }]) {
      expect(normalizePersistedConnectorToolDefinition({
        name: 'curation.read',
        title: 'Curation read',
        inputSchemaJson: { type: 'object' },
        curation,
        requiredScopes: false,
      })).toBeDefined();
    }

    expect(normalizePersistedConnectorToolDefinition({
      name: 'unsupported.read',
      title: 'Unsupported read',
      inputSchemaJson: { type: 'object', patternProperties: {} },
    })?.inputSchemaUnsupportedReason).toContain('unsupported connector input schema keyword "patternProperties"');
  });

  it('round-trips bounded cache data and treats malformed or absent files as untrusted', () => {
    const directory = temporaryDirectory();
    const filePath = path.join(directory, 'nested', 'cache.json');
    const definition = normalizePersistedConnectorDefinition({
      id: 'github',
      name: 'GitHub',
      provider: 'composio',
      category: 'Developer',
      authentication: 'composio',
      tools: [],
      allowedToolNames: [],
    })!;
    writePersistedComposioCatalogCache(filePath, cache([definition]));
    expect(readPersistedComposioCatalogCache(filePath)).toEqual(cache([definition]));
    expect(fs.statSync(path.dirname(filePath)).mode & 0o777).toBe(0o700);
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
    expect(readPersistedComposioCatalogCache(path.join(directory, 'missing.json'))).toBeUndefined();

    for (const [name, value] of [
      ['null', null],
      ['array', []],
      ['schema', { schemaVersion: 2, provider: 'composio', fetchedAt: 'date', definitions: [] }],
      ['provider', { schemaVersion: 1, provider: 'other', fetchedAt: 'date', definitions: [] }],
      ['date', { schemaVersion: 1, provider: 'composio', fetchedAt: 1, definitions: [] }],
      ['definitions', { schemaVersion: 1, provider: 'composio', fetchedAt: 'date', definitions: 'bad' }],
    ] as const) {
      const malformedPath = path.join(directory, `${name}.json`);
      fs.writeFileSync(malformedPath, JSON.stringify(value));
      expect(readPersistedComposioCatalogCache(malformedPath)).toBeUndefined();
    }
  });

  it('holds the catalog-cache file lock across the atomic rename', () => {
    const directory = temporaryDirectory();
    const filePath = path.join(directory, 'cache.json');
    const renameSync = fs.renameSync.bind(fs);
    let observedLock = false;
    vi.spyOn(fs, 'renameSync').mockImplementation((sourcePath, destinationPath) => {
      observedLock = fs.existsSync(`${filePath}.lock`);
      renameSync(sourcePath, destinationPath);
    });

    writePersistedComposioCatalogCache(filePath, cache());

    expect(observedLock).toBe(true);
  });

  it('bounds cache writes and preserves the most relevant atomic-write failure', () => {
    const directory = temporaryDirectory();
    const filePath = path.join(directory, 'cache.json');
    const hugeDefinition = {
      id: 'huge',
      name: 'Huge',
      provider: 'composio',
      category: 'Test',
      authentication: 'composio',
      description: 'x'.repeat(9 * 1024 * 1024),
      tools: [],
      allowedToolNames: [],
    } satisfies ConnectorCatalogDefinition;
    expect(() => writePersistedComposioCatalogCache(filePath, cache([hugeDefinition]))).toThrow('cache exceeds');

    const renameError = Object.assign(new Error('rename failed'), { code: 'EIO' });
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw renameError;
    });
    vi.spyOn(fs, 'unlinkSync').mockImplementation(() => undefined);
    expect(() => writePersistedComposioCatalogCache(filePath, cache())).toThrow(renameError);

    vi.mocked(fs.unlinkSync).mockImplementation(() => {
      throw Object.assign(new Error('already gone'), { code: 'ENOENT' });
    });
    expect(() => writePersistedComposioCatalogCache(filePath, cache())).toThrow(renameError);

    const cleanupError = Object.assign(new Error('cleanup failed'), { code: 'EACCES' });
    vi.mocked(fs.unlinkSync).mockImplementation(() => {
      throw cleanupError;
    });
    expect(() => writePersistedComposioCatalogCache(filePath, cache())).toThrow(cleanupError);

    expect(isErrno(null, 'ENOENT')).toBe(false);
    expect(isErrno('error', 'ENOENT')).toBe(false);
    expect(isErrno({}, 'ENOENT')).toBe(false);
    expect(isErrno({ code: 'ENOENT' }, 'ENOENT')).toBe(true);
    expect(isErrno({ code: 'EIO' }, 'ENOENT')).toBe(false);
  });
});

describe('Composio internal provider-wire contracts', () => {
  it('normalizes descriptions, counts, identifiers, and categories across provider aliases', () => {
    expect(getComposioToolkitDescription({ meta: { description: 'Meta description' } })).toBe('Meta description');
    expect(getComposioToolkitDescription({ description: 'Top description' })).toBe('Top description');
    expect(getComposioToolkitDescription(undefined)).toBeUndefined();
    expect(getComposioToolkitDescription({ description: 'Connect to GitHub through Composio.' })).toBeUndefined();
    expect(isGenericComposioDescription('Slack integration via Composio')).toBe(true);
    expect(isGenericComposioDescription('Useful description')).toBe(false);

    expect(getComposioToolkitToolCount({ meta: { tools_count: 0 } })).toBe(0);
    expect(getComposioToolkitToolCount({ meta: { toolsCount: 12 } })).toBe(12);
    expect(getComposioToolkitToolCount({ meta: { tools_count: -1, toolsCount: 1.5 } })).toBeUndefined();

    expect(getComposioAuthConfigId({ id: 'auth_direct' })).toBe('auth_direct');
    expect(getComposioAuthConfigId({ auth_config: { id: 'auth_nested' } })).toBe('auth_nested');
    expect(getComposioAuthConfigId({})).toBeUndefined();
    expect(getComposioToolkitSlug({ toolkit: { slug: 'GITHUB' } })).toBe('GITHUB');
    expect(getComposioToolkitSlug({ toolkit_slug: 'SLACK' })).toBe('SLACK');
    expect(getComposioToolkitSlug({ toolkitSlug: 'NOTION' })).toBe('NOTION');
    expect(getComposioToolkitSlug({})).toBeUndefined();
    expect(getComposioConnectionId({ connected_account_id: 'snake' })).toBe('snake');
    expect(getComposioConnectionId({ connectedAccountId: 'camel' })).toBe('camel');
    expect(getComposioConnectionId({ id: 'id' })).toBe('id');
    expect(getComposioConnectionId({ nanoid: 'nano' })).toBe('nano');
    expect(getComposioConnectionId({})).toBeUndefined();

    expect(connectorIdForToolkitSlug('Google Drive')).toBe('google_drive');
    expect(connectorIdForToolkitSlug('GDRIVE')).toBe('google_drive');
    expect(connectorIdForToolkitSlug('drive')).toBe('google_drive');
    expect(connectorIdForToolkitSlug('Git-Hub')).toBe('github');
    expect(normalizeToolName(' Search Repos! ')).toBe('search_repos');
    expect(normalizeToolName('!!!')).toBe('tool');

    expect(firstCategoryName(undefined)).toBeUndefined();
    expect(firstCategoryName([' ', 3, [], {}, { name: 'Developer' }])).toBe('Developer');
    expect(firstCategoryName([{ name: ' ', slug: 'productivity' }])).toBe('productivity');
    expect(firstCategoryName([' Communication '])).toBe('Communication');
    expect(firstCategoryName([null, {}, []])).toBeUndefined();
  });

  it('generates category-aware offline descriptions without collapsing future categories', () => {
    const cases: Array<[string | undefined, string]> = [
      [undefined, 'Use Acme tools and data'],
      ['Project Management', 'Coordinate Acme projects'],
      ['Communication', 'Bring Acme conversations'],
      ['Documentation', 'Search and reuse Acme knowledge'],
      ['Cloud Storage', 'Find and reference Acme files'],
      ['Developer Tools', 'Inspect Acme developer resources'],
      ['CRM', 'Use Acme customer'],
      ['Sales', 'Use Acme customer'],
      ['Marketing', 'Analyze Acme campaigns'],
      ['Finance', 'Work with Acme business'],
      ['Commerce', 'Work with Acme business'],
      ['Observability', 'Surface Acme incidents'],
      ['Data Warehouse', 'Query Acme datasets'],
      ['Future Category', 'Use Acme tools and data'],
    ];
    for (const [category, expected] of cases) {
      expect(fallbackComposioDescription('Acme', category, 'Jini')).toContain(expected);
    }
    expect(fallbackComposioDescription('Acme', 'Developer', 'Jini')).toContain('developer resources');
  });

  it('applies curation and only the explicit read-only safety override', () => {
    const base = tool({
      name: 'notion.notion_search_notion_page',
      providerToolId: 'NOTION_SEARCH_NOTION_PAGE',
    });
    expect(applyComposioToolCuration(base, 'notion', undefined, {})).toBe(base);
    expect(applyComposioToolCuration(base, 'notion', 'OTHER', {})).toBe(base);

    const overlay = {
      notion: {
        notion_search_notion_page: { useCases: ['Find a page'], reason: 'Curated search' },
      },
    } as const;
    expect(applyComposioToolCuration(base, 'notion', 'NOTION_SEARCH_NOTION_PAGE', overlay)).toMatchObject({
      curation: { useCases: ['Find a page'], reason: 'Curated search' },
      safety: { sideEffect: 'read', approval: 'auto' },
      refreshEligible: true,
    });

    const write = {
      ...base,
      safety: { sideEffect: 'write', approval: 'confirm', reason: 'write' } as const,
      refreshEligible: false,
    };
    expect(applyComposioToolCuration(write, 'notion', 'NOTION_SEARCH_NOTION_PAGE', overlay)).toMatchObject({
      safety: { sideEffect: 'write', approval: 'confirm' },
      refreshEligible: false,
    });

    const confirmRead = {
      ...base,
      safety: { sideEffect: 'read', approval: 'confirm', reason: 'confirm' } as const,
      refreshEligible: false,
    };
    expect(applyComposioToolCuration(confirmRead, 'notion', 'NOTION_SEARCH_NOTION_PAGE', overlay)).toMatchObject({
      safety: { sideEffect: 'read', approval: 'confirm' },
    });
  });

  it('classifies nested authentication failures with a bounded traversal', () => {
    for (const failure of [
      401,
      '401',
      'bad credentials',
      'unauthorized',
      'unauthorised',
      'invalid token',
      'invalid access token',
      'token expired',
      'token is expired',
      'expired token',
      'expired access token',
      ['other', { nested: 'bad credentials' }],
      { error: { code: 401 } },
    ]) {
      expect(isComposioAuthenticationFailure(failure)).toBe(true);
    }
    expect(isComposioAuthenticationFailure({ error: ['other', 500] })).toBe(false);
    expect(isComposioAuthenticationFailure(Array.from({ length: 1_100 }, () => 'other'))).toBe(false);
  });

  it('classifies custom-auth and cached-auth errors without broad retries', () => {
    const definition: ConnectorCatalogDefinition = {
      id: 'github',
      name: 'GitHub',
      provider: 'composio',
      category: 'Developer',
      authentication: 'composio',
      tools: [],
      allowedToolNames: [],
    };
    const required = new ConnectorServiceError(
      'CONNECTOR_AUTH_CONFIG_REQUIRED',
      'already sanitized',
      409,
    );
    expect(getCustomAuthRequiredMessage(required, definition)).toBe('already sanitized');
    expect(getCustomAuthRequiredMessage(new Error('default auth config not found'), definition)).toContain('GitHub requires');
    expect(getCustomAuthRequiredMessage('toolkit does not have managed credentials', definition)).toContain('GitHub requires');
    expect(getCustomAuthRequiredMessage(new Error('ordinary failure'), definition)).toBeUndefined();

    expect(isCachedAuthConfigRejection(new Error('400'))).toBe(false);
    expect(isCachedAuthConfigRejection(new ConnectorServiceError('CONNECTOR_EXECUTION_FAILED', 'bad', 502))).toBe(false);
    expect(isCachedAuthConfigRejection(new ConnectorServiceError('CONNECTOR_EXECUTION_FAILED', 'bad', 502, { httpStatus: 400 }))).toBe(true);
    expect(isCachedAuthConfigRejection(new ConnectorServiceError('CONNECTOR_EXECUTION_FAILED', 'missing', 502, { httpStatus: 404 }))).toBe(true);
    expect(isCachedAuthConfigRejection(new ConnectorServiceError('CONNECTOR_EXECUTION_FAILED', 'server', 502, { httpStatus: 500 }))).toBe(false);
  });

  it('extracts only allowlisted safe provider error meanings from every supported shape', async () => {
    const cases: Array<[unknown, string | undefined]> = [
      [{ message: 'default auth config not found' }, 'Default auth config not found'],
      [{ error: { message: 'does not have managed credentials' } }, 'Default auth config not found'],
      [{ error: 'bad credentials' }, 'Composio authentication failed'],
      [{ detail: 'invalid access token' }, 'Composio authentication failed'],
      [{ error: { suggested_fix: 'token expired' } }, 'Composio authentication failed'],
      [{ message: 'internal api_key=must-not-escape' }, undefined],
      [null, undefined],
      [[], undefined],
    ];
    for (const [value, expected] of cases) {
      await expect(getComposioSafeErrorMessage(new Response(JSON.stringify(value)))).resolves.toBe(expected);
    }
    await expect(getComposioSafeErrorMessage(new Response('{malformed'))).resolves.toBeUndefined();
  });
});
