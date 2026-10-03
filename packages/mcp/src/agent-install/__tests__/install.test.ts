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

  it('antigravity targets the gemini config', () => {
    const plan = planAgentInstall({ slug: 'antigravity', spec: spec(), ctx: ctx() });
    if (plan.kind !== 'json') throw new Error('expected json');
    expect(plan.configPath).toBe('/home/u/.gemini/antigravity/mcp_config.json');
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
