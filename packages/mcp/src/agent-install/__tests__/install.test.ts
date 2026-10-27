import { mkdir, mkdtemp, readFile, rm, symlink, writeFile, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AGENT_SLUGS,
  isAgentSlug,
  planAgentInstall,
  applyJsonInstall,
  removeJsonInstall,
  type AgentSlug,
  type McpLaunchSpec,
  type PlanContext,
  type JsonInstallPlan,
} from '../install.js';

function spec(env: Record<string, string> = {}): McpLaunchSpec {
  return { command: '/usr/bin/node', args: ['/app/cli.js', 'mcp'], env };
}
function ctx(overrides: Partial<PlanContext> = {}): PlanContext {
  return { home: '/home/u', platform: 'linux', serverName: 'jini', ...overrides };
}

const savedAppData = process.env.APPDATA;
afterEach(() => {
  if (savedAppData === undefined) delete process.env.APPDATA;
  else process.env.APPDATA = savedAppData;
});

describe('AGENT_SLUGS / isAgentSlug', () => {
  it('recognizes every known slug and rejects unknowns', () => {
    for (const s of AGENT_SLUGS) expect(isAgentSlug({ value: s })).toBe(true);
    expect(isAgentSlug({ value: 'nope' })).toBe(false);
  });
});

describe('planAgentInstall — CLI agents', () => {
  it('claude embeds env flags with -e and user scope', () => {
    const plan = planAgentInstall({ slug: 'claude', spec: spec({ A: '1' }), ctx: ctx() });
    expect(plan.kind).toBe('cli');
    if (plan.kind !== 'cli') throw new Error('expected cli');
    expect(plan.bin).toBe('claude');
    expect(plan.addArgv).toEqual([
      'mcp', 'add', '--scope', 'user', 'jini', '-e', 'A=1', '--', '/usr/bin/node', '/app/cli.js', 'mcp',
    ]);
    expect(plan.removeArgv).toEqual(['mcp', 'remove', '--scope', 'user', 'jini']);
    expect(plan.getArgv).toEqual(['mcp', 'get', 'jini']);
  });

  it('codex with an empty env produces no env flags', () => {
    const plan = planAgentInstall({ slug: 'codex', spec: spec(), ctx: ctx() });
    if (plan.kind !== 'cli') throw new Error('expected cli');
    expect(plan.addArgv).toEqual(['mcp', 'add', 'jini', '--', '/usr/bin/node', '/app/cli.js', 'mcp']);
  });

  it('kimi passes stdio transport and env flags', () => {
    const plan = planAgentInstall({ slug: 'kimi', spec: spec({ K: 'v' }), ctx: ctx() });
    if (plan.kind !== 'cli') throw new Error('expected cli');
    expect(plan.addArgv).toEqual([
      'mcp', 'add', '--transport', 'stdio', '--env', 'K=v', 'jini', '--', '/usr/bin/node', '/app/cli.js', 'mcp',
    ]);
  });
});

describe('planAgentInstall — JSON agents', () => {
  it('cursor writes a stdio entry with env attached', () => {
    const plan = planAgentInstall({ slug: 'cursor', spec: spec({ A: '1' }), ctx: ctx() });
    if (plan.kind !== 'json') throw new Error('expected json');
    expect(plan.configPath).toBe('/home/u/.cursor/mcp.json');
    expect(plan.keyPath).toEqual(['mcpServers']);
    expect(plan.entry).toEqual({ command: '/usr/bin/node', args: ['/app/cli.js', 'mcp'], type: 'stdio', env: { A: '1' } });
  });

  it('copilot omits env when empty', () => {
    const plan = planAgentInstall({ slug: 'copilot', spec: spec(), ctx: ctx() });
    if (plan.kind !== 'json') throw new Error('expected json');
    expect(plan.configPath).toBe('/home/u/.copilot/mcp-config.json');
    expect(plan.entry).toEqual({ command: '/usr/bin/node', args: ['/app/cli.js', 'mcp'], type: 'local', tools: ['*'] });
  });

  it('opencode folds command+args and attaches environment when env is present', () => {
    const plan = planAgentInstall({ slug: 'opencode', spec: spec({ E: '2' }), ctx: ctx() });
    if (plan.kind !== 'json') throw new Error('expected json');
    expect(plan.configPath).toBe('/home/u/.config/opencode/opencode.json');
    expect(plan.keyPath).toEqual(['mcp']);
    expect(plan.entry).toEqual({
      type: 'local',
      command: ['/usr/bin/node', '/app/cli.js', 'mcp'],
      enabled: true,
      environment: { E: '2' },
    });
  });

  it('opencode omits environment when env is empty', () => {
    const plan = planAgentInstall({ slug: 'opencode', spec: spec(), ctx: ctx() });
    if (plan.kind !== 'json') throw new Error('expected json');
    expect(plan.entry).toEqual({ type: 'local', command: ['/usr/bin/node', '/app/cli.js', 'mcp'], enabled: true });
  });

  it('openclaw nests under mcp.servers', () => {
    const plan = planAgentInstall({ slug: 'openclaw', spec: spec(), ctx: ctx() });
    if (plan.kind !== 'json') throw new Error('expected json');
    expect(plan.configPath).toBe('/home/u/.openclaw/openclaw.json');
    expect(plan.keyPath).toEqual(['mcp', 'servers']);
  });

  it('antigravity targets the config/ registry the agy CLI reads', () => {
    const plan = planAgentInstall({ slug: 'antigravity', spec: spec(), ctx: ctx() });
    if (plan.kind !== 'json') throw new Error('expected json');
    expect(plan.configPath).toBe('/home/u/.gemini/config/mcp_config.json');
  });

  it('cline resolves per-platform config paths', () => {
    const rel = 'globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json';
    const darwin = planAgentInstall({ slug: 'cline', spec: spec(), ctx: ctx({ platform: 'darwin' }) });
    if (darwin.kind !== 'json') throw new Error('expected json');
    expect(darwin.configPath).toBe(`/home/u/Library/Application Support/Code/User/${rel}`);
    expect(darwin.entry).toEqual({
      command: '/usr/bin/node', args: ['/app/cli.js', 'mcp'], disabled: false, autoApprove: [],
    });

    const linux = planAgentInstall({ slug: 'cline', spec: spec(), ctx: ctx({ platform: 'linux' }) });
    if (linux.kind !== 'json') throw new Error('expected json');
    expect(linux.configPath).toBe(`/home/u/.config/Code/User/${rel}`);

    process.env.APPDATA = 'C:\\Users\\u\\AppData\\Roaming';
    const win = planAgentInstall({ slug: 'cline', spec: spec(), ctx: ctx({ platform: 'win32' }) });
    if (win.kind !== 'json') throw new Error('expected json');
    expect(win.configPath).toContain('AppData');
    expect(win.configPath).toContain(rel);

    delete process.env.APPDATA;
    const winNoAppData = planAgentInstall({ slug: 'cline', spec: spec(), ctx: ctx({ platform: 'win32' }) });
    if (winNoAppData.kind !== 'json') throw new Error('expected json');
    expect(winNoAppData.configPath).toContain('AppData');
  });

  it('trae resolves per-platform config paths', () => {
    const darwin = planAgentInstall({ slug: 'trae', spec: spec(), ctx: ctx({ platform: 'darwin' }) });
    if (darwin.kind !== 'json') throw new Error('expected json');
    expect(darwin.configPath).toBe('/home/u/Library/Application Support/Trae/User/mcp.json');

    const linux = planAgentInstall({ slug: 'trae', spec: spec(), ctx: ctx({ platform: 'linux' }) });
    if (linux.kind !== 'json') throw new Error('expected json');
    expect(linux.configPath).toBe('/home/u/.config/Trae/User/mcp.json');

    process.env.APPDATA = 'C:\\Roaming';
    const win = planAgentInstall({ slug: 'trae', spec: spec(), ctx: ctx({ platform: 'win32' }) });
    if (win.kind !== 'json') throw new Error('expected json');
    expect(win.configPath).toContain('Trae');

    delete process.env.APPDATA;
    const winNoAppData = planAgentInstall({ slug: 'trae', spec: spec(), ctx: ctx({ platform: 'win32' }) });
    if (winNoAppData.kind !== 'json') throw new Error('expected json');
    expect(winNoAppData.configPath).toContain('AppData');
  });
});

describe('planAgentInstall — manual (print-only) agents', () => {
  it('C51: Vibe TOML retains the Electron launch environment and data directory', () => {
    const plan = planAgentInstall({
      slug: 'vibe',
      spec: spec({ ELECTRON_RUN_AS_NODE: '1', JINI_DATA_DIR: '/home/u/data' }),
      ctx: ctx(),
    });
    if (plan.kind !== 'manual') throw new Error('expected manual');

    expect(plan.snippet).toMatch(/^\s*env\s*=\s*\{[^}\n]*"?ELECTRON_RUN_AS_NODE"?\s*=\s*"1"[^}\n]*\}\s*$/m);
    expect(plan.snippet).toMatch(/^\s*env\s*=\s*\{[^}\n]*"?JINI_DATA_DIR"?\s*=\s*"\/home\/u\/data"[^}\n]*\}\s*$/m);
  });

  it('vibe emits a TOML snippet', () => {
    const plan = planAgentInstall({ slug: 'vibe', spec: spec({ X: 'y' }), ctx: ctx() });
    if (plan.kind !== 'manual') throw new Error('expected manual');
    expect(plan.format).toBe('toml');
    expect(plan.configPath).toBe('/home/u/.vibe/config.toml');
    expect(plan.snippet).toContain('[[mcp_servers]]');
    expect(plan.snippet).toContain('name = "jini"');
    expect(plan.snippet).toContain('transport = "stdio"');
  });

  it('pi emits a generic mcpServers JSON snippet with env', () => {
    const plan = planAgentInstall({ slug: 'pi', spec: spec({ P: '1' }), ctx: ctx() });
    if (plan.kind !== 'manual') throw new Error('expected manual');
    expect(plan.format).toBe('json');
    const parsed = JSON.parse(plan.snippet);
    expect(parsed).toEqual({ mcpServers: { jini: { command: '/usr/bin/node', args: ['/app/cli.js', 'mcp'], env: { P: '1' } } } });
  });

  it('pi omits env from the snippet when empty', () => {
    const plan = planAgentInstall({ slug: 'pi', spec: spec(), ctx: ctx() });
    if (plan.kind !== 'manual') throw new Error('expected manual');
    const parsed = JSON.parse(plan.snippet);
    expect(parsed.mcpServers.jini).not.toHaveProperty('env');
  });

  it('hermes emits YAML with env lines', () => {
    const plan = planAgentInstall({ slug: 'hermes', spec: spec({ H: 'a', I: 'b' }), ctx: ctx() });
    if (plan.kind !== 'manual') throw new Error('expected manual');
    expect(plan.format).toBe('yaml');
    expect(plan.snippet).toContain('mcp_servers:');
    expect(plan.snippet).toContain('    env:');
    expect(plan.snippet).toContain('      H: "a"');
  });

  it('hermes omits the env block when env is empty', () => {
    const plan = planAgentInstall({ slug: 'hermes', spec: spec(), ctx: ctx() });
    if (plan.kind !== 'manual') throw new Error('expected manual');
    expect(plan.snippet).not.toContain('env:');
  });
});

describe('planAgentInstall — unknown slug', () => {
  it('throws on an unrecognized slug', () => {
    expect(() => planAgentInstall({ slug: 'bogus' as AgentSlug, spec: spec(), ctx: ctx() })).toThrow(/unknown agent slug: bogus/);
  });
});

describe('applyJsonInstall', () => {
  const plan: JsonInstallPlan = {
    kind: 'json',
    slug: 'openclaw',
    configPath: '/home/u/.openclaw/openclaw.json',
    keyPath: ['mcp', 'servers'],
    serverKey: 'jini',
    entry: { command: 'node' },
  };

  it('creates intermediate objects when writing into empty text', () => {
    const out = applyJsonInstall({ existingText: null, plan });
    expect(JSON.parse(out)).toEqual({ mcp: { servers: { jini: { command: 'node' } } } });
    expect(out.endsWith('\n')).toBe(true);
  });

  it('merges into existing config without clobbering siblings', () => {
    const existing = JSON.stringify({ mcp: { servers: { other: { command: 'x' } }, foo: 1 }, top: true });
    const out = JSON.parse(applyJsonInstall({ existingText: existing, plan }));
    expect(out).toEqual({ mcp: { servers: { other: { command: 'x' }, jini: { command: 'node' } }, foo: 1 }, top: true });
  });

  it('replaces a non-object node encountered along the key path', () => {
    const existing = JSON.stringify({ mcp: [1, 2, 3] });
    const out = JSON.parse(applyJsonInstall({ existingText: existing, plan }));
    expect(out.mcp.servers.jini).toEqual({ command: 'node' });
  });

  it('throws on non-JSON existing text', () => {
    expect(() => applyJsonInstall({ existingText: '{not json', plan })).toThrow(/is not valid JSON/);
  });

  it('throws when existing text is a JSON array (non-object)', () => {
    expect(() => applyJsonInstall({ existingText: '[1,2]', plan })).toThrow(/is not a JSON object/);
  });

  it('throws when existing text is JSON null or a primitive', () => {
    expect(() => applyJsonInstall({ existingText: 'null', plan })).toThrow(/is not a JSON object/);
    expect(() => applyJsonInstall({ existingText: '42', plan })).toThrow(/is not a JSON object/);
  });
});

describe('applyJsonInstall / removeJsonInstall — prototype-pollution guard (CR-007)', () => {
  const safeEntry = { command: 'node' };

  it('rejects a keyPath segment of "__proto__" instead of walking onto Object.prototype', () => {
    const plan: JsonInstallPlan = {
      kind: 'json', slug: 'openclaw', configPath: '/x.json',
      keyPath: ['__proto__'], serverKey: 'polluted', entry: true,
    };
    expect(() => applyJsonInstall({ existingText: null, plan })).toThrow(/dangerous|__proto__/i);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('rejects a serverKey of "__proto__"', () => {
    const plan: JsonInstallPlan = {
      kind: 'json', slug: 'openclaw', configPath: '/x.json',
      keyPath: ['mcp'], serverKey: '__proto__', entry: { polluted: true },
    };
    expect(() => applyJsonInstall({ existingText: null, plan })).toThrow(/dangerous|__proto__/i);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('rejects "constructor" and "prototype" segments anywhere in keyPath', () => {
    const base = { kind: 'json' as const, slug: 'openclaw' as const, configPath: '/x.json', serverKey: 'jini', entry: safeEntry };
    expect(() => applyJsonInstall({ existingText: null, plan: { ...base, keyPath: ['constructor'] } })).toThrow();
    expect(() => applyJsonInstall({ existingText: null, plan: { ...base, keyPath: ['a', 'prototype'] } })).toThrow();
    expect(() => applyJsonInstall({ existingText: null, plan: { ...base, keyPath: ['a', 'constructor', 'b'] } })).toThrow();
  });

  it('rejects a "constructor" serverKey', () => {
    const plan: JsonInstallPlan = {
      kind: 'json', slug: 'openclaw', configPath: '/x.json',
      keyPath: ['mcp'], serverKey: 'constructor', entry: { polluted: true },
    };
    expect(() => applyJsonInstall({ existingText: null, plan })).toThrow();
  });

  it('removeJsonInstall also rejects dangerous keyPath/serverKey segments, even against an empty file', () => {
    expect(() =>
      removeJsonInstall({ existingText: null, plan: {
        kind: 'json', slug: 'openclaw', configPath: '/x.json', keyPath: ['__proto__'], serverKey: 'jini', entry: {},
      } }),
    ).toThrow();
    expect(() =>
      removeJsonInstall({ existingText: '{}', plan: {
        kind: 'json', slug: 'openclaw', configPath: '/x.json', keyPath: ['mcp'], serverKey: 'prototype', entry: {},
      } }),
    ).toThrow();
  });

  it('still accepts an ordinary safe plan — the guard is not overly broad', () => {
    const plan: JsonInstallPlan = {
      kind: 'json', slug: 'openclaw', configPath: '/x.json',
      keyPath: ['mcp', 'servers'], serverKey: 'jini', entry: safeEntry,
    };
    expect(JSON.parse(applyJsonInstall({ existingText: null, plan }))).toEqual({ mcp: { servers: { jini: safeEntry } } });
  });
});

describe('removeJsonInstall', () => {
  const plan: JsonInstallPlan = {
    kind: 'json',
    slug: 'openclaw',
    configPath: '/cfg.json',
    keyPath: ['mcp', 'servers'],
    serverKey: 'jini',
    entry: {},
  };

  it('returns null for null/whitespace text (no-op)', () => {
    expect(removeJsonInstall({ existingText: null, plan })).toBeNull();
    expect(removeJsonInstall({ existingText: '   ', plan })).toBeNull();
  });

  it('returns null when an intermediate key is missing or not an object', () => {
    expect(removeJsonInstall({ existingText: JSON.stringify({ mcp: 5 }), plan })).toBeNull();
    expect(removeJsonInstall({ existingText: JSON.stringify({}), plan })).toBeNull();
  });

  it('returns null when the server key is absent', () => {
    expect(removeJsonInstall({ existingText: JSON.stringify({ mcp: { servers: { other: {} } } }), plan })).toBeNull();
  });

  it('deletes the server entry and returns the new text', () => {
    const existing = JSON.stringify({ mcp: { servers: { jini: { command: 'node' }, other: {} } } });
    const out = removeJsonInstall({ existingText: existing, plan });
    expect(out).not.toBeNull();
    expect(JSON.parse(out as string)).toEqual({ mcp: { servers: { other: {} } } });
  });
});

describe('planAgentInstall — characterization pins (before refactor)', () => {
  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])(
    'throws for the Object.prototype member name %s instead of resolving it as a planner',
    (slug) => {
      expect(() => planAgentInstall({ slug: slug as AgentSlug, spec: spec(), ctx: ctx() })).toThrow(`unknown agent slug: ${slug}`);
    },
  );

  it('reads APPDATA from the injected env option, not process.env, for cline on win32', () => {
    process.env.APPDATA = '/ignored';
    const plan = planAgentInstall({ slug: 'cline', spec: spec(), ctx: ctx({ platform: 'win32' }) }, { env: { APPDATA: '/appdata' } });
    expect(plan).toMatchObject({ configPath: '/appdata/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json' });
  });

  it('falls back to <home>/AppData/Roaming for trae on win32 when the injected env has no APPDATA', () => {
    const plan = planAgentInstall({ slug: 'trae', spec: spec(), ctx: ctx({ platform: 'win32' }) }, { env: {} });
    expect(plan).toMatchObject({ configPath: '/home/u/AppData/Roaming/Trae/User/mcp.json' });
  });

  it('uses the injected APPDATA for trae on win32', () => {
    const plan = planAgentInstall({ slug: 'trae', spec: spec(), ctx: ctx({ platform: 'win32' }) }, { env: { APPDATA: '/appdata' } });
    expect(plan).toMatchObject({ configPath: '/appdata/Trae/User/mcp.json' });
  });

  it('treats any non-darwin, non-win32 platform like linux for cline and trae', () => {
    expect(planAgentInstall({ slug: 'trae', spec: spec(), ctx: ctx({ platform: 'freebsd' }) })).toMatchObject({ configPath: '/home/u/.config/Trae/User/mcp.json' });
    expect(planAgentInstall({ slug: 'cline', spec: spec(), ctx: ctx({ platform: 'freebsd' }) }))
      .toMatchObject({ configPath: '/home/u/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json' });
  });

  it('pins the exact entry shapes for cursor, copilot, cline, openclaw, antigravity, trae and opencode with env', () => {
    const s = spec({ A: '1' });
    const base = { command: '/usr/bin/node', args: ['/app/cli.js', 'mcp'] };
    const entry = (slug: AgentSlug) => (planAgentInstall({ slug, spec: s, ctx: ctx() }) as JsonInstallPlan).entry;
    expect(JSON.stringify(entry('cursor'))).toBe(JSON.stringify({ ...base, type: 'stdio', env: { A: '1' } }));
    expect(JSON.stringify(entry('copilot'))).toBe(JSON.stringify({ ...base, type: 'local', tools: ['*'], env: { A: '1' } }));
    expect(JSON.stringify(entry('cline'))).toBe(JSON.stringify({ ...base, disabled: false, autoApprove: [], env: { A: '1' } }));
    expect(JSON.stringify(entry('openclaw'))).toBe(JSON.stringify({ ...base, env: { A: '1' } }));
    expect(JSON.stringify(entry('antigravity'))).toBe(JSON.stringify({ ...base, env: { A: '1' } }));
    expect(JSON.stringify(entry('trae'))).toBe(JSON.stringify({ ...base, env: { A: '1' } }));
    expect(JSON.stringify(entry('opencode'))).toBe(JSON.stringify({ type: 'local', command: ['/usr/bin/node', '/app/cli.js', 'mcp'], enabled: true, environment: { A: '1' } }));
  });

  it('pins the pi snippet text exactly, key order included', () => {
    const plan = planAgentInstall({ slug: 'pi', spec: spec({ A: '1' }), ctx: ctx() });
    expect(plan).toMatchObject({ snippet: JSON.stringify({ mcpServers: { jini: { command: '/usr/bin/node', args: ['/app/cli.js', 'mcp'], env: { A: '1' } } } }, null, 2) });
  });

  it('builds a relative config path when the injected APPDATA is relative (reported, not fixed)', () => {
    // A relative APPDATA is not rejected, so the json strategy would write relative to the cwd.
    const plan = planAgentInstall({ slug: 'trae', spec: spec(), ctx: ctx({ platform: 'win32' }) }, { env: { APPDATA: 'rel/appdata' } });
    expect(plan).toMatchObject({ configPath: 'rel/appdata/Trae/User/mcp.json' });
  });

  it('puts a dash-leading serverName into the agent argv as-is, where the agent CLI may read it as a flag (reported, not fixed)', () => {
    const plan = planAgentInstall({ slug: 'claude', spec: spec(), ctx: ctx({ serverName: '--scope=project' }) });
    expect(plan).toMatchObject({ addArgv: ['mcp', 'add', '--scope', 'user', '--scope=project', '--', '/usr/bin/node', '/app/cli.js', 'mcp'] });
  });

  it('writes serverName and env keys into the hermes YAML snippet unquoted (reported, not fixed)', () => {
    // A name containing a newline can inject extra YAML structure into the print-only snippet.
    const plan = planAgentInstall({ slug: 'hermes', spec: spec({ 'K: x\n  evil': 'v' }), ctx: ctx({ serverName: 'n:\n  injected: true' }) });
    expect(plan).toMatchObject({ snippet: 'mcp_servers:\n  n:\n  injected: true:\n    command: "/usr/bin/node"\n    args: ["/app/cli.js","mcp"]\n    env:\n      K: x\n  evil: "v"' });
  });
});

// Real-filesystem checks for the antigravity path, against a throwaway HOME
// only (never the real one). `installInto` is the read → merge → write a host
// executor performs with the plan; the package itself ships no executor.
describe('antigravity install against a temp HOME', () => {
  const homes: string[] = [];
  afterEach(async () => {
    await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
  });

  async function tempHome(): Promise<string> {
    const home = await mkdtemp(path.join(tmpdir(), 'jini-agy-home-'));
    homes.push(home);
    return home;
  }

  async function readOrNull(file: string): Promise<string | null> {
    try {
      return await readFile(file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async function installInto(home: string): Promise<JsonInstallPlan> {
    const plan = planAgentInstall({ slug: 'antigravity', spec: spec(), ctx: ctx({ home }) });
    if (plan.kind !== 'json') throw new Error('expected json');
    const next = applyJsonInstall({ existingText: await readOrNull(plan.configPath), plan });
    await mkdir(path.dirname(plan.configPath), { recursive: true });
    await writeFile(plan.configPath, next);
    return plan;
  }

  const configFile = (home: string) => path.join(home, '.gemini', 'config', 'mcp_config.json');
  const legacyFile = (home: string) => path.join(home, '.gemini', 'antigravity', 'mcp_config.json');
  const entry = { command: '/usr/bin/node', args: ['/app/cli.js', 'mcp'] };

  it('a fresh HOME gets the bridge entry in config/ and no antigravity/ file', async () => {
    const home = await tempHome();
    const plan = await installInto(home);
    expect(plan.configPath).toBe(configFile(home));
    expect(JSON.parse((await readOrNull(configFile(home))) ?? 'null')).toEqual({ mcpServers: { jini: entry } });
    expect(await readOrNull(legacyFile(home))).toBeNull();
  });

  it.skipIf(process.platform === 'win32')('an antigravity/ symlink to config/ ends with exactly one entry, still a symlink', async () => {
    const home = await tempHome();
    await mkdir(path.dirname(configFile(home)), { recursive: true });
    await mkdir(path.dirname(legacyFile(home)), { recursive: true });
    await writeFile(configFile(home), '{}\n');
    await symlink(path.join('..', 'config', 'mcp_config.json'), legacyFile(home));
    await installInto(home);
    const viaLink = JSON.parse((await readOrNull(legacyFile(home))) ?? 'null');
    expect(Object.keys(viaLink.mcpServers)).toEqual(['jini']);
    expect(viaLink).toEqual(JSON.parse((await readOrNull(configFile(home))) ?? 'null'));
    expect((await lstat(legacyFile(home))).isSymbolicLink()).toBe(true);
  });

  it('a regular-file antigravity/ config is left byte-for-byte untouched', async () => {
    const home = await tempHome();
    const ideText = '{ "mcpServers": { "ide-only": { "command": "ide" } } }';
    await mkdir(path.dirname(legacyFile(home)), { recursive: true });
    await writeFile(legacyFile(home), ideText);
    await installInto(home);
    expect(await readOrNull(legacyFile(home))).toBe(ideText);
    expect((await lstat(legacyFile(home))).isSymbolicLink()).toBe(false);
    expect(JSON.parse((await readOrNull(configFile(home))) ?? 'null')).toEqual({ mcpServers: { jini: entry } });
  });

  it("keeps the user's other servers and top-level keys in config/", async () => {
    const home = await tempHome();
    const existing = { theme: 'dark', mcpServers: { other: { command: 'other', args: ['x'] }, jini: { command: 'stale' } } };
    await mkdir(path.dirname(configFile(home)), { recursive: true });
    await writeFile(configFile(home), JSON.stringify(existing));
    await installInto(home);
    expect(JSON.parse((await readOrNull(configFile(home))) ?? 'null')).toEqual({
      theme: 'dark',
      mcpServers: { other: { command: 'other', args: ['x'] }, jini: entry },
    });
  });
});
