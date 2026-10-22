/**
 * @module defs/claude-compatible-args
 *
 * Argv fragments shared by the defs that speak Claude Code's `-p` flag surface (`claude`,
 * `codebuddy`). Codebuddy documents `--add-dir`, `--resume`, `--session-id` and
 * `--permission-mode` as working identically to Claude Code, so each fragment is one
 * implementation rather than a copy per def.
 */
import { agentCapabilities } from '../capabilities.js';
import type { RuntimeBuildOptions, RuntimeCapabilityMap, RuntimeContext } from '../types.js';

/** Host-scoped capabilities when supplied, else the published `--help` probe cache for `agentId`. */
export function resolveCapabilities({ agentId, options }: { agentId: string; options: RuntimeBuildOptions }): RuntimeCapabilityMap {
  return (options.capabilities ?? agentCapabilities.get(agentId)) || {};
}

/** `--add-dir <dir...>` for every non-empty string dir, unless the probe recorded `addDir: false`. */
export function addDirArgs({ extraAllowedDirs, caps }: { extraAllowedDirs: readonly string[] | null | undefined; caps: RuntimeCapabilityMap }): string[] {
  const dirs = (extraAllowedDirs || []).filter((d) => typeof d === 'string' && d.length > 0);
  return dirs.length > 0 && caps.addDir !== false ? ['--add-dir', ...dirs] : [];
}

// Continue the CLI's own session across turns so it keeps its
// working memory (files read, edits made, tool history) instead of
// re-deriving everything from the rendered transcript each turn.
// `--resume <id>` continues a stored session; `--session-id <uuid>`
// starts a new one with an id the daemon controls and persists.
export function sessionArgs(runtimeContext: RuntimeContext): string[] {
  if (typeof runtimeContext.resumeSessionId === 'string' && runtimeContext.resumeSessionId) {
    return ['--resume', runtimeContext.resumeSessionId];
  }
  if (typeof runtimeContext.newSessionId === 'string' && runtimeContext.newSessionId) {
    return ['--session-id', runtimeContext.newSessionId];
  }
  return [];
}

// See `RuntimeBuildOptions.permissionMode`'s doc: bypass is the default (unchanged
// behavior) unless a caller explicitly opts into a restricted run.
export function permissionModeArgs(options: RuntimeBuildOptions): string[] {
  return options.permissionMode !== 'restricted' ? ['--permission-mode', 'bypassPermissions'] : [];
}

/** `<flag> <value>` unless the value is empty or the CLI-owned `default` sentinel. */
export function nonDefaultFlag({ flag, value }: { flag: string; value: string | null | undefined }): string[] {
  return value && value !== 'default' ? [flag, value] : [];
}
