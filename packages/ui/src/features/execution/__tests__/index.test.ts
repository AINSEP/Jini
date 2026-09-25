import { describe, expect, it } from 'vitest';
import * as ExecutionBarrel from '../index.js';

describe('execution tab barrel', () => {
  it('exports the rules functions', () => {
    expect(typeof ExecutionBarrel.agentCliEnvValue).toBe('function');
    expect(typeof ExecutionBarrel.agentDiagnosticTooltip).toBe('function');
    expect(typeof ExecutionBarrel.agentExecutableRepairState).toBe('function');
    expect(typeof ExecutionBarrel.agentMetaLabel).toBe('function');
    expect(typeof ExecutionBarrel.agentModelSummary).toBe('function');
    expect(typeof ExecutionBarrel.binPathEnvField).toBe('function');
    expect(typeof ExecutionBarrel.cleanAgentVersionLabel).toBe('function');
    expect(typeof ExecutionBarrel.cliEnvFieldsForAgent).toBe('function');
    expect(typeof ExecutionBarrel.credentialsForPreset).toBe('function');
    expect(typeof ExecutionBarrel.customPreset).toBe('function');
    expect(typeof ExecutionBarrel.filterAgentModelOptions).toBe('function');
    expect(typeof ExecutionBarrel.groupPresets).toBe('function');
    expect(typeof ExecutionBarrel.isBaseUrlInvalid).toBe('function');
    expect(typeof ExecutionBarrel.isProviderConfigured).toBe('function');
    expect(typeof ExecutionBarrel.isValidApiBaseUrl).toBe('function');
    expect(typeof ExecutionBarrel.missingRequiredFields).toBe('function');
    expect(typeof ExecutionBarrel.nextConfigForAgentCliEnvChange).toBe('function');
    expect(typeof ExecutionBarrel.nextConfigForAgentModel).toBe('function');
    expect(typeof ExecutionBarrel.nextConfigForAgentReasoning).toBe('function');
    expect(typeof ExecutionBarrel.nextConfigForAgentSelect).toBe('function');
    expect(typeof ExecutionBarrel.nextConfigForModeChange).toBe('function');
    expect(typeof ExecutionBarrel.nextConfigForPresetSelect).toBe('function');
    expect(typeof ExecutionBarrel.nextConfigForProtocolSelect).toBe('function');
    expect(typeof ExecutionBarrel.parseMaxTokens).toBe('function');
    expect(typeof ExecutionBarrel.presetRequiresApiKey).toBe('function');
    expect(typeof ExecutionBarrel.presetsForProtocol).toBe('function');
    expect(typeof ExecutionBarrel.resolveSelectedPreset).toBe('function');
    expect(typeof ExecutionBarrel.selectedAgentModel).toBe('function');
    expect(typeof ExecutionBarrel.selectedAgentReasoning).toBe('function');
    expect(typeof ExecutionBarrel.shouldShowCustomModelInput).toBe('function');
    expect(typeof ExecutionBarrel.showsBaseUrlField).toBe('function');
    expect(typeof ExecutionBarrel.sortDetectedAgents).toBe('function');
  });

  it('exports the constants', () => {
    expect(ExecutionBarrel.CUSTOM_MODEL_SENTINEL).toBe('__custom__');
    expect(typeof ExecutionBarrel.CUSTOM_PRESET_ID).toBe('string');
    expect(Array.isArray(ExecutionBarrel.DEFAULT_AGENT_CLI_ENV_FIELDS)).toBe(true);
    expect(typeof ExecutionBarrel.DEFAULT_AGENT_DESCRIPTIONS).toBe('object');
    expect(typeof ExecutionBarrel.DEFAULT_BASE_URL_BY_PROTOCOL).toBe('object');
    expect(Array.isArray(ExecutionBarrel.DEFAULT_PROVIDER_PRESETS)).toBe(true);
    expect(Array.isArray(ExecutionBarrel.PROTOCOL_OPTIONS)).toBe(true);
  });

  it('pins the Claude ids in DEFAULT_PROVIDER_PRESETS to the current generation', () => {
    // Source of truth is `claude.ts`'s `CLAUDE_FALLBACK_MODELS` in
    // `@jini-ai/agent-runtime` — these ids went stale once already
    // (`claude-sonnet-4-5`/`claude-opus-4-5`, `claude-3.7-sonnet`), so this
    // pin exists to make the next staleness a failing test instead of a
    // silent drift.
    const anthropic = ExecutionBarrel.DEFAULT_PROVIDER_PRESETS.find((p) => p.id === 'anthropic');
    expect(anthropic?.preferredModels).toEqual(['claude-sonnet-5', 'claude-opus-5', 'claude-haiku-4-5']);

    const openrouter = ExecutionBarrel.DEFAULT_PROVIDER_PRESETS.find((p) => p.id === 'openrouter');
    expect(openrouter?.preferredModels[0]).toBe('anthropic/claude-sonnet-5');
  });

  it('pins the OpenAI ids in DEFAULT_PROVIDER_PRESETS to the current generation', () => {
    // Verified against OpenAI's official API changelog and pricing docs
    // (developers.openai.com/api/docs/{changelog,pricing}, read 2026-09-13):
    // `gpt-4o`/`gpt-4o-mini`/`o3`/`o4-mini` were superseded by the GPT-5.6
    // family's named tiers. `sol` leads because the changelog calls it out
    // as the production-recommended default, not the newer/pricier
    // `gpt-6-astra` flagship — this pin exists so the next staleness fails a
    // test instead of drifting silently.
    const openai = ExecutionBarrel.DEFAULT_PROVIDER_PRESETS.find((p) => p.id === 'openai');
    expect(openai?.preferredModels).toEqual(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']);

    const openrouter = ExecutionBarrel.DEFAULT_PROVIDER_PRESETS.find((p) => p.id === 'openrouter');
    expect(openrouter?.preferredModels[2]).toBe('openai/gpt-5.6-sol');
  });

  it('exports the port fake and every React component', () => {
    expect(typeof ExecutionBarrel.createFakeExecutionPort).toBe('function');
    expect(typeof ExecutionBarrel.ExecutionTab).toBe('function');
    expect(typeof ExecutionBarrel.ByokProviderForm).toBe('function');
    expect(typeof ExecutionBarrel.LocalCliAgentList).toBe('function');
    expect(typeof ExecutionBarrel.LocalCliAgentCard).toBe('function');
    expect(typeof ExecutionBarrel.ProviderChipGroup).toBe('function');
    expect(typeof ExecutionBarrel.AgentDiagnosticRow).toBe('function');
    expect(typeof ExecutionBarrel.AgentCliEnvFields).toBe('function');
    expect(typeof ExecutionBarrel.SearchableModelSelect).toBe('function');
    expect(typeof ExecutionBarrel.useExecutionTab).toBe('function');
  });
});
