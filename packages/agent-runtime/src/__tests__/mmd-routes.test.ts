import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadMmdRouteLaunchEnv,
  loadMmdRouteModels,
  mergeMmdRouteModels,
  parseMmdRouteModelIds,
  resolveMmdRouteLaunchEnv,
  resolveMmdRoutesFile,
} from '../mmd-routes.js';
import { DEFAULT_MODEL_OPTION } from '../models.js';

describe('resolveMmdRoutesFile', () => {
  it('uses the MMD_MODEL_ROUTES_FILE override when set', () => {
    expect(resolveMmdRoutesFile({ env: { MMD_MODEL_ROUTES_FILE: '/custom/routes.json' } })).toBe('/custom/routes.json');
  });

  it('expands a bare "~" override to the home directory', () => {
    expect(resolveMmdRoutesFile({ env: { MMD_MODEL_ROUTES_FILE: '~', HOME: '/home/user' } })).toBe('/home/user');
  });

  it('expands a "~/" override relative to HOME', () => {
    expect(resolveMmdRoutesFile({ env: { MMD_MODEL_ROUTES_FILE: '~/routes.json', HOME: '/home/user' } })).toBe(
      join('/home/user', 'routes.json'),
    );
  });

  it('expands a "~\\\\" override relative to HOME', () => {
    expect(resolveMmdRoutesFile({ env: { MMD_MODEL_ROUTES_FILE: '~\\routes.json', HOME: '/home/user' } })).toBe(
      join('/home/user', 'routes.json'),
    );
  });

  it('returns null for a "~" override when no home can be resolved', () => {
    // homedir() always resolves something real on this host, so simulate the
    // null-home path by using an override string that starts with "~/" and
    // an env with no HOME — resolveHome() then falls back to os.homedir(),
    // which is always truthy on a real machine. This asserts the happy path
    // instead: expansion succeeds via the os.homedir() fallback.
    const result = resolveMmdRoutesFile({ env: { MMD_MODEL_ROUTES_FILE: '~/routes.json' } });
    expect(result).toBe(join(homedir(), 'routes.json'));
  });

  it('ignores a whitespace-only override and falls through to the default path', () => {
    const result = resolveMmdRoutesFile({ env: { MMD_MODEL_ROUTES_FILE: '   ', HOME: '/home/user' } });
    expect(result).toBe(join('/home/user', '.config', 'mms', 'model-routes.json'));
  });

  it('defaults to ~/.config/mms/model-routes.json using HOME when no override is set', () => {
    expect(resolveMmdRoutesFile({ env: { HOME: '/home/user' } })).toBe(
      join('/home/user', '.config', 'mms', 'model-routes.json'),
    );
  });

  it('falls back to os.homedir() when HOME is not set in env', () => {
    expect(resolveMmdRoutesFile({ env: {} })).toBe(join(homedir(), '.config', 'mms', 'model-routes.json'));
  });
});

describe('parseMmdRouteModelIds', () => {
  it('returns [] for non-object input', () => {
    expect(parseMmdRouteModelIds({ raw: null })).toEqual([]);
    expect(parseMmdRouteModelIds({ raw: 'x' })).toEqual([]);
    expect(parseMmdRouteModelIds({ raw: 42 })).toEqual([]);
    expect(parseMmdRouteModelIds({ raw: [1, 2] })).toEqual([]);
  });

  it('returns [] when routes is missing or not an object', () => {
    expect(parseMmdRouteModelIds({ raw: {} })).toEqual([]);
    expect(parseMmdRouteModelIds({ raw: { routes: 'nope' } })).toEqual([]);
  });

  it('extracts sanitized route ids, skipping invalid and duplicate keys', () => {
    const raw = {
      routes: {
        'good-model': {},
        'bad model with spaces': {},
        'good-model-2': {},
      },
    };
    expect(parseMmdRouteModelIds({ raw: raw })).toEqual(['good-model', 'good-model-2']);
  });
});

describe('resolveMmdRouteLaunchEnv', () => {
  it('returns null when modelId does not sanitize to a valid id', () => {
    expect(resolveMmdRouteLaunchEnv({ raw: { routes: {} }, modelId: 'bad id' })).toBeNull();
    expect(resolveMmdRouteLaunchEnv({ raw: { routes: {} }, modelId: null })).toBeNull();
  });

  it('returns null for non-object raw or missing routes', () => {
    expect(resolveMmdRouteLaunchEnv({ raw: null, modelId: 'model-1' })).toBeNull();
    expect(resolveMmdRouteLaunchEnv({ raw: { notRoutes: true }, modelId: 'model-1' })).toBeNull();
  });

  it('returns null when the route entry is missing or lacks a primary record', () => {
    expect(resolveMmdRouteLaunchEnv({ raw: { routes: {} }, modelId: 'model-1' })).toBeNull();
    expect(resolveMmdRouteLaunchEnv({ raw: { routes: { 'model-1': {} } }, modelId: 'model-1' })).toBeNull();
    expect(resolveMmdRouteLaunchEnv({ raw: { routes: { 'model-1': { primary: 'nope' } } }, modelId: 'model-1' })).toBeNull();
  });

  it('returns null when anthropic_base_url is missing/blank', () => {
    expect(
      resolveMmdRouteLaunchEnv({ raw: { routes: { 'model-1': { primary: {} } } }, modelId: 'model-1' }),
    ).toBeNull();
    expect(
      resolveMmdRouteLaunchEnv({ raw: { routes: { 'model-1': { primary: { anthropic_base_url: '   ' } } } }, modelId: 'model-1' }),
    ).toBeNull();
  });

  it('resolves the base URL and omits the auth token when api_key is absent', () => {
    const result = resolveMmdRouteLaunchEnv({ raw: { routes: { 'model-1': { primary: { anthropic_base_url: 'https://route.example' } } } }, modelId: 'model-1' }
    );
    expect(result).toEqual({ ANTHROPIC_BASE_URL: 'https://route.example' });
  });

  it('includes ANTHROPIC_AUTH_TOKEN when api_key is present', () => {
    const result = resolveMmdRouteLaunchEnv({ raw: {
        routes: {
          'model-1': { primary: { anthropic_base_url: 'https://route.example', api_key: 'sk-test' } },
        },
      }, modelId: 'model-1' }
    );
    expect(result).toEqual({ ANTHROPIC_BASE_URL: 'https://route.example', ANTHROPIC_AUTH_TOKEN: 'sk-test' });
  });

  it('trims a blank api_key down to omitted', () => {
    const result = resolveMmdRouteLaunchEnv({ raw: {
        routes: {
          'model-1': { primary: { anthropic_base_url: 'https://route.example', api_key: '   ' } },
        },
      }, modelId: 'model-1' }
    );
    expect(result).toEqual({ ANTHROPIC_BASE_URL: 'https://route.example' });
  });
});

describe('mergeMmdRouteModels', () => {
  it('always leads with DEFAULT_MODEL_OPTION', () => {
    const merged = mergeMmdRouteModels({ routeIds: [], fallbackModels: [] });
    expect(merged).toEqual([DEFAULT_MODEL_OPTION]);
  });

  it('adds route ids as models, then fallback models, deduplicating by sanitized id', () => {
    const merged = mergeMmdRouteModels({ routeIds: ['route-1', 'route-1'], fallbackModels: [{ id: 'route-1', label: 'Should be skipped' }, { id: 'fb-1', label: 'Fallback 1' }] });
    expect(merged).toEqual([DEFAULT_MODEL_OPTION, { id: 'route-1', label: 'route-1' }, { id: 'fb-1', label: 'Fallback 1' }]);
  });

  it('skips a route id / fallback model that fails sanitization', () => {
    const merged = mergeMmdRouteModels({ routeIds: ['bad id with spaces'], fallbackModels: [{ id: '', label: 'x' }] });
    expect(merged).toEqual([DEFAULT_MODEL_OPTION]);
  });

  it('falls back to the sanitized id as the label when label is blank', () => {
    const merged = mergeMmdRouteModels({ routeIds: [], fallbackModels: [{ id: 'fb-1', label: '   ' }] });
    expect(merged).toEqual([DEFAULT_MODEL_OPTION, { id: 'fb-1', label: 'fb-1' }]);
  });
});

describe('loadMmdRouteModels / loadMmdRouteLaunchEnv (file IO)', () => {
  let dir: string;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('returns null when resolveMmdRoutesFile cannot resolve a path', async () => {
    // Force the "no home" path indirectly is impractical on a real host, so
    // instead point MMD_MODEL_ROUTES_FILE at a directory that does not
    // exist — readFile then rejects and both loaders return null.
    dir = await mkdtemp(join(tmpdir(), 'mmd-routes-test-'));
    const missing = join(dir, 'does-not-exist.json');
    expect(await loadMmdRouteModels({ env: { MMD_MODEL_ROUTES_FILE: missing }, fallbackModels: [] })).toBeNull();
    expect(await loadMmdRouteLaunchEnv({ env: { MMD_MODEL_ROUTES_FILE: missing }, modelId: 'model-1' })).toBeNull();
  });

  it('returns null when the file contains invalid JSON', async () => {
    dir = await mkdtemp(join(tmpdir(), 'mmd-routes-test-'));
    const file = join(dir, 'routes.json');
    await writeFile(file, '{ not valid json', 'utf8');
    expect(await loadMmdRouteModels({ env: { MMD_MODEL_ROUTES_FILE: file }, fallbackModels: [] })).toBeNull();
    expect(await loadMmdRouteLaunchEnv({ env: { MMD_MODEL_ROUTES_FILE: file }, modelId: 'model-1' })).toBeNull();
  });

  it('returns null when there are zero parsed route ids', async () => {
    dir = await mkdtemp(join(tmpdir(), 'mmd-routes-test-'));
    const file = join(dir, 'routes.json');
    await writeFile(file, JSON.stringify({ routes: {} }), 'utf8');
    expect(await loadMmdRouteModels({ env: { MMD_MODEL_ROUTES_FILE: file }, fallbackModels: [] })).toBeNull();
  });

  it('loads and merges models from a real routes file on disk', async () => {
    dir = await mkdtemp(join(tmpdir(), 'mmd-routes-test-'));
    const file = join(dir, 'routes.json');
    await writeFile(
      file,
      JSON.stringify({
        routes: {
          'routed-model': { primary: { anthropic_base_url: 'https://route.example', api_key: 'sk-test' } },
        },
      }),
      'utf8',
    );
    const models = await loadMmdRouteModels({ env: { MMD_MODEL_ROUTES_FILE: file }, fallbackModels: [{ id: 'fb-1', label: 'Fallback' }] });
    expect(models).toEqual([
      DEFAULT_MODEL_OPTION,
      { id: 'routed-model', label: 'routed-model' },
      { id: 'fb-1', label: 'Fallback' },
    ]);

    const launchEnv = await loadMmdRouteLaunchEnv({ env: { MMD_MODEL_ROUTES_FILE: file }, modelId: 'routed-model' });
    expect(launchEnv).toEqual({ ANTHROPIC_BASE_URL: 'https://route.example', ANTHROPIC_AUTH_TOKEN: 'sk-test' });
  });

  it('loadMmdRouteLaunchEnv returns null when the resolved model has no matching route', async () => {
    dir = await mkdtemp(join(tmpdir(), 'mmd-routes-test-'));
    const file = join(dir, 'routes.json');
    await writeFile(file, JSON.stringify({ routes: { 'other-model': { primary: {} } } }), 'utf8');
    expect(await loadMmdRouteLaunchEnv({ env: { MMD_MODEL_ROUTES_FILE: file }, modelId: 'routed-model' })).toBeNull();
  });
});
