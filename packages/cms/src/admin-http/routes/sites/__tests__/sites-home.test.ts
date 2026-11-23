import { describe, expect, it } from 'vitest';
import { RouteRefusalError } from '@jini-ai/core/errors/route-refusal';
import {
  sitesConfigReadRoute, sitesHomeSetRoute, validateSitesSettingsDirectories, parseSitesSettingsDirectory,
  type SitesDirectoryProbe, type SitesHomeSetRouteDeps,
} from '../sites-home.js';

const PREFIX = '/api/admin/v1/workspaces/:workspaceId/system/sites';
const INVALID = 'Choose an absolute folder path for sites settings.';

/** A posix-shaped probe over a fixed table: `kinds` names each existing path; everything else is missing. */
function probe(kinds: Record<string, 'directory' | 'other'> = {}, { fail }: { fail?: unknown } = {}): SitesDirectoryProbe {
  return {
    isAbsolute: ({ directory }) => directory.startsWith('/'),
    kind: ({ directory }) => { if (fail !== undefined) throw fail; return kinds[directory] ?? 'missing'; },
    parentExists: ({ directory }) => kinds[directory.slice(0, directory.lastIndexOf('/')) || '/'] === 'directory',
  };
}

async function refusalOf(fn: () => unknown): Promise<{ status: number; body: unknown }> {
  try { await fn(); } catch (error) { if (error instanceof RouteRefusalError) return error.response; throw error; }
  throw new Error('expected a route refusal');
}

function fixture({ enabled = true, deny = false, kinds = { '/mnt': 'directory' } as Record<string, 'directory' | 'other'> } = {}) {
  const calls: unknown[] = [];
  const deps: SitesHomeSetRouteDeps & { workspace: { config(r: Record<string, never>): unknown } } = {
    switcherEnabled: () => { calls.push('gate'); return enabled; },
    directories: probe(kinds),
    workspace: {
      config: () => { calls.push('config'); return { sitesHome: '/mnt/home' }; },
      setHome: ({ path }) => { calls.push(['setHome', path]); return path; },
    },
  };
  const authorize = async (args: { permission: string; entityType: string }) => {
    calls.push(['authorize', args]);
    if (deny) throw new RouteRefusalError({ status: 403, body: { error: 'denied' } });
  };
  const readConfig = () => sitesConfigReadRoute.handle({ input: {}, deps, context: { id: 'owner' }, authorize }, {});
  const setHome = (body: unknown) => {
    const parsed = sitesHomeSetRoute.parse({ body, query: {}, params: {} });
    if (!parsed.ok) throw new Error('parse must be total');
    return sitesHomeSetRoute.handle({ input: parsed.value, deps, context: { id: 'owner' }, authorize }, {});
  };
  return { calls, deps, authorize, readConfig, setHome };
}

describe('sites settings route specs', () => {
  it('pins method, path, success status and no body cap', () => {
    expect([sitesConfigReadRoute.method, sitesConfigReadRoute.path, sitesConfigReadRoute.successStatus, sitesConfigReadRoute.maxBodyBytes])
      .toEqual(['get', `${PREFIX}/config`, undefined, undefined]);
    expect([sitesHomeSetRoute.method, sitesHomeSetRoute.path, sitesHomeSetRoute.successStatus, sitesHomeSetRoute.maxBodyBytes])
      .toEqual(['put', `${PREFIX}/home`, undefined, undefined]);
  });

  it('parse is total: the home path is read raw (validation runs after authorization)', () => {
    expect(sitesHomeSetRoute.parse({ body: { path: 7 }, query: {}, params: {} })).toEqual({ ok: true, value: { path: 7 } });
    expect(sitesHomeSetRoute.parse({ body: null, query: {}, params: {} })).toEqual({ ok: true, value: { path: undefined } });
  });

  it('the deployment gate answers 403 before any authorization', async () => {
    for (const run of ['readConfig', 'setHome'] as const) {
      const f = fixture({ enabled: false });
      expect(await refusalOf(() => (run === 'readConfig' ? f.readConfig() : f.setHome({ path: '/mnt/x' }))))
        .toEqual({ status: 403, body: { error: 'Local sites management is disabled.' } });
      expect(f.calls).toEqual(['gate']);
    }
  });

  it('reads the config under system.read and saves the home under system.write on site-registry', async () => {
    const read = fixture();
    expect(await read.readConfig()).toEqual({ ok: true, value: { sitesHome: '/mnt/home' } });
    expect(read.calls).toEqual(['gate', ['authorize', { permission: 'system.read', entityType: 'site-registry' }], 'config']);
    const save = fixture();
    expect(await save.setHome({ path: '/mnt/new' })).toEqual({ ok: true, value: { home: '/mnt/new' } });
    expect(save.calls).toEqual(['gate', ['authorize', { permission: 'system.write', entityType: 'site-registry' }], ['setHome', '/mnt/new']]);
  });

  it('an authorization refusal stops every read and write', async () => {
    const f = fixture({ deny: true });
    await expect(f.readConfig()).rejects.toThrow(RouteRefusalError);
    await expect(f.setHome({ path: '/mnt/new' })).rejects.toThrow(RouteRefusalError);
    expect(f.calls.filter((call) => call === 'config' || (Array.isArray(call) && call[0] === 'setHome'))).toEqual([]);
  });

  it('every home refusal is a flat 400 answered after authorization, before the write', async () => {
    const f = fixture({ kinds: { '/mnt': 'directory', '/mnt/file': 'other' } });
    for (const [body, error] of [
      [{}, INVALID], [{ path: 'relative' }, INVALID], [{ path: '   ' }, INVALID], [{ path: 5 }, INVALID], [{ path: '/mnt/a\0b' }, INVALID],
      [{ path: '/mnt/file' }, 'Sites folder must be a directory.'],
      [{ path: '/gone/new' }, 'Sites folder is unavailable: /gone/new. Mount it or choose an existing local folder.'],
    ] as const) {
      expect(await refusalOf(() => f.setHome(body))).toEqual({ status: 400, body: { error } });
    }
    expect(f.calls.some((call) => Array.isArray(call) && call[0] === 'setHome')).toBe(false);
  });

  it('a new home may be missing when its parent is mounted; a site root may not', () => {
    const directories = probe({ '/mnt': 'directory' });
    expect(() => validateSitesSettingsDirectories({ patch: { sitesHome: '/mnt/new' }, directories })).not.toThrow();
    expect(() => validateSitesSettingsDirectories({ patch: { siteRoots: ['/mnt/new'] }, directories })).toThrow(RouteRefusalError);
    expect(() => validateSitesSettingsDirectories({ patch: {}, directories })).not.toThrow();
    expect(parseSitesSettingsDirectory({ directory: '/mnt', directories })).toBe('/mnt');
  });

  it('an unexpected probe failure is rethrown unchanged (the host 500), never a refusal', async () => {
    const f = fixture();
    f.deps.directories = probe({}, { fail: new Error('EACCES private') });
    await expect(f.setHome({ path: '/mnt/new' })).rejects.toThrow('EACCES private');
    f.deps.workspace.setHome = () => { throw new Error('storage failed'); };
    f.deps.directories = probe({ '/mnt': 'directory' });
    await expect(f.setHome({ path: '/mnt/new' })).rejects.toThrow('storage failed');
  });

  it('fails closed without an authorizer (wiring bug)', async () => {
    const f = fixture();
    await expect(sitesConfigReadRoute.handle({ input: {}, deps: f.deps }, {})).rejects.toThrow(/no authorizer/);
    await expect(sitesHomeSetRoute.handle({ input: { path: '/mnt/x' }, deps: f.deps }, {})).rejects.toThrow(/no authorizer/);
  });
});
