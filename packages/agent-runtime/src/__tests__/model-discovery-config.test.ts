import { homedir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { modelConfigFiles, parseConfiguredModel, parseSettingsJson, readModelConfiguration } from '../model-discovery-config.js';
import type { ModelDiscoveryContext, ModelDiscoveryDeps } from '../model-discovery-types.js';

const context: ModelDiscoveryContext = { executable: '/cli', cwd: '/work', env: { HOME: '/h' } };
const signal = new AbortController().signal;
const paths = (agentId: string, overrides: Partial<ModelDiscoveryContext> = {}) => modelConfigFiles(agentId, { ...context, ...overrides }).map(file => file.path);

function fakeDeps(files: Record<string, string> = {}, projectRoot?: string | null) {
  const reads: string[] = [];
  const deps: ModelDiscoveryDeps = {
    process: { async run() { return { stdout: '', stderr: '' }; } },
    fs: { async read(path) { reads.push(path); return files[path] ?? null; }, ...(projectRoot === undefined ? {} : { async projectRoot() { return projectRoot; } }) },
    http: { async list() { return { ok: false, kind: 'auth_failed', latencyMs: 1 }; } },
    credential: { async connection() { return null; } },
    acp: { async probe() { return { models: [], source: 'rpc', coverage: 'account' }; } },
    rpc: { async probe() { return { models: [], source: 'rpc', coverage: 'account' }; } },
    clock: { now: () => 0 }, cache: new Map(),
  };
  return { deps, reads };
}

describe('modelConfigFiles', () => {
  it('falls back to the OS home directory when HOME is unset', () => {
    expect(paths('copilot', { env: {} })).toEqual([`${homedir()}/.copilot/config.json`]);
  });
  it('resolves Codex config under CODEX_HOME, adding the profile file only when a profile is set', () => {
    expect(paths('codex')).toEqual(['/h/.codex/config.toml', '/work/.codex/config.toml']);
    expect(paths('codex', { env: { CODEX_HOME: '/cx' }, profile: 'fast' })).toEqual(['/cx/config.toml', '/cx/fast.config.toml', '/work/.codex/config.toml']);
  });
  it('limits Claude settings to the requested setting sources, rooted at the project root', () => {
    expect(paths('claude', { projectRoot: '/repo' })).toEqual(['/h/.claude/settings.json', '/repo/.claude/settings.json', '/repo/.claude/settings.local.json']);
    expect(paths('claude', { env: { HOME: '/h', CLAUDE_CONFIG_DIR: '/cc' }, settingSources: ['user'] })).toEqual(['/cc/settings.json']);
    expect(paths('claude', { settingSources: ['project', 'local'] })).toEqual(['/work/.claude/settings.json', '/work/.claude/settings.local.json']);
  });
  it('resolves OpenCode state and config homes from XDG overrides', () => {
    expect(paths('opencode', { env: { HOME: '/h', XDG_STATE_HOME: '/state', XDG_CONFIG_HOME: '/conf' }, projectRoot: '/repo' })).toEqual([
      '/state/opencode/model.json', '/conf/opencode/opencode.json', '/conf/opencode/opencode.jsonc',
      '/repo/opencode.json', '/repo/opencode.jsonc', '/work/opencode.json', '/work/opencode.jsonc',
    ]);
    expect(paths('opencode')[0]).toBe('/h/.local/state/opencode/model.json');
  });
  it('honours agent directory overrides for Pi and Qoder', () => {
    expect(paths('pi')).toEqual(['/h/.pi/agent/settings.json', '/work/.pi/settings.json']);
    expect(paths('pi', { env: { PI_CODING_AGENT_DIR: '/pi' } })[0]).toBe('/pi/settings.json');
    expect(paths('qoder')).toEqual(['/h/.qoder/settings.json', '/work/.qoder/settings.json', '/work/.qoder/settings.local.json']);
    expect(paths('qoder', { env: { QODER_CONFIG_DIR: '/q' } })[0]).toBe('/q/settings.json');
  });
  it('uses an explicit Aider config path instead of the layered defaults', () => {
    expect(paths('aider')).toEqual(['/h/.aider.conf.yml', '/work/.aider.conf.yml', '/work/.aider.conf.yml']);
    expect(paths('aider', { configPath: '/custom.yml' })).toEqual(['/custom.yml']);
  });
  it('lists the single-source agents and their keys', () => {
    const keyed = (agentId: string) => modelConfigFiles(agentId, context).map(file => `${file.path}#${file.key ?? ''}`);
    expect(keyed('antigravity')).toEqual(['/h/.gemini/antigravity-cli/settings.json#model']);
    expect(keyed('grok-build')).toEqual(['/h/.grok/config.toml#models.model']);
    expect(keyed('codebuddy')).toEqual(['/h/.codebuddy/settings.json#model', '/work/.codebuddy/settings.json#model', '/work/.codebuddy/settings.local.json#model']);
    expect(keyed('cursor-agent')).toEqual(['/h/.cursor/cli-config.json#model']);
    expect(keyed('droid')).toEqual(['/h/.factory/settings.json#sessionDefaultSettings.model']);
    expect(keyed('qwen')).toEqual(['/h/.qwen/settings.json#model.name', '/work/.qwen/settings.json#model.name']);
    expect(keyed('deepseek')).toEqual(['/h/.deepseek/config.toml#', '/h/.codewhale/config.toml#']);
    expect(keyed('mimo')).toEqual(['/h/.config/mimocode/mimocode.json#model', '/work/.mimocode/mimocode.jsonc#model']);
    expect(keyed('crush')).toEqual(['/h/.config/crush/crush.json#models.large.model', '/work/crush.json#models.large.model']);
  });
  it('returns no files for agents without documented config', () => {
    expect(paths('kimi')).toEqual([]);
  });
});

describe('parseSettingsJson', () => {
  it('strips JSONC comments and trailing commas but keeps URLs inside strings', () => {
    expect(parseSettingsJson('{\n  // note\n  "url": "https://x.example/a", /* block */\n  "list": [1,],\n}')).toEqual({ url: 'https://x.example/a', list: [1] });
  });
  it('returns null for arrays, JSON null and invalid input', () => {
    expect(parseSettingsJson('[1]')).toBeNull();
    expect(parseSettingsJson('null')).toBeNull();
    expect(parseSettingsJson('{')).toBeNull();
  });
});

describe('parseConfiguredModel', () => {
  const json = (key?: string) => ({ path: '/f.json', format: 'json' as const, ...(key ? { key } : {}) });
  it('reads a trimmed JSON model at the default or dotted key', () => {
    expect(parseConfiguredModel(json(), '{"model":" m1 "}')).toBe('m1');
    expect(parseConfiguredModel(json('model.name'), '{"model":{"name":"m2"}}')).toBe('m2');
    expect(parseConfiguredModel(json('model.name'), '{"model":"flat"}')).toBeUndefined();
    expect(parseConfiguredModel(json(), '{"model":{"id":"x"}}')).toBeUndefined();
    expect(parseConfiguredModel(json(), 'not json')).toBeUndefined();
  });
  it('qualifies the first OpenCode recent entry only when both parts are present', () => {
    expect(parseConfiguredModel(json('recent'), '{"recent":[{"providerID":"p","modelID":"m"}]}')).toBe('p/m');
    expect(parseConfiguredModel(json('recent'), '{"recent":[{"modelID":"m"}]}')).toBeUndefined();
    expect(parseConfiguredModel(json('recent'), '{"recent":[]}')).toBeUndefined();
    expect(parseConfiguredModel(json('recent'), '{"recent":"p/m"}')).toBe('p/m');
  });
  it('qualifies a Pi default model with its default provider, or yields nothing without one', () => {
    expect(parseConfiguredModel(json('defaultModel'), '{"defaultModel":"m","defaultProvider":"p"}')).toBe('p/m');
    expect(parseConfiguredModel(json('defaultModel'), '{"defaultModel":"m"}')).toBeUndefined();
    expect(parseConfiguredModel(json('defaultModel'), '{"defaultProvider":"p"}')).toBeUndefined();
  });
  it('reads a YAML model line with quotes and trailing comments', () => {
    expect(parseConfiguredModel({ path: '/a.yml', format: 'yaml' }, 'x: 1\nmodel: "openai/gpt-x" # main\n')).toBe('openai/gpt-x');
    expect(parseConfiguredModel({ path: '/a.yml', format: 'yaml' }, 'x: 1\n')).toBeUndefined();
  });
  it('reads the top-level TOML model, preferring the active profile section', () => {
    const toml = { path: '/c.toml', format: 'toml' as const };
    const raw = 'model = "top"\n[profiles.fast]\nmodel = "fast-model"\n[other]\nmodel = "ignored"\n';
    expect(parseConfiguredModel(toml, raw)).toBe('top');
    expect(parseConfiguredModel(toml, raw, 'fast')).toBe('fast-model');
    expect(parseConfiguredModel(toml, raw, 'missing')).toBe('top');
    expect(parseConfiguredModel(toml, 'name = "x"\n')).toBeUndefined();
  });
  it('reads the [models] section for a models.model TOML key', () => {
    expect(parseConfiguredModel({ path: '/g.toml', format: 'toml', key: 'models.model' }, 'model = "top"\n[models]\nmodel = "grok-x"\n')).toBe('grok-x');
  });
});

describe('readModelConfiguration', () => {
  it('finds the project root for Claude, Aider and OpenCode when the host can and none is given', async () => {
    const fake = fakeDeps({ '/repo/.aider.conf.yml': 'model: from-repo\n' }, '/repo');
    expect((await readModelConfiguration('aider', context, fake.deps, signal)).selection).toBe('from-repo');
    expect(fake.reads).toContain('/repo/.aider.conf.yml');
  });
  it('keeps the working directory as root when the project root lookup finds nothing', async () => {
    const fake = fakeDeps({}, null);
    await readModelConfiguration('opencode', context, fake.deps, signal);
    expect(fake.reads).toContain('/work/opencode.json');
    expect(fake.reads).toHaveLength(7);
  });
  it('does not look up the project root for other agents or when one is given', async () => {
    let lookups = 0;
    const fake = fakeDeps();
    fake.deps.fs.projectRoot = async () => { lookups++; return '/repo'; };
    await readModelConfiguration('qwen', context, fake.deps, signal);
    await readModelConfiguration('claude', { ...context, projectRoot: '/given' }, fake.deps, signal);
    expect(lookups).toBe(0);
    expect(fake.reads).toContain('/given/.claude/settings.json');
  });
  it('lets later config files override earlier ones and skips files without a model', async () => {
    const fake = fakeDeps({ '/h/.qwen/settings.json': '{"model":{"name":"global"}}', '/work/.qwen/settings.json': '{"other":1}' });
    expect((await readModelConfiguration('qwen', context, fake.deps, signal)).selection).toBe('global');
    const local = fakeDeps({ '/h/.qwen/settings.json': '{"model":{"name":"global"}}', '/work/.qwen/settings.json': '{"model":{"name":"local"}}' });
    expect((await readModelConfiguration('qwen', context, local.deps, signal)).selection).toBe('local');
  });
  it('merges Pi settings so provider and model may come from different files', async () => {
    const fake = fakeDeps({ '/h/.pi/agent/settings.json': '{"defaultProvider":"p"}', '/work/.pi/settings.json': '{"defaultModel":"m"}' });
    expect((await readModelConfiguration('pi', context, fake.deps, signal)).selection).toBe('p/m');
    const broken = fakeDeps({ '/h/.pi/agent/settings.json': 'not json' });
    expect((await readModelConfiguration('pi', context, broken.deps, signal)).selection).toBeUndefined();
  });
  it('applies inline OpenCode and Mimo config content over files', async () => {
    const fake = fakeDeps({ '/h/.config/mimocode/mimocode.json': '{"model":"file"}' });
    expect((await readModelConfiguration('opencode', { ...context, env: { HOME: '/h', OPENCODE_CONFIG_CONTENT: '{"model":"inline-oc"}' } }, fake.deps, signal)).selection).toBe('inline-oc');
    expect((await readModelConfiguration('mimo', { ...context, env: { HOME: '/h', MIMOCODE_CONFIG_CONTENT: '{"model":"inline-mimo"}' } }, fake.deps, signal)).selection).toBe('inline-mimo');
    expect((await readModelConfiguration('mimo', { ...context, env: { HOME: '/h', MIMOCODE_CONFIG_CONTENT: '{}' } }, fake.deps, signal)).selection).toBe('file');
  });
  it('lets the first listed model env variable win over later ones and over files', async () => {
    const fake = fakeDeps({ '/h/.qwen/settings.json': '{"model":{"name":"file"}}' });
    const env = { HOME: '/h', OPENAI_MODEL: 'openai-env', QWEN_MODEL: 'qwen-env' };
    expect((await readModelConfiguration('qwen', { ...context, env }, fake.deps, signal)).selection).toBe('qwen-env');
    expect((await readModelConfiguration('qwen', { ...context, env: { HOME: '/h', OPENAI_MODEL: 'openai-env', QWEN_MODEL: ' ' } }, fake.deps, signal)).selection).toBe('openai-env');
  });
  it('reads Claude --settings as inline JSON or as a file, and records it in the fingerprint', async () => {
    const fake = fakeDeps({ '/s.json': '{"model":"from-file"}' });
    const inline = await readModelConfiguration('claude', { ...context, projectRoot: '/work', settings: ' {"model":"inline"}' }, fake.deps, signal);
    expect(inline.selection).toBe('inline');
    expect(inline.fingerprintMaterial).toContain('inline');
    expect((await readModelConfiguration('claude', { ...context, projectRoot: '/work', settings: '/s.json' }, fake.deps, signal)).selection).toBe('from-file');
    const missing = await readModelConfiguration('claude', { ...context, projectRoot: '/work', env: { HOME: '/h', ANTHROPIC_MODEL: 'env' }, settings: '/missing.json' }, fake.deps, signal);
    expect(missing.selection).toBe('env');
    expect((await readModelConfiguration('claude', { ...context, projectRoot: '/work', settings: '{}' }, fake.deps, signal)).selection).toBeUndefined();
  });
  it('lets an explicit launch model override every configured source', async () => {
    const fake = fakeDeps({ '/h/.qwen/settings.json': '{"model":{"name":"file"}}' });
    expect((await readModelConfiguration('qwen', { ...context, model: 'explicit', env: { HOME: '/h', QWEN_MODEL: 'env' } }, fake.deps, signal)).selection).toBe('explicit');
  });
  it('omits the selection and fingerprints every file path with its raw content', async () => {
    const fake = fakeDeps({ '/h/.copilot/config.json': '{"other":1}' });
    expect(await readModelConfiguration('copilot', context, fake.deps, signal)).toEqual({ fingerprintMaterial: JSON.stringify([[['/h/.copilot/config.json', '{"other":1}']], '']) });
  });
});
