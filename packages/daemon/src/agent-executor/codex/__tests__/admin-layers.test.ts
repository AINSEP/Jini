/**
 * The admin-layer probe: every Codex config source above the staged home that Jini can't out-rank
 * (codex-rs `config/src/loader/mod.rs` L:764-842, `loader/layer_io.rs`, `loader/macos.rs`,
 * `cloud-config/src/service.rs`) blocks a personal-MCP-OFF run; a readable system config.toml is
 * parsed and turned off server by server. Ports are faked, so each platform's paths run on any OS.
 */
import { describe, expect, it } from 'vitest';
import { probeCodexAdminLayers, type CodexAdminLayerPorts } from '../admin-layers.js';

const sourceHome = '/home/me/.codex';

function ports(files: Record<string, string>, overrides: Partial<CodexAdminLayerPorts> = {}): CodexAdminLayerPorts {
  return { platform: 'linux', env: {}, readFile: async ({ path }) => files[path] ?? null, macManagedPrefsPresent: async () => false, ...overrides };
}

function authJson(plan: string): string {
  const claims = Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_plan_type: plan } })).toString('base64url');
  return JSON.stringify({ tokens: { id_token: `e30.${claims}.sig`, access_token: 'a', refresh_token: 'r' } });
}

const probe = (p: CodexAdminLayerPorts) => probeCodexAdminLayers({ sourceHome, ports: p });

describe('probeCodexAdminLayers', () => {
  it('is clear with nothing present', async () => {
    expect(await probe(ports({}))).toEqual({ status: 'clear', systemServersOffToml: '' });
  });

  it.each([
    ['linux', '/etc/codex/requirements.toml'],
    ['linux', '/etc/codex/managed_config.toml'],
    ['darwin', '/etc/codex/requirements.toml'],
    ['darwin', '/etc/codex/managed_config.toml'],
    ['win32', 'C:\\ProgramData\\OpenAI\\Codex\\requirements.toml'],
  ] as const)('blocks on %s when %s exists', async (platform, path) => {
    const result = await probe(ports({ [path]: '' }, { platform }));
    expect(result).toMatchObject({ status: 'blocked' });
    expect(result.status === 'blocked' && result.reason).toContain(path);
  });

  it('reads the Windows admin folder from ProgramData', async () => {
    const files = { 'D:\\PD\\OpenAI\\Codex\\requirements.toml': '', 'C:\\ProgramData\\OpenAI\\Codex\\requirements.toml': '' };
    expect(await probe(ports(files, { platform: 'win32', env: { ProgramData: 'D:\\PD' } }))).toMatchObject({ status: 'blocked' });
    expect(await probe(ports({ 'C:\\ProgramData\\OpenAI\\Codex\\requirements.toml': '' }, { platform: 'win32', env: { ProgramData: 'D:\\PD' } })))
      .toMatchObject({ status: 'clear' });
  });

  it('ignores Unix paths and the legacy managed file on Windows (Codex never loads them there)', async () => {
    const files = { '/etc/codex/requirements.toml': '', '/etc/codex/config.toml': '[mcp_servers.x]\ncommand = "x"', 'C:\\ProgramData\\OpenAI\\Codex\\managed_config.toml': '' };
    expect(await probe(ports(files, { platform: 'win32' }))).toEqual({ status: 'clear', systemServersOffToml: '' });
  });

  it.each([
    ['linux', '/etc/codex/config.toml', {}],
    ['darwin', '/etc/codex/config.toml', {}],
    ['win32', 'E:\\Data\\OpenAI\\Codex\\config.toml', { ProgramData: 'E:\\Data' }],
  ] as const)('turns off the %s system config servers at %s', async (platform, path, env) => {
    const result = await probe(ports({ [path]: '[mcp_servers.sys]\nurl = "https://x"' }, { platform, env }));
    expect(result).toEqual({ status: 'clear', systemServersOffToml: '[mcp_servers.sys]\nenabled = false\nurl = "http://127.0.0.1:9/"\n' });
  });

  it.each([
    ['unparseable', '[mcp_servers.sys\ncommand = "x"', "isn't valid TOML"],
    ['forcing a server on', '[mcp_servers.sys]\ncommand = "x"\nenabled = true', 'forces the MCP server "sys" on'],
    ['trusting a project', '[projects."/p"]\ntrust_level = "trusted"', 'trusts projects'],
  ])('blocks on a system config %s', async (_name, raw, reason) => {
    const result = await probe(ports({ '/etc/codex/config.toml': raw }));
    expect(result.status === 'blocked' && result.reason).toContain(reason);
  });

  it('blocks when an admin file exists but can\'t be read', async () => {
    const eacces = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    const result = await probe(ports({}, { readFile: async ({ path }) => { if (path === '/etc/codex/config.toml') throw eacces; return null; } }));
    expect(result).toMatchObject({ status: 'blocked' });
    expect(result.status === 'blocked' && result.reason).toContain('EACCES');
  });

  it('checks macOS managed preferences on macOS only', async () => {
    let asked = 0;
    const macPrefs = async () => { asked += 1; return true; };
    expect(await probe(ports({}, { platform: 'darwin', macManagedPrefsPresent: macPrefs }))).toMatchObject({ status: 'blocked', reason: expect.stringContaining('com.openai.codex') });
    expect(await probe(ports({}, { platform: 'linux', macManagedPrefsPresent: macPrefs }))).toMatchObject({ status: 'clear' });
    expect(await probe(ports({}, { platform: 'win32', macManagedPrefsPresent: macPrefs }))).toMatchObject({ status: 'clear' });
    expect(asked).toBe(1);
  });

  it('blocks when macOS preferences can\'t be read', async () => {
    const result = await probe(ports({}, { platform: 'darwin', macManagedPrefsPresent: async () => { throw new Error('osascript failed'); } }));
    expect(result).toMatchObject({ status: 'blocked' });
  });

  it.each(['business', 'enterprise', 'edu', 'edu_plus', 'ent26', 'enterprise_cbp_usage_based', 'team', 'some_future_plan'])(
    'blocks a ChatGPT sign-in on the %s plan (it can receive a cloud-managed config)', async (plan) => {
      expect(await probe(ports({ [`${sourceHome}/auth.json`]: authJson(plan) }))).toMatchObject({ status: 'blocked' });
    });

  it.each(['free', 'go', 'plus', 'pro', 'prolite'])('is clear for a personal %s plan', async (plan) => {
    expect(await probe(ports({ [`${sourceHome}/auth.json`]: authJson(plan) }))).toMatchObject({ status: 'clear' });
  });

  it.each([
    ['an API-key login', JSON.stringify({ OPENAI_API_KEY: 'sk-test' })],
    ['a token with no plan claim', JSON.stringify({ tokens: { id_token: `e30.${Buffer.from('{}').toString('base64url')}.s` } })],
  ])('is clear for %s (Codex fetches no cloud config without a plan)', async (_name, raw) => {
    expect(await probe(ports({ [`${sourceHome}/auth.json`]: raw }))).toMatchObject({ status: 'clear' });
  });

  it.each([
    ['auth.json that is not JSON', 'secret-refresh-token'],
    ['an id_token that is not a JWT', JSON.stringify({ tokens: { id_token: 'garbage' } })],
    ['an id_token that is not a string', JSON.stringify({ tokens: { id_token: 7 } })],
  ])('blocks on %s without quoting the file', async (_name, raw) => {
    const result = await probe(ports({ [`${sourceHome}/auth.json`]: raw }));
    expect(result).toMatchObject({ status: 'blocked', reason: expect.stringContaining('auth.json') });
    expect(result.status === 'blocked' && result.reason).not.toMatch(/secret|garbage/);
  });
});
