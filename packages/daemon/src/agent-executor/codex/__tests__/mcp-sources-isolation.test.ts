/**
 * "Your MCP servers" OFF on Codex must leave Tovu's bridge as the ONLY MCP server, across every
 * source Codex loads (codex-rs config/src/loader/mod.rs; learn.chatgpt.com/docs/extend/mcp).
 * Project `.codex/config.toml` layers load only for a project the merged config trusts, so the
 * staged home drops the `projects` (trust) table. Plugin, app and skill-installed servers are off on
 * the CLI layer. Layers outside the home (system, MDM, cloud bundle) are machine policy, out of scope.
 * Fixture: a fake filesystem holding a personal entry in each source type.
 */
import { join, resolve } from 'node:path';
import { parse } from 'smol-toml';
import { describe, expect, it } from 'vitest';
import { getAgentDef, type NativeCapabilities } from '@jini-ai/agent-runtime';
import { prepareCodexHomeIfNeeded } from '../home-staging.js';

const root = resolve('/fx');
const home = join(root, 'home', '.codex');
const project = join(root, 'proj');
const cwd = join(project, 'site');
const codexAgentDef = getAgentDef({ id: 'codex' })!;
const bridgeEntry = { command: 'host-bridge', args: ['serve'], env: { JINI_RUN_ID: 'run', JINI_DAEMON_URL: 'http://site' } };

/** One personal MCP entry per source; the home trusts the project, as `codex` does after its trust prompt. */
function fixtureFiles(overrides: Record<string, string> = {}): Map<string, string> {
  return new Map(Object.entries({
    [join(home, 'config.toml')]: [
      'model = "personal-model"',
      '[mcp_servers.home_chrome]', 'command = "chrome-mcp"',
      `[projects."${project}"]`, 'trust_level = "trusted"',
      '[plugins."gmail@openai-curated"]', 'enabled = true',
    ].join('\n'),
    [join(home, 'work.config.toml')]: '[mcp_servers.profile_only]\ncommand = "profile-mcp"',
    [join(project, '.git', 'HEAD')]: 'ref: refs/heads/main',
    [join(project, '.codex', 'config.toml')]: '[mcp_servers.root_http]\nurl = "https://personal.example/mcp"\nenabled = true',
    [join(cwd, '.codex', 'config.toml')]: '[mcp_servers.site_srv]\ncommand = "site-mcp"\nargs = ["--x"]',
    ...overrides,
  }));
}

const refuse = async (error: { readonly code: string; readonly message: string }): Promise<never> => { throw error; };

/** Stages a run against the fixture; returns the staged config.toml text. */
async function stage(files: Map<string, string>, nativeCapabilities: Partial<NativeCapabilities>): Promise<string> {
  let written = '';
  await prepareCodexHomeIfNeeded({ input: { runId: 'run', def: codexAgentDef, mcpBridge: { kind: 'codex-toml', serverEntry: bridgeEntry }, nativeToolAccess: true, nativeCapabilities },
    deps: { hostEnv: { CODEX_HOME: home }, releaseStagedResources: async () => {}, failBeforeSpawn: refuse, mcpJsonInjection: {
      command: 'host-bridge', daemonUrl: 'http://site', linkSessionStore: async () => {}, removeDir: async () => {},
      mkdtemp: async ({ prefix }) => join(root, 'tmp', `${prefix}x`),
      readFile: async ({ path }) => { const raw = files.get(path); if (raw === undefined) throw new Error(`ENOENT ${path}`); return raw; },
      writeFile: async ({ path, content }) => { if (path.endsWith('config.toml')) written = content; },
    } } });
  return written;
}

const refusal = (files: Map<string, string>) => stage(files, { userMcp: false }).then(() => null, (err: unknown) => err as { code: string; message: string });

/** The staged config's MCP servers, parsed: id → table. */
function stagedServers(toml: string): Record<string, Record<string, unknown>> {
  return (parse(toml).mcp_servers ?? {}) as Record<string, Record<string, unknown>>;
}

function codexArgs(nativeCapabilities: Partial<NativeCapabilities>): string[] {
  return codexAgentDef.buildArgs({ prompt: '', imagePaths: [] }, { options: { nativeToolAccess: true, cliParity: true, permissionMode: 'bypass', nativeCapabilities } });
}

describe('Codex with personal MCP OFF loads only the Tovu bridge', () => {
  it('drops the home servers and trust table', async () => {
    const staged = await stage(fixtureFiles(), { userMcp: false });
    const servers = stagedServers(staged);
    expect(Object.keys(servers)).toEqual(['jini']);
    expect(servers.jini).toMatchObject({ command: 'host-bridge' });
    // No trust entry → Codex loads no project .codex/config.toml, so project servers need no placeholder.
    expect(parse(staged)).not.toHaveProperty('projects');
  });

  it('keeps personal settings while personal MCP is off', async () => {
    expect(await stage(fixtureFiles(), { userMcp: false })).toContain('model = "personal-model"');
  });

  // A linked worktree's `.git` is a file, not a directory with HEAD, and Codex still finds the
  // trusted checkout's project layers through it (loader/mod.rs L:1830-1853). Without trust none load.
  it('loads no project layer from a trusted checkout in a linked git worktree', async () => {
    const worktree = join(root, 'wt');
    const files = fixtureFiles({
      [join(worktree, '.git')]: `gitdir: ${join(project, '.git', 'worktrees', 'wt')}`,
      [join(worktree, '.codex', 'config.toml')]: '[mcp_servers.wt_srv]\ncommand = "wt-mcp"\nenabled = true',
      [join(home, 'config.toml')]: `[projects."${project}"]\ntrust_level = "trusted"\n[projects."${worktree}"]\ntrust_level = "trusted"\n`,
    });
    const staged = await stage(files, { userMcp: false });
    expect(parse(staged)).not.toHaveProperty('projects');
    expect(Object.keys(stagedServers(staged))).toEqual(['jini']);
  });

  it.each([
    ['a header table', `[projects."${project}"]\ntrust_level = "trusted"`],
    ['a spaced, quoted header with a comment', `  [ "projects" . '${project}' ]  # trusted\ntrust_level = "trusted"`],
    ['a subtable header', `[projects."${project}".extra]\nx = 1`],
  ])('strips a home trust entry written as %s', async (_name, trust) => {
    const staged = await stage(fixtureFiles({ [join(home, 'config.toml')]: `model = "m"\n${trust}\n[ui]\ntheme = "dark"` }), { userMcp: false });
    expect(parse(staged)).not.toHaveProperty('projects');
    expect(staged).toContain('theme = "dark"');
  });

  it.each([
    ['a dotted root key', `projects."${project}".trust_level = "trusted"`],
    ['a quoted dotted root key', `"projects"."${project}".trust_level = "trusted"`],
    ['a root inline table', `projects = { "${project}" = { trust_level = "trusted" } }`],
    ['an escaped header', `["proj\\u0065cts"."${project}"]\ntrust_level = "trusted"`],
  ])('refuses a home trust entry the rewrite cannot drop: %s', async (_name, trust) => {
    const error = await refusal(fixtureFiles({ [join(home, 'config.toml')]: `model = "m"\n${trust}` }));
    expect(error?.code).toBe('NATIVE_TOOL_POLICY_UNSUPPORTED');
    expect(error?.message).toContain('trusts projects in a way that can\'t be removed safely');
  });

  // The rewrite is line-based: a malformed block it drops would otherwise hide that the line
  // scanner misread the file. The original must parse before its rewrite is trusted.
  it('refuses a home config that is not valid TOML even when the broken part is in a dropped block', async () => {
    const error = await refusal(fixtureFiles({ [join(home, 'config.toml')]: 'model = "m"\n[mcp_servers.home_chrome]\ncommand = "unterminated\n[ui]\ntheme = "dark"' }));
    expect(error?.code).toBe('NATIVE_TOOL_POLICY_UNSUPPORTED');
    expect(error?.message).toContain(`${join(home, 'config.toml')} isn't valid TOML`);
  });

  it('turns off plugin-bundled servers and ChatGPT apps on the CLI layer, on create and resume', () => {
    const create = codexArgs({ userMcp: false });
    const resume = codexAgentDef.buildArgs({ prompt: '', imagePaths: [] }, { options: { nativeToolAccess: true, cliParity: true, permissionMode: 'bypass', nativeCapabilities: { userMcp: false } },
      runtimeContext: { resumeSessionId: 'thread' } });
    for (const args of [create, resume]) {
      expect(args.join(' ')).toContain('-c features.plugins=false');
      expect(args.join(' ')).toContain('-c features.apps=false');
      expect(args.join(' ')).toContain('-c features.skill_mcp_dependency_install=false');
      // A profile file (work.config.toml) is only read with --profile.
      expect(args).not.toContain('--profile');
    }
  });

  it('turns off plugins and apps when native tools are locked', () => {
    const args = codexAgentDef.buildArgs({ prompt: '', imagePaths: [] }, { options: { nativeToolAccess: false } });
    expect(args.join(' ')).toContain('-c features.plugins=false');
    expect(args.join(' ')).toContain('-c features.apps=false');
  });

  it.each([
    ['a home server the rewrite cannot drop (escaped header)', { [join(home, 'config.toml')]: '["mcp\\u005fservers".home_evil]\ncommand = "evil"' }, "can't be removed safely"],
    ['a home config a fake header leaves broken', { [join(home, 'config.toml')]: '[mcp_servers.home_chrome]\ncommand = """\n[ui]\n"""' }, "can't be removed safely"],
  ])('refuses rather than leaks with %s', async (_name, overrides, reason) => {
    const error = await refusal(fixtureFiles(overrides));
    expect(error?.code).toBe('NATIVE_TOOL_POLICY_UNSUPPORTED');
    expect(error?.message).toMatch(/^Codex can't run with 'Your MCP servers' off: /);
    expect(error?.message).toContain(reason);
    expect(error?.message).toMatch(/Turn it on in the assistant settings, or choose Claude\.$/);
  });
});

describe('Codex with personal MCP ON keeps personal servers', () => {
  it('keeps home servers and trust, and adds no disabled placeholders', async () => {
    const staged = await stage(fixtureFiles(), { userMcp: true });
    const servers = stagedServers(staged);
    expect(servers.home_chrome).toEqual({ command: 'chrome-mcp' });
    for (const id of ['site_srv', 'root_http']) expect(servers).not.toHaveProperty(id);
    expect(parse(staged)).toHaveProperty('projects');
  });

  it('leaves plugins, apps and skill MCP installs on', () => {
    const args = codexArgs({ userMcp: true });
    expect(args).not.toContain('features.plugins=false');
    expect(args).not.toContain('features.apps=false');
    expect(args).not.toContain('features.skill_mcp_dependency_install=false');
  });
});
