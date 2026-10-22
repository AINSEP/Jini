import { afterEach, describe, expect, it } from 'vitest';
import { agentCapabilities } from '../../capabilities.js';
import { agentSupportsChromeIntegration, BASE_AGENT_DEFS, getAgentDef, runtimeSupportsChromeIntegration } from '../../registry.js';
import type { RuntimeBuildOptions } from '../../types.js';

/**
 * `RuntimeBuildOptions.chromeIntegration` → Claude Code's `--chrome` / `--no-chrome` (2.1.307
 * `-p --help`: "Enable/Disable Claude in Chrome integration"). Probe-gated: a CLI whose help does
 * not list the flag gets neither, since an unknown option exits 1 and kills the chat.
 */
describe('claude buildArgs — chromeIntegration', () => {
  afterEach(() => agentCapabilities.delete('claude'));
  const def = getAgentDef({ id: 'claude' })!;
  const argv = (options: RuntimeBuildOptions) => def.buildArgs({ prompt: '', imagePaths: [] }, { extraAllowedDirs: [], options, runtimeContext: {} });

  it('emits --chrome for true and --no-chrome for false when the CLI supports it', () => {
    agentCapabilities.set('claude', { chrome: true });
    const on = argv({ chromeIntegration: true });
    expect(on.at(-1)).toBe('--chrome');
    expect(on).not.toContain('--no-chrome');
    const off = argv({ chromeIntegration: false });
    expect(off.at(-1)).toBe('--no-chrome');
    expect(off).not.toContain('--chrome');
  });

  it('is byte-identical to the previous argv when the option is absent', () => {
    agentCapabilities.set('claude', { chrome: true });
    const absent = argv({});
    expect(absent).not.toContain('--chrome');
    expect(absent).not.toContain('--no-chrome');
    agentCapabilities.set('claude', {});
    expect(argv({})).toEqual(absent);
  });

  it('emits neither flag when the probe did not find it', () => {
    agentCapabilities.set('claude', { chrome: false });
    for (const chromeIntegration of [true, false]) {
      const args = argv({ chromeIntegration });
      expect(args).not.toContain('--chrome');
      expect(args).not.toContain('--no-chrome');
    }
  });

  it('a host-scoped capability map gates it the same way', () => {
    expect(argv({ chromeIntegration: true, capabilities: { chrome: true } }).at(-1)).toBe('--chrome');
    expect(argv({ chromeIntegration: true, capabilities: {} })).not.toContain('--chrome');
  });

  it('declares the --chrome probe and the def-level support flag', () => {
    expect(def.capabilityFlags?.['--chrome']).toBe('chrome');
    expect(def.supportsChromeIntegration).toBe(true);
  });
});

describe('runtimeSupportsChromeIntegration', () => {
  it('is true only for an explicit supportsChromeIntegration: true', () => {
    expect(runtimeSupportsChromeIntegration({ def: { supportsChromeIntegration: true } })).toBe(true);
    expect(runtimeSupportsChromeIntegration({ def: { supportsChromeIntegration: false } })).toBe(false);
    expect(runtimeSupportsChromeIntegration({ def: {} })).toBe(false);
  });

  it('is declared by claude only among the built-in defs', () => {
    expect(BASE_AGENT_DEFS.filter((def) => runtimeSupportsChromeIntegration({ def })).map((def) => def.id)).toEqual(['claude']);
  });

  it('resolves by agent id through the registry or an injected lookup', () => {
    expect(agentSupportsChromeIntegration({ agentId: 'claude' })).toBe(true);
    expect(agentSupportsChromeIntegration({ agentId: 'codex' })).toBe(false);
    expect(agentSupportsChromeIntegration({ agentId: 'missing' })).toBe(false);
    const getDef = ({ id }: { id: string }) => (id === 'host-cli' ? { supportsChromeIntegration: true } : null);
    expect(agentSupportsChromeIntegration({ agentId: 'host-cli' }, { getDef })).toBe(true);
    expect(agentSupportsChromeIntegration({ agentId: 'claude' }, { getDef })).toBe(false);
  });
});
