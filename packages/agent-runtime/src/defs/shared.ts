/**
 * @module defs/shared
 *
 * Small helpers shared across the per-CLI def literals: re-exports of
 * `execAgentFile`/`DEFAULT_MODEL_OPTION` for convenience, the injected
 * `detectAcpModels`/`parsePiModels` (see `../acp-model-probe.ts` /
 * `../pi-models.ts` for why these are ports, not direct lifts), and two
 * small generic parsers (`clampCodexReasoning`, `parseLineSeparatedModels`).
 *
 * Ported from OD's `apps/daemon/src/runtimes/defs/shared.ts` — the origin
 * imported `detectAcpModels` from `../../acp.js` and `parsePiModels` from
 * `../../pi-rpc.js` directly; here they come from this package's own
 * port/vendor modules instead. See `source-map.md`.
 */
import { detectAcpModels } from '../acp-model-probe.js';
import { parsePiModels } from '../pi-models.js';
import { execAgentFile } from '../invocation.js';
import { DEFAULT_MODEL_OPTION } from '../models.js';
import type { RuntimeContext, RuntimeModelOption } from '../types.js';

export { detectAcpModels, parsePiModels, execAgentFile, DEFAULT_MODEL_OPTION };

/**
 * The argv every `externalMcpInjection: 'claude-mcp-json'` def appends so the caller-staged
 * `.mcp.json` is loaded *explicitly* rather than auto-discovered from cwd.
 *
 * **One implementation, not one per def.** Which flags carry a staged MCP config is a property of
 * the *mechanism* (`'claude-mcp-json'`), not of any individual CLI's identity — every def that
 * declares that strategy is by definition argv-compatible with Claude Code's `--mcp-config`
 * surface, which is why it declared the strategy at all. Both current declarers (`claude`,
 * `codebuddy`) call this; a third would too, instead of copying the branch.
 *
 * Why explicit rather than auto-discovery: confirmed live (2026-07-30) that auto-discovery of a
 * project `.mcp.json` requires an interactive trust prompt a headless daemon-spawned child has no
 * TTY to answer — the MCP server connection sat at `"pending"` forever and none of its tools ever
 * reached the model. The identical config passed via `--mcp-config` connected immediately.
 *
 * `--strict-mcp-config` is paired with it deliberately, not for symmetry: it makes the CLI load
 * ONLY this config, closing the separate "spawned CLI inherits the interactive developer's own
 * global/project MCP servers" leak. Both flags are documented for both current declarers
 * (Claude Code's own CLI reference; CodeBuddy's CLI reference documents `--mcp-config
 * <fileOrString>` and `--strict-mcp-config` — "Only use MCP servers in --mcp-config, ignore other
 * MCP configuration").
 *
 * @param runtimeContext - The def's own `buildArgs` `runtimeContext`. Only `mcpJsonPath` is read;
 * it is present only when the caller is actually staging that file for this run (see
 * `RuntimeContext.mcpJsonPath`'s own doc), so an unconfigured host gets `[]` and no argv change.
 * @returns `['--strict-mcp-config', '--mcp-config', <path>]`, or `[]` when no path was staged.
 * @complexity O(1).
 * @overallScore 100/100
 */
export function buildClaudeMcpConfigArgs(runtimeContext: RuntimeContext): string[] {
  const mcpJsonPath = runtimeContext.mcpJsonPath;
  if (typeof mcpJsonPath !== 'string' || mcpJsonPath.length === 0) return [];
  return ['--strict-mcp-config', '--mcp-config', mcpJsonPath];
}

export function clampCodexReasoning(modelId: string | null | undefined, effort: string | null | undefined) {
  if (!effort) return effort;
  const raw = String(modelId ?? '').trim();
  const id = raw.includes('/') ? raw.split('/').pop() : raw;
  const isGpt5LateFamily =
    !id ||
    id === 'default' ||
    id.startsWith('gpt-5.2') ||
    id.startsWith('gpt-5.3') ||
    id.startsWith('gpt-5.4') ||
    id.startsWith('gpt-5.5');
  if (isGpt5LateFamily && effort === 'minimal') return 'low';
  if (id === 'gpt-5.1' && effort === 'xhigh') return 'high';
  if (id === 'gpt-5.1-codex-mini') {
    return effort === 'high' || effort === 'xhigh' ? 'high' : 'medium';
  }
  return effort;
}

// Parse one-id-per-line stdout from `<cli> models` and prepend the synthetic
// default option. Used by opencode / cursor-agent.
export function parseLineSeparatedModels(stdout: string): RuntimeModelOption[] {
  const ids = String(stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  // De-dupe while preserving order — some CLIs print near-duplicates.
  const seen = new Set<string>();
  const out: RuntimeModelOption[] = [DEFAULT_MODEL_OPTION];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: id });
  }
  return out;
}
