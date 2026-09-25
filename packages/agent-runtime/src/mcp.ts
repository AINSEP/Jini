/**
 * @module mcp
 *
 * Builds a single stdio MCP server entry, in the env-shape an ACP-speaking
 * agent expects, for agents whose transport discovers MCP servers via
 * `mcpDiscovery === 'mature-acp'`.
 *
 * De-branded from OD's `apps/daemon/src/runtimes/mcp.ts`. The origin
 * function was hardwired to inject exactly one product feature — a
 * specifically-named, specifically-branded MCP server spawned via that
 * product's own CLI binary, with a fixed args tail baked in (see
 * `source-map.md` for the exact literal). That's a specific product's MCP
 * tool, not a generic runtime concern, so it is not ported. What genuinely
 * is generic — and is kept
 * here — is the *gating + env-shape* mechanism: only attach a server when
 * the def opts into `mcpDiscovery === 'mature-acp'`, and shape its `env`
 * field as an array (`[{name, value}]`) or a map (`{KEY: value}`) per
 * `def.acpMcpEnvFormat`, since different ACP implementations expect
 * different shapes there. The host application supplies the actual server
 * name/command/args. See `source-map.md`.
 */
import type { RuntimeAgentDef } from './types.js';

export type AcpMcpServerSpec = {
  /** MCP server name advertised to the agent. Host-supplied — no default. */
  name: string;
  /** Command the agent should spawn to talk to the MCP server. Host-supplied — no default. */
  command: string;
  /** Full argv for the command. Host-supplied — no default. */
  args?: string[];
  /** Extra env passed through to the spawned MCP server, merged under the ACP-shape-specific key below. */
  extraEnv?: Record<string, string>;
  enabled?: boolean;
};

export type AcpMcpServerEntry = {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string> | Array<{ name: string; value: string }>;
};

export function buildAcpMcpServersForAgent(
  def: Pick<RuntimeAgentDef, 'mcpDiscovery' | 'acpMcpEnvFormat'>,
  spec: AcpMcpServerSpec,
): AcpMcpServerEntry[] {
  const { name, command, args = [], extraEnv = {}, enabled = true } = spec;
  if (!enabled || def?.mcpDiscovery !== 'mature-acp') return [];
  const wantsMapEnv = def?.acpMcpEnvFormat === 'map';
  const baseEnv: Record<string, string> = { ELECTRON_RUN_AS_NODE: '1', ...extraEnv };
  const env = wantsMapEnv
    ? baseEnv
    : Object.entries(baseEnv).map(([envName, value]) => ({ name: envName, value }));
  return [{ name, command, args, env }];
}
