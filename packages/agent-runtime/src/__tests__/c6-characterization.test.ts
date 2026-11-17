/** C6 characterization: behaviour the vocabulary move and the Codex option re-homing must keep (pinned before either;
 * after the move only the import paths and the option's spelling changed, never an expectation). */
import { describe, expect, it } from 'vitest';
import { RuntimeSelectionError, type ModelDiscoveryContext, type ModelDiscoveryDeps, type RuntimeAgentDef } from '@jini-ai/core/contracts/agents';
import { resolveModelForLaunch } from '../model-discovery.js';
import { createAgentRuntimeState } from '../runtime-state.js';
import { bindRuntimeAgentDef } from '../runtime-def-binding.js';
import { getAgentDef } from '../registry.js';

const context: ModelDiscoveryContext = { executable: '/host-cli', cwd: '/workspace', env: { HOME: '/fixture' } };

function hostDeps(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): ModelDiscoveryDeps {
  const unexpected = async (): Promise<never> => { throw new Error('Unexpected native effect'); };
  return {
    process: { run: unexpected }, fs: { read: async () => null }, http: { list: unexpected },
    credential: { connection: unexpected }, acp: { probe: unexpected }, rpc: { probe: unexpected },
    clock: { now: () => 0 }, cache: new Map(),
  };
}

describe('launch refusals keep their class', () => {
  const def = { id: 'fixture', fallbackModels: [{ id: 'chosen', label: 'Chosen', reasoning: [{ id: 'high', label: 'High' }] }] };

  it('an unsupported effort rejects with the RuntimeSelectionError a launcher checks with instanceof', async () => {
    const refusal = await resolveModelForLaunch({ def, context: { ...context, model: 'chosen' }, effort: 'minimal', deps: hostDeps() }).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(RuntimeSelectionError);
    expect((refusal as Error).message).toBe("Unknown effort 'minimal' for 'fixture'. Available effort levels: high (empty means Default).");
  });

  it('an unresolved model stays a plain Error, so a launcher does not show it as a validated refusal', async () => {
    const failure = await resolveModelForLaunch({ def: { ...def, supportsCustomModel: false }, context: { ...context, model: 'auto' }, deps: hostDeps() }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(RuntimeSelectionError);
  });
});

describe('binding a definition to runtime state', () => {
  const input = { prompt: 'question', imagePaths: [] };
  const pluginFlag = (args: readonly string[]) => args.slice(args.indexOf('--disable'), args.indexOf('--disable') + 2);

  it('gives Codex `--disable plugins` only when the host policy says so', () => {
    const state = createAgentRuntimeState({});
    const codex = getAgentDef({ id: 'codex' })!;
    expect(pluginFlag(bindRuntimeAgentDef({ def: codex, state }, { codex: { disablePlugins: true } }).buildArgs(input))).toEqual(['--disable', 'plugins']);
    expect(bindRuntimeAgentDef({ def: codex, state }, { codex: { disablePlugins: false } }).buildArgs(input)).not.toContain('--disable');
    expect(bindRuntimeAgentDef({ def: codex, state }).buildArgs(input)).not.toContain('--disable');
  });

  it('never gives the Codex plugin flag to another CLI', () => {
    const state = createAgentRuntimeState({});
    const claude = getAgentDef({ id: 'claude' })!;
    expect(bindRuntimeAgentDef({ def: claude, state }, { codex: { disablePlugins: true } }).buildArgs(input)).not.toContain('--disable');
  });

  it('passes the probed capabilities of that state and keeps the caller options', () => {
    const state = createAgentRuntimeState({});
    state.capabilities.set('fixture', { addDir: true });
    const seen: unknown[] = [];
    const def = { id: 'fixture', name: 'Fixture', bin: 'fixture', versionArgs: [], fallbackModels: [],
      buildArgs: (_required: unknown, optional: { options?: Record<string, unknown> } = {}) => { seen.push(optional.options); return []; } } as unknown as RuntimeAgentDef;
    const bound = bindRuntimeAgentDef({ def, state });
    bound.buildArgs(input, { options: { filesystemRoot: '/site' } });
    expect(seen).toEqual([{ filesystemRoot: '/site', capabilities: { addDir: true } }]);
    expect(def).not.toBe(bound);
  });
});
