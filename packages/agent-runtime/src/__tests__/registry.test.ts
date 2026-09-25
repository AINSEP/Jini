import { afterEach, describe, expect, it } from 'vitest';
import { agentCapabilities } from '../capabilities.js';
import { AGENT_DEFS, BASE_AGENT_DEFS, getAgentDef, runtimeSupportsExternalTools } from '../registry.js';

// `agentCapabilities` is process-global, so a probe result set by one test would
// otherwise decide what argv a later one builds.
afterEach(() => {
  agentCapabilities.delete('claude');
});

describe('registry', () => {
  it('exposes a non-empty catalog of built-in agent defs', () => {
    expect(BASE_AGENT_DEFS.length).toBeGreaterThan(20);
    expect(AGENT_DEFS).toEqual(BASE_AGENT_DEFS);
  });

  it('has no duplicate ids in the built-in catalog', () => {
    const ids = BASE_AGENT_DEFS.map((def) => def.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every def has the minimum required RuntimeAgentDef shape', () => {
    for (const def of BASE_AGENT_DEFS) {
      expect(typeof def.id).toBe('string');
      expect(def.id.length).toBeGreaterThan(0);
      expect(typeof def.name).toBe('string');
      expect(typeof def.bin).toBe('string');
      expect(Array.isArray(def.versionArgs)).toBe(true);
      expect(Array.isArray(def.fallbackModels)).toBe(true);
      expect(typeof def.buildArgs).toBe('function');
      expect(typeof def.streamFormat).toBe('string');
    }
  });

  it('getAgentDef finds a known agent by id', () => {
    const claude = getAgentDef('claude');
    expect(claude?.id).toBe('claude');
    expect(claude?.bin).toBe('claude');
  });

  it('getAgentDef returns null for an unknown id', () => {
    expect(getAgentDef('not-a-real-agent')).toBeNull();
  });

  it('claude buildArgs composes stream-json argv', () => {
    const claude = getAgentDef('claude')!;
    const args = claude.buildArgs('hello', [], [], { model: 'sonnet' }, {});
    expect(args).toContain('--model');
    expect(args).toContain('sonnet');
    expect(args).toContain('--output-format');
  });

  it('claude offers the effort levels its CLI actually accepts', () => {
    // `claude --effort` reports these five when handed an unknown level. The set
    // differs from codex's on both ends, so it must not be shared with it.
    const claude = getAgentDef('claude')!;
    expect(claude.reasoningOptions?.map((option) => option.id))
      .toEqual(['default', 'low', 'medium', 'high', 'xhigh', 'max']);
  });

  it('claude passes --effort only once the probe has seen the flag', () => {
    // Older builds exit 1 on an unknown option, which kills the chat rather
    // than degrading it — same reason `--include-partial-messages` is gated.
    const claude = getAgentDef('claude')!;
    agentCapabilities.set('claude', {});
    expect(claude.buildArgs('hi', [], [], { reasoning: 'high' }, {})).not.toContain('--effort');

    agentCapabilities.set('claude', { effort: true });
    const args = claude.buildArgs('hi', [], [], { reasoning: 'high' }, {});
    expect(args.slice(args.indexOf('--effort'), args.indexOf('--effort') + 2))
      .toEqual(['--effort', 'high']);
  });

  it('claude omits --effort for the default level and for a level from another runtime', () => {
    const claude = getAgentDef('claude')!;
    agentCapabilities.set('claude', { effort: true });
    expect(claude.buildArgs('hi', [], [], { reasoning: 'default' }, {})).not.toContain('--effort');
    // 'minimal' is one of codex's levels; reaching the CLI it would warn on
    // stderr and run at the default, looking like the setting had applied.
    expect(claude.buildArgs('hi', [], [], { reasoning: 'minimal' }, {})).not.toContain('--effort');
    expect(claude.buildArgs('hi', [], [], {}, {})).not.toContain('--effort');
  });

  it('the amr def declares supportsCustomModel: false (ACP-driven model selection)', () => {
    const amr = getAgentDef('amr')!;
    expect(amr.supportsCustomModel).toBe(false);
    expect(amr.streamFormat).toBe('acp-json-rpc');
  });

  describe('runtimeSupportsExternalTools', () => {
    it('is true only when externalMcpInjection is declared', () => {
      expect(runtimeSupportsExternalTools({ externalMcpInjection: 'claude-mcp-json' })).toBe(true);
      expect(runtimeSupportsExternalTools({})).toBe(false);
    });

    // Locks in the exact split this session's picker fix depends on, derived from the real defs
    // rather than a hardcoded id list — if a def gains or loses `externalMcpInjection` this test
    // moves with it instead of silently drifting stale.
    it('splits the 24 built-in defs into the known tool-capable and tool-less sets', () => {
      const toolLess = BASE_AGENT_DEFS
        .filter((def) => !runtimeSupportsExternalTools(def))
        .map((def) => def.id)
        .sort();
      const toolCapable = BASE_AGENT_DEFS
        .filter((def) => runtimeSupportsExternalTools(def))
        .map((def) => def.id)
        .sort();

      expect(toolLess).toEqual(
        ['aider', 'amp', 'copilot', 'cursor-agent', 'deepseek', 'grok-build', 'pi', 'qoder', 'qwen'].sort(),
      );
      expect(toolCapable.length).toBe(BASE_AGENT_DEFS.length - toolLess.length);
      expect(toolCapable).toContain('claude');
      // antigravity moved from tool-less to tool-capable once its stdio MCP server can be
      // statically pre-registered and reached via inherited env (`'env-passthrough'`) — see
      // `defs/antigravity.ts`'s own doc for the live evidence behind the move.
      expect(toolCapable).toContain('antigravity');
    });
  });
});
