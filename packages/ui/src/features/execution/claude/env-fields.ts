import type { AgentCliEnvFieldSpec } from '@jini-ai/core/contracts/execution';

export const claudeEnvFields: readonly AgentCliEnvFieldSpec[] = [
  {
    agentId: 'claude',
    envKey: 'CLAUDE_CONFIG_DIR',
    label: 'Config directory',
    placeholder: '~/.claude-2',
  },
  {
    agentId: 'claude',
    envKey: 'ANTHROPIC_BASE_URL',
    label: 'Base URL',
    placeholder: 'https://your-proxy.example.com',
  },
  {
    agentId: 'claude',
    envKey: 'ANTHROPIC_API_KEY',
    label: 'API key',
    placeholder: 'Paste CLI API key',
    secret: true,
  },
];
