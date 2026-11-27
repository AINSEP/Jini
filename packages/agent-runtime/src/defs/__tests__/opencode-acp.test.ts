import { describe, expect, it } from 'vitest';
import { opencodeAcpAgentDef } from '../opencode-acp/index.js';
import { BASE_AGENT_DEFS } from '../../registry.js';
import { spawnEnvForAgent } from '../../env.js';
import { discoveryContext, offlineDiscoveryDeps } from './discovery-fakes.js';

describe('OpenCode ACP pilot', () => {
  it('declares native ACP arguments, transport, tools and resume support', () => {
    expect(opencodeAcpAgentDef.buildArgs()).toEqual(['acp']);
    expect(opencodeAcpAgentDef.streamFormat).toBe('acp-json-rpc');
    expect(opencodeAcpAgentDef.externalMcpInjection).toBe('opencode-env-content');
    expect(opencodeAcpAgentDef.mcpHttp).toBe(true);
    expect(opencodeAcpAgentDef.resumesSessionViaAcpLoad).toBe(true);
  });
  it('keeps the pilot out of the built-in registry', () => {
    expect(BASE_AGENT_DEFS.some(def => def.id === 'opencode-acp')).toBe(false);
  });
  it('disables project config during pilot launches', () => {
    expect(spawnEnvForAgent({ agentId: 'opencode-acp', baseEnv: {} }).OPENCODE_DISABLE_PROJECT_CONFIG).toBe('true');
  });
});

it('supplies the OpenCode model choices to the ACP picker when the CLI is offline', async () => {
  const catalog = await opencodeAcpAgentDef.discoverModels({ context: discoveryContext }, { deps: offlineDiscoveryDeps() });
  expect(catalog.source).toBe('offline-fallback');
  expect(catalog.models.map(({ id, label }) => ({ id, label }))).toEqual([
    { id: 'anthropic/claude-sonnet-5', label: 'anthropic/claude-sonnet-5' },
    { id: 'openai/gpt-5', label: 'openai/gpt-5' },
    { id: 'google/gemini-2.5-pro', label: 'google/gemini-2.5-pro' },
  ]);
});
