/**
 * @module registry
 *
 * The static `BASE_AGENT_DEFS` catalog (the 24 built-in CLI adapters), a
 * dup-id guard, and `getAgentDef(id)` lookup.
 *
 * Ported from OD's `apps/daemon/src/runtimes/registry.ts`. Per the
 * task's explicit scope ("`registry.ts` → `BASE_AGENT_DEFS` array + dup-id
 * guard + `getAgentDef(id)`"), the origin's `readLocalAgentProfileDefs`
 * local-profile-file loader is deliberately NOT ported here — it reads a
 * product-prefixed config-path override env var, falls back to a
 * product-branded default path under the user's home dir, reads a
 * product-prefixed data-dir env var, and depends on OD's daemon-level
 * sandbox-runtime-config subsystem (out of this package's charter
 * entirely; see `source-map.md` for the exact original names). `AGENT_DEFS`
 * here is exactly `BASE_AGENT_DEFS` (no local-profile merge). A future task
 * can reintroduce a de-branded, sandbox-free local-profile loader as an
 * injected port if a consumer needs it. See `source-map.md`.
 */
import {
  aiderAgentDef,
  ampAgentDef,
  amrAgentDef,
  antigravityAgentDef,
  claudeAgentDef,
  codebuddyAgentDef,
  codexAgentDef,
  copilotAgentDef,
  cursorAgentDef,
  deepseekAgentDef,
  devinAgentDef,
  grokBuildAgentDef,
  hermesAgentDef,
  kiloAgentDef,
  kimiAgentDef,
  kiroAgentDef,
  mimoAgentDef,
  opencodeAgentDef,
  piAgentDef,
  qoderAgentDef,
  qwenAgentDef,
  reasonixAgentDef,
  traeCliAgentDef,
  vibeAgentDef,
} from './defs/index.js';
import type { RuntimeAgentDef } from './types.js';

export const BASE_AGENT_DEFS: RuntimeAgentDef[] = [
  amrAgentDef,
  claudeAgentDef,
  codexAgentDef,
  devinAgentDef,
  opencodeAgentDef,
  hermesAgentDef,
  traeCliAgentDef,
  grokBuildAgentDef,
  kimiAgentDef,
  cursorAgentDef,
  qwenAgentDef,
  qoderAgentDef,
  copilotAgentDef,
  ampAgentDef,
  piAgentDef,
  kiroAgentDef,
  kiloAgentDef,
  vibeAgentDef,
  deepseekAgentDef,
  aiderAgentDef,
  antigravityAgentDef,
  reasonixAgentDef,
  codebuddyAgentDef,
  mimoAgentDef,
];

export const AGENT_DEFS: RuntimeAgentDef[] = [...BASE_AGENT_DEFS];

const ids = new Set<string>();
for (const def of AGENT_DEFS) {
  if (ids.has(def.id)) {
    throw new Error(`Duplicate agent definition id: ${def.id}`);
  }
  ids.add(def.id);
}

export function getAgentDef(id: string): RuntimeAgentDef | null {
  return AGENT_DEFS.find((a) => a.id === id) || null;
}

/**
 * Whether a caller can inject external MCP servers (the host application's or this engine's own
 * tools) into a session run by this
 * def, per its own `externalMcpInjection` declaration (`types.ts`'s own doc names the six wired
 * strategies and the defs that leave the field `undefined` because the CLI has no mechanism to
 * receive one — `aider`, `amp`, `copilot`, `cursor-agent`, `deepseek`, `grok-build`, `pi`,
 * `qoder`, and `qwen` today, each documenting why in its own def file).
 *
 * This is the single seam a tool-availability UI (e.g. the chat runtime picker's "No tools" badge)
 * should read instead of hardcoding a runtime-id list: that list goes stale the moment a def gains
 * or loses `externalMcpInjection`, whereas every caller of this function tracks the def
 * automatically. Changing which runtimes support tools is a one-def-field edit; no caller of this
 * function needs to change.
 *
 * @complexity Time/space: O(1).
 */
export function runtimeSupportsExternalTools(def: Pick<RuntimeAgentDef, 'externalMcpInjection'>): boolean {
  return def.externalMcpInjection !== undefined;
}
