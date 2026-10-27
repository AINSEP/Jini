/**
 * "Your MCP servers" OFF on Codex must leave Tovu's bridge as the ONLY MCP server, across every
 * source Codex loads (codex-rs config/src/loader/mod.rs; learn.chatgpt.com/docs/extend/mcp):
 * home config.toml, system /etc/codex/config.toml, project .codex/config.toml from the project
 * root down to cwd, legacy managed_config.toml, plugin-bundled servers and ChatGPT apps.
 * Fixture: a fake filesystem holding a personal entry in each source type.
 */
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getAgentDef, type NativeCapabilities } from '@jini-ai/agent-runtime';
import { codexOtherMcpLayerPaths } from '../isolation.js';
import { prepareCodexHomeIfNeeded } from '../home-staging.js';

const root = resolve('/fx');
const home = join(root, 'home', '.codex');
const project = join(root, 'proj');
const cwd = join(project, 'site');
const codexAgentDef = getAgentDef({ id: 'codex' })!;
const bridgeEntry = { command: 'host-bridge', args: ['serve'], env: { JINI_RUN_ID: 'run', JINI_DAEMON_URL: 'http://site' } };

/** One personal MCP entry per source; `outside` sits above the project root, so Codex never loads it. */
function fixtureFiles(overrides: Record<string, string> = {}): Map<string, string> {
  return new Map(Object.entries({
    [join(home, 'config.toml')]: [
      'model = "personal-model"',
      '[mcp_servers.home_chrome]', 'command = "chrome-mcp"',
      '[plugins."gmail@openai-curated"]', 'enabled = true',
    ].join('\n'),
    [join(home, 'work.config.toml')]: '[mcp_servers.profile_only]\ncommand = "profile-mcp"',
    '/etc/codex/config.toml': '[mcp_servers.system_srv]\ncommand = "system-mcp"',
    [join(project, '.git', 'HEAD')]: 'ref: refs/heads/main',
    [join(project, '.codex', 'config.toml')]: '[mcp_servers.root_http]\nurl = "https://personal.example/mcp"\n[mcp_servers.root_http.http_headers]\nX = "y"',
    [join(cwd, '.codex', 'config.toml')]: '[mcp_servers.site_srv]\ncommand = "site-mcp"\nargs = ["--x"]',
    [join(root, '.codex', 'config.toml')]: '[mcp_servers.outside_srv]\ncommand = "outside-mcp"',
    ...overrides,
  }));
}

const refuse = async (error: { readonly code: string; readonly message: string }): Promise<never> => { throw error; };

/** Stages a run against the fixture; returns the staged config.toml text. */
async function stage(files: Map<string, string>, nativeCapabilities: Partial<NativeCapabilities>): Promise<string> {
  let written = '';
  await prepareCodexHomeIfNeeded({ input: { runId: 'run', cwd, def: codexAgentDef, mcpBridge: { kind: 'codex-toml', serverEntry: bridgeEntry }, nativeToolAccess: true, nativeCapabilities },
    deps: { hostEnv: { CODEX_HOME: home }, releaseStagedResources: async () => {}, failBeforeSpawn: refuse, mcpJsonInjection: {
      command: 'host-bridge', daemonUrl: 'http://site', linkSessionStore: async () => {}, removeDir: async () => {},
      mkdtemp: async ({ prefix }) => join(root, 'tmp', `${prefix}x`),
      readFile: async ({ path }) => { const raw = files.get(path); if (raw === undefined) throw new Error(`ENOENT ${path}`); return raw; },
      writeFile: async ({ path, content }) => { if (path.endsWith('config.toml')) written = content; },
    } } });
  return written;
}

/** Each `[mcp_servers.<id>]` table's own lines, keyed by id (subtables excluded). */
function serverTables(toml: string): Map<string, string[]> {
  const tables = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const line of toml.split('\n')) {
    const header = /^\[([^\]]+)\]$/.exec(line.trim());
    if (header) {
      const segments = header[1]!.split('.');
      current = segments[0] === 'mcp_servers' && segments.length === 2 ? [] : null;
      if (current) tables.set(segments[1]!, current);
    } else if (current && line.trim() !== '') current.push(line.trim());
  }
  return tables;
}

function codexArgs(nativeCapabilities: Partial<NativeCapabilities>): string[] {
  return codexAgentDef.buildArgs({ prompt: '', imagePaths: [] }, { options: { nativeToolAccess: true, cliParity: true, permissionMode: 'bypass', nativeCapabilities } });
}

describe('Codex with personal MCP OFF loads only the Tovu bridge', () => {
  it('turns off every config-file server and keeps the bridge as the only enabled one', async () => {
    const tables = serverTables(await stage(fixtureFiles(), { userMcp: false }));
    const enabled = [...tables].filter(([, lines]) => !lines.includes('enabled = false')).map(([id]) => id);
    expect(enabled).toEqual(['jini']);
    expect(tables.get('jini')).toContain('command = "host-bridge"');
    // Home servers are dropped outright; project/system servers get disabled placeholders.
    expect(tables.has('home_chrome')).toBe(false);
    expect(tables.get('site_srv')).toEqual(['enabled = false', 'command = "jini-disabled-mcp-server"']);
    expect(tables.get('root_http')).toEqual(['enabled = false', 'url = "http://127.0.0.1:9/"']);
    expect(tables.get('system_srv')).toEqual(['enabled = false', 'command = "jini-disabled-mcp-server"']);
  });

  it('keeps personal settings while personal MCP is off', async () => {
    expect(await stage(fixtureFiles(), { userMcp: false })).toContain('model = "personal-model"');
  });

  it('turns off plugin-bundled servers and ChatGPT apps on the CLI layer, on create and resume', () => {
    const create = codexArgs({ userMcp: false });
    const resume = codexAgentDef.buildArgs({ prompt: '', imagePaths: [] }, { options: { nativeToolAccess: true, cliParity: true, permissionMode: 'bypass', nativeCapabilities: { userMcp: false } },
      runtimeContext: { resumeSessionId: 'thread' } });
    for (const args of [create, resume]) {
      expect(args.join(' ')).toContain('-c features.plugins=false');
      expect(args.join(' ')).toContain('-c features.apps=false');
      // A profile file (work.config.toml) is only read with --profile.
      expect(args).not.toContain('--profile');
    }
  });

  it('turns off plugins and apps when native tools are locked', () => {
    const args = codexAgentDef.buildArgs({ prompt: '', imagePaths: [] }, { options: { nativeToolAccess: false } });
    expect(args.join(' ')).toContain('-c features.plugins=false');
    expect(args.join(' ')).toContain('-c features.apps=false');
  });

  it('scans only the project layers Codex loads: cwd up to the nearest .git/HEAD', async () => {
    const files = fixtureFiles();
    const readFile = async ({ path }: { path: string }) => { const raw = files.get(path); if (raw === undefined) throw new Error('ENOENT'); return raw; };
    const paths = (await codexOtherMcpLayerPaths({ cwd, sourceHome: home, readFile, customRootMarkers: false })).map(layer => layer.path);
    expect(paths).toEqual(['/etc/codex/config.toml', '/etc/codex/managed_config.toml', join(home, 'managed_config.toml'),
      join(cwd, '.codex', 'config.toml'), join(project, '.codex', 'config.toml')]);
    const noRoot = new Map([...files].filter(([path]) => !path.endsWith('HEAD')));
    const cwdOnly = await codexOtherMcpLayerPaths({ cwd, sourceHome: home, customRootMarkers: false,
      readFile: async ({ path }) => { const raw = noRoot.get(path); if (raw === undefined) throw new Error('ENOENT'); return raw; } });
    expect(cwdOnly.at(-1)!.path).toBe(join(cwd, '.codex', 'config.toml'));
    expect(cwdOnly).toHaveLength(4);
  });

  it('scans every ancestor when the user config sets its own project_root_markers', async () => {
    const files = fixtureFiles({ [join(home, 'config.toml')]: 'project_root_markers = [".hg"]\n[mcp_servers.home_chrome]\ncommand = "chrome-mcp"' });
    expect(serverTables(await stage(files, { userMcp: false })).get('outside_srv')).toEqual(['enabled = false', 'command = "jini-disabled-mcp-server"']);
  });

  it.each([
    ['a project table forcing enabled = true', { [join(cwd, '.codex', 'config.toml')]: '[mcp_servers.site_srv]\ncommand = "site-mcp"\nenabled = true' }, 'forces the MCP server "site_srv" on'],
    // TOML spells one key many ways; each must be read as `enabled` (or refused), never skipped.
    ...[`"enabled" = true`, `'enabled' = true`, ` "enabled"=true # on`, `enabled = 1`].map(line =>
      [`a project table forcing on with ${line}`, { [join(cwd, '.codex', 'config.toml')]: `[mcp_servers.site_srv]\ncommand = "site-mcp"\n${line}` } as Record<string, string>, 'forces the MCP server "site_srv" on'] as [string, Record<string, string>, string]),
    ['an escaped key', { [join(cwd, '.codex', 'config.toml')]: '[mcp_servers.site_srv]\ncommand = "site-mcp"\n"enabl\\u0065d" = true' }, 'escaped TOML key'],
    ['an escaped table header', { [join(cwd, '.codex', 'config.toml')]: '["mcp\\u005fservers".site_srv]\ncommand = "site-mcp"' }, 'escaped TOML key'],
    ['a quoted inline project declaration', { [join(cwd, '.codex', 'config.toml')]: '"mcp_servers" . site_srv.command = "site-mcp"' }, 'declares MCP servers inline'],
    ['a quoted dotted root declaration', { [join(cwd, '.codex', 'config.toml')]: `'mcp_servers'."site_srv".url = "https://x"` }, 'declares MCP servers inline'],
    ['an inline project declaration', { [join(cwd, '.codex', 'config.toml')]: 'mcp_servers.site_srv.command = "site-mcp"' }, 'declares MCP servers inline'],
    ['a bare [mcp_servers] project table', { [join(cwd, '.codex', 'config.toml')]: '[mcp_servers]\nsite_srv = { command = "site-mcp" }' }, 'declares MCP servers inline'],
    ['a project redefining the bridge', { [join(cwd, '.codex', 'config.toml')]: '[mcp_servers.jini]\ncommand = "evil"' }, `redefines Tovu's own "jini" MCP server`],
    ['an admin-managed server', { '/etc/codex/managed_config.toml': '[mcp_servers.admin_srv]\ncommand = "admin-mcp"' }, 'adds the MCP server "admin_srv"'],
  ])('refuses rather than leaks with %s', async (_name, overrides, reason) => {
    const error = await stage(fixtureFiles(overrides), { userMcp: false }).then(() => null, (err: unknown) => err as { code: string; message: string });
    expect(error?.code).toBe('NATIVE_TOOL_POLICY_UNSUPPORTED');
    expect(error?.message).toMatch(/^Codex can't run with 'Your MCP servers' off: /);
    expect(error?.message).toContain(reason);
    expect(error?.message).toMatch(/Turn it on in the assistant settings, or choose Claude\.$/);
  });

  it('ignores plugin-scoped server settings in a project layer (plugins are off on the CLI layer)', async () => {
    const files = fixtureFiles({ [join(cwd, '.codex', 'config.toml')]: '[plugins."x@y"]\nmcp_servers.z.enabled = true' });
    expect(serverTables(await stage(files, { userMcp: false })).has('z')).toBe(false);
  });
});

describe('Codex with personal MCP ON keeps personal servers', () => {
  it('keeps home servers and adds no disabled placeholders', async () => {
    const tables = serverTables(await stage(fixtureFiles(), { userMcp: true }));
    expect(tables.get('home_chrome')).toEqual(['command = "chrome-mcp"']);
    for (const id of ['site_srv', 'root_http', 'system_srv', 'outside_srv']) expect(tables.has(id)).toBe(false);
  });

  it('leaves plugins and apps on', () => {
    const args = codexArgs({ userMcp: true });
    expect(args).not.toContain('features.plugins=false');
    expect(args).not.toContain('features.apps=false');
  });

  it('does not refuse a project forcing a server on', async () => {
    const files = fixtureFiles({ [join(cwd, '.codex', 'config.toml')]: '[mcp_servers.site_srv]\ncommand = "site-mcp"\nenabled = true' });
    await expect(stage(files, { userMcp: true })).resolves.toContain('[mcp_servers.jini]');
  });
});
