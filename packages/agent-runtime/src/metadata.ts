/**
 * @module metadata
 *
 * Per-agent install/docs link lookup, surfaced to a Settings-shaped UI when
 * an agent is unavailable.
 *
 * De-branded from OD's `apps/daemon/src/runtimes/metadata.ts`: the
 * table is now an injectable parameter (`installMetaForAgent(id, table)`)
 * instead of a module-private constant, and `DEFAULT_AGENT_INSTALL_LINKS`
 * drops the three OD-self-referential entries the origin had for `amr`,
 * `pi`, and `hermes` (an install URL and two docs URLs that pointed at
 * OD's own site/fork rather than at the third-party CLI vendor — see
 * `source-map.md` for the exact original URLs), so they don't belong in a
 * product-neutral default. Every other agent's real third-party vendor
 * link is unchanged. See `source-map.md`.
 */
export type AgentInstallMeta = { installUrl?: string; docsUrl?: string };

/** HTTPS links for a Settings-shaped UI when an agent is unavailable. Keys match `RuntimeAgentDef.id`. */
export const DEFAULT_AGENT_INSTALL_LINKS: Record<string, AgentInstallMeta> = {
  amp: {
    installUrl: 'https://ampcode.com/manual#install',
    docsUrl: 'https://ampcode.com/manual',
  },
  claude: {
    installUrl: 'https://docs.anthropic.com/en/docs/claude-code/setup',
    docsUrl: 'https://docs.anthropic.com/en/docs/claude-code',
  },
  codex: {
    installUrl: 'https://github.com/openai/codex',
    docsUrl: 'https://developers.openai.com/codex',
  },
  devin: {
    installUrl: 'https://cli.devin.ai/docs',
    docsUrl: 'https://docs.devin.ai',
  },
  opencode: {
    installUrl: 'https://opencode.ai/docs',
    docsUrl: 'https://github.com/sst/opencode',
  },
  hermes: {
    docsUrl: 'https://hermes-agent.nousresearch.com/docs/',
  },
  'trae-cli': {
    installUrl: 'https://www.volcengine.com/docs/86677/2227861?lang=zh',
    docsUrl: 'https://www.volcengine.com/docs/86677/2227861?lang=zh',
  },
  kimi: {
    installUrl: 'https://github.com/MoonshotAI/kimi-cli',
    docsUrl: 'https://www.kimi.com/code/docs/en/kimi-cli/guides/getting-started.html',
  },
  'cursor-agent': {
    installUrl: 'https://cursor.com/docs/cli/overview',
    docsUrl: 'https://docs.cursor.com/en/cli/overview',
  },
  qwen: {
    installUrl: 'https://github.com/QwenLM/qwen-code',
    docsUrl: 'https://qwenlm.github.io/qwen-code-docs/en/index',
  },
  qoder: {
    installUrl: 'https://qoder.com/download',
    docsUrl: 'https://docs.qoder.com',
  },
  copilot: {
    installUrl: 'https://github.com/github/copilot-cli',
    docsUrl: 'https://docs.github.com/en/copilot/how-tos/use-copilot-extensions/use-in-cli',
  },
  pi: {
    docsUrl: 'https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md',
  },
  kiro: {
    installUrl: 'https://kiro.dev',
    docsUrl: 'https://kiro.dev/docs/cli/',
  },
  kilo: {
    installUrl: 'https://kilo.ai',
    docsUrl: 'https://kilo.ai/docs/cli',
  },
  mimo: {
    installUrl: 'https://mimo.ai',
    docsUrl: 'https://mimo.ai/docs',
  },
  vibe: {
    installUrl: 'https://docs.mistral.ai',
    docsUrl: 'https://github.com/mistralai/vibe-acp',
  },
  deepseek: {
    installUrl: 'https://github.com/Hmbown/CodeWhale',
    docsUrl: 'https://github.com/Hmbown/CodeWhale/blob/main/README.md',
  },
  codebuddy: {
    installUrl: 'https://www.codebuddy.cn',
    docsUrl: 'https://www.codebuddy.cn/docs/workbuddy/Overview',
  },
};

function sanitizeHttpsUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function installMetaForAgent(
  agentId: string,
  table: Record<string, AgentInstallMeta> = DEFAULT_AGENT_INSTALL_LINKS,
): AgentInstallMeta {
  const meta = table[agentId];
  if (!meta) return {};
  const installUrl = sanitizeHttpsUrl(meta.installUrl);
  const docsUrl = sanitizeHttpsUrl(meta.docsUrl);
  return {
    ...(installUrl ? { installUrl } : {}),
    ...(docsUrl ? { docsUrl } : {}),
  };
}
