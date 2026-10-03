import { afterEach, describe, expect, it } from 'vitest';
import { agentCapabilities } from '../../capabilities.js';
import { getAgentDef } from '../../registry.js';

/**
 * A host embedding `claude` as a product assistant must not inherit the operator's personal Claude
 * Code setup: the operator's ~/.claude SessionStart hooks were injecting a "Code Discovery Protocol"
 * text into every site-assistant run. `--setting-sources ""` loads no user/project/local settings
 * (so no hooks, no personal plugins) and, unlike CLAUDE_CONFIG_DIR staging, keeps Keychain login.
 */
describe('claude buildArgs — settingSources', () => {
  afterEach(() => agentCapabilities.delete('claude'));

  it('passes --setting-sources with the joined list (empty = none) when the CLI supports it', () => {
    agentCapabilities.set('claude', { settingSources: true });
    const def = getAgentDef({ id: 'claude' })!;
    const none = def.buildArgs({ prompt: '', imagePaths: [] }, { extraAllowedDirs: [], options: { settingSources: [] }, runtimeContext: {} });
    expect(none.slice(none.indexOf('--setting-sources'), none.indexOf('--setting-sources') + 2)).toEqual(['--setting-sources', '']);
    const some = def.buildArgs({ prompt: '', imagePaths: [] }, { extraAllowedDirs: [], options: { settingSources: ['project', 'local'] }, runtimeContext: {} });
    expect(some.slice(some.indexOf('--setting-sources'), some.indexOf('--setting-sources') + 2)).toEqual(['--setting-sources', 'project,local']);
  });

  it('omits the flag when unset, and when the probe says the CLI lacks it (an unknown option exits 1)', () => {
    agentCapabilities.set('claude', { settingSources: true });
    const def = getAgentDef({ id: 'claude' })!;
    expect(def.buildArgs({ prompt: '', imagePaths: [] }, { extraAllowedDirs: [], options: {}, runtimeContext: {} })).not.toContain('--setting-sources');
    agentCapabilities.set('claude', { settingSources: false });
    expect(def.buildArgs({ prompt: '', imagePaths: [] }, { extraAllowedDirs: [], options: { settingSources: [] }, runtimeContext: {} })).not.toContain('--setting-sources');
  });

  it('probes for the flag in `claude -p --help`', () => {
    expect(getAgentDef({ id: 'claude' })!.capabilityFlags?.['--setting-sources']).toBe('settingSources');
  });
});

/**
 * With every settings layer off, a host can still hand the run the few settings it wants (e.g. one
 * PreToolUse hook) through `--settings <json-or-path>`, which the CLI applies on top of — and
 * independently of — `--setting-sources` (verified on Claude Code 2.1.283).
 */
describe('claude buildArgs — settings', () => {
  it('passes --settings with the value verbatim', () => {
    const json = '{"hooks":{}}';
    const args = getAgentDef({ id: 'claude' })!.buildArgs({ prompt: '', imagePaths: [] }, { extraAllowedDirs: [], options: { settings: json }, runtimeContext: {} });
    expect(args.slice(args.indexOf('--settings'), args.indexOf('--settings') + 2)).toEqual(['--settings', json]);
  });

  it('omits the flag when unset or empty', () => {
    const def = getAgentDef({ id: 'claude' })!;
    expect(def.buildArgs({ prompt: '', imagePaths: [] }, { extraAllowedDirs: [], options: {}, runtimeContext: {} })).not.toContain('--settings');
    expect(def.buildArgs({ prompt: '', imagePaths: [] }, { extraAllowedDirs: [], options: { settings: '' }, runtimeContext: {} })).not.toContain('--settings');
  });
});
