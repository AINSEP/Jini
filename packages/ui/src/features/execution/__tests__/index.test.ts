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
