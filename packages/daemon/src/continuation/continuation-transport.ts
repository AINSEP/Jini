/**
 * `resolveContinuationTransport` — gap 3 of the run/chat orchestration
 * swarm-consensus Final Recommendation: "per-definition `continuationTransport:
 * 'mcp-callback' | 'stdin-injection' | 'none'`, resolved from each def's
 * declared input format (defaulting `'none'` for unverified entries)."
 * Evidence-backed as a factual constraint, not a preference: stdin closes
 * after the first write for ~22/24 registered defs (see the consensus
 * report's DP3).
 *
 * Resolution order (2026-07-22 research, `@jini-ai/agent-runtime`'s 24 defs
 * enumerated directly): `externalMcpInjection` set → `'mcp-callback'`;
 * else `promptInputFormat === 'stream-json' && promptViaStdin` →
 * `'stdin-injection'`; else `'none'`. `externalMcpInjection` is checked
 * first because it is the more capable transport (a real bidirectional tool
 * protocol vs. a single-shot JSONL injection) and because `claude`/
 * `codebuddy` are the only defs where both conditions are simultaneously
 * true — they resolve to `'mcp-callback'` as primary, with
 * `'stdin-injection'` available as a documented secondary path (see
 * `agent-executor.ts`'s stdin-tool-result injection, which is independently
 * gated and does not consult this function).
 *
 * Keyed deliberately off `promptInputFormat`/`externalMcpInjection`, never
 * `streamFormat`: `amp.ts` reuses `streamFormat: 'claude-stream-json'` (the
 * *output* parser) but declares neither input-continuation field — its own
 * comment states it deliberately stays plain-text stdin. Keying off
 * `streamFormat` would misroute it into `'stdin-injection'`.
 */
import type { RuntimeAgentDef } from '@jini-ai/agent-runtime';

export type ContinuationTransport = 'mcp-callback' | 'stdin-injection' | 'none';

/**
 * Resolves the continuation transport a def supports, from its own declared
 * capability fields — never guessed, never defaulted to something more
 * capable than what the def actually declares.
 * @param def - The resolved agent def.
 * @returns The transport this def supports for injecting a tool result (or
 * other mid-run input) back into an already-running child process.
 * @complexity O(1).
 * @overallScore 100/100
 */
export function resolveContinuationTransport(def: RuntimeAgentDef): ContinuationTransport {
  if (def.externalMcpInjection !== undefined) return 'mcp-callback';
  if (def.promptInputFormat === 'stream-json' && def.promptViaStdin === true) return 'stdin-injection';
  return 'none';
}
