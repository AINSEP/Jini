import { describe, expect, it } from 'vitest';
import { opencodeAcpAgentDef } from '../opencode-acp.js';
import { BASE_AGENT_DEFS } from '../../registry.js';
import { spawnEnvForAgent } from '../../env.js';
import { passthroughProxyEnv } from '../../host-ports.js';

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
    expect(spawnEnvForAgent({ agentId: 'opencode-acp', baseEnv: {}, proxyEnv: passthroughProxyEnv }).OPENCODE_DISABLE_PROJECT_CONFIG).toBe('true');
  });
});
