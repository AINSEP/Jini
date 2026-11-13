import type { AgentCliEnvFieldSpec } from '../types.js';

export const codexEnvFields: readonly AgentCliEnvFieldSpec[] = [
  {
    agentId: 'codex',
    envKey: 'CODEX_HOME',
    label: 'Config directory',
    placeholder: '~/.codex-alt',
  },
  {
    agentId: 'codex',
    envKey: 'CODEX_BIN',
    label: 'Binary path',
    placeholder: '/absolute/path/to/codex',
    kind: 'binPath',
  },
  {
    agentId: 'codex',
    envKey: 'OPENAI_BASE_URL',
    label: 'Base URL',
    placeholder: 'https://your-proxy.example.com/v1',
  },
  {
    agentId: 'codex',
    envKey: 'CODEX_API_KEY',
    label: 'API key (CODEX_API_KEY)',
    placeholder: 'Paste CODEX_API_KEY',
    secret: true,
  },
  {
    agentId: 'codex',
    envKey: 'OPENAI_API_KEY',
    label: 'API key (OPENAI_API_KEY)',
    placeholder: 'Paste OPENAI_API_KEY',
    secret: true,
  },
];
