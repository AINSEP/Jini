/**
 * @module diagnostics
 * Explain executable/authentication detection failures and preserve safe startup evidence.
 */
import { agentBinEnvKey, agentSearchDirs, type ExecutableResolutionOptions } from './executables.js';
import type { AgentLaunchResolution } from './launch.js';
import type { AgentAuthProbeResult } from './auth.js';
import type { AgentDiagnostic, AgentFixIntent, RuntimeAgentDef } from './types.js';
import { formatErrorForLog } from '@jini-ai/core';

/** Pasteable startup evidence, redacted before a UTF-8 byte cap is applied. No stack or input
 * envelope is copied; deepest causes come first so a long wrapper cannot hide the cause.
 * @param required Stage owned by the caller and the thrown startup value.
 * @param options Exact host secrets and caller wording for an unconfirmed start response.
 * @returns At most 2 KiB of actionable text; hostile diagnostic getters never escape.
 * @complexity O(n) time/space in the messages read, with at most four causes; no I/O.
 * @example startupFailureMessage({ stage: 'session binding', error }, {});
 */
export function startupFailureMessage({ stage, error }: { stage: string; error: unknown },
  { exactSecrets = [], notice = 'The assistant could not start. Correct the reported cause, then send again.' }: {
    exactSecrets?: readonly string[]; notice?: string;
  } = {},
): string {
  let cause: string;
  try { cause = startupCauseText({ error }); }
  catch { cause = 'The error details could not be read.'; }
  const safe = formatErrorForLog({ error: `${notice}\nStartup stage: ${stage}\nCause: ${cause}` }, { exactSecrets });
  const bytes = new TextEncoder().encode(safe);
  if (bytes.length <= 2048) return safe;
  // Streaming decode drops an incomplete trailing code point rather than inserting U+FFFD.
  return new TextDecoder().decode(bytes.subarray(0, 2045), { stream: true }) + '…';
}

/** Bound cause traversal (including cycles); copy diagnostic fields only, never environment data. */
function startupCauseText({ error }: { error: unknown }): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current = error;
  while (current != null && !seen.has(current) && parts.length < 4) {
    seen.add(current);
    parts.push(startupErrorPart({ error: current }));
    current = typeof current === 'object' ? (current as { cause?: unknown }).cause : undefined;
  }
  return parts.reverse().join('\nCaused by: ') || 'No startup cause was supplied.';
}

/** Retain plain messages and OS/provider codes without serializing arbitrary object fields. */
function startupErrorPart({ error }: { error: unknown }): string {
  if (typeof error !== 'object' || error === null) return String(error);
  const { message, code } = error as { message?: unknown; code?: unknown };
  return [code, message].filter(value => typeof value === 'string' || typeof value === 'number').join(': ') || 'Startup error without a message';
}

// Cap on how many searched dirs we attach to a `not-on-path` diagnostic.
// The resolver walks PATH + the user-toolchain whitelist, which can run to
// dozens of entries; the UI only needs enough to make "we looked here"
// land without ballooning the response payload.
const MAX_SEARCHED_DIRS = 24;

function setEnvIntent(agentId: string): AgentFixIntent[] {
  const envKey = agentBinEnvKey({ agentId: agentId });
  return envKey ? [{ kind: 'setEnv', envKey }] : [];
}

// The agent is not resolvable at all: either nothing matched on PATH, or a
// user-supplied `*_BIN` override points at a missing/invalid file. The two
// cases get different copy + fix affordances because the remedy differs
// (install / point us at the binary vs. fix or clear the override).
export function buildExecutableDiagnostic({ def }: { def: Pick<RuntimeAgentDef, 'id' | 'name' | 'bin'> }, { configuredEnv = {}, ...options }: ExecutableResolutionOptions & { configuredEnv?: Record<string, string> } = {}
): AgentDiagnostic {
  const envKey = agentBinEnvKey({ agentId: def.id });
  const overrideRaw = envKey ? configuredEnv?.[envKey]?.trim() : '';
  if (envKey && overrideRaw) {
    return {
      reason: 'configured-bin-invalid',
      severity: 'error',
      message: `${def.name}'s configured binary (${envKey}) was not found or is not executable.`,
      detail: overrideRaw,
      fixActions: [{ kind: 'setEnv', envKey }, { kind: 'clearEnv', envKey }, { kind: 'rescan' }],
    };
  }
  return {
    reason: 'not-on-path',
    severity: 'error',
    message: `${def.name} (\`${def.bin}\`) was not found on your PATH.`,
    searchedDirs: agentSearchDirs({}, options).slice(0, MAX_SEARCHED_DIRS),
    fixActions: [{ kind: 'openInstall' }, ...setEnvIntent(def.id), { kind: 'rescan' }],
  };
}

export type NotInvocableCause = 'not-executable' | 'missing-target';

// A file matched but `--version` could not spawn it. Permission failures
// are real binaries that need their executable bit restored; missing-target
// failures are usually leftover npm/nvm/mise shims whose underlying target
// was uninstalled.
export function buildNotInvocableDiagnostic({ def, launch, cause }: { def: Pick<RuntimeAgentDef, 'id' | 'name'>; launch: Pick<AgentLaunchResolution, 'selectedPath' | 'launchPath'>; cause: NotInvocableCause }
): AgentDiagnostic {
  if (cause === 'not-executable') {
    return {
      reason: 'not-executable',
      severity: 'error',
      message: `${def.name} was found but is not executable. Restore its execute permission or choose a different binary, then rescan.`,
      ...(launch.launchPath ? { detail: launch.launchPath } : {}),
      fixActions: [...setEnvIntent(def.id), { kind: 'rescan' }],
    };
  }
  return {
    reason: 'shim-broken',
    severity: 'error',
    message: `${def.name} was found but could not be launched — its wrapper or shim points at a missing target.`,
    ...(launch.launchPath ? { detail: launch.launchPath } : {}),
    fixActions: [...setEnvIntent(def.id), { kind: 'openDocs' }, { kind: 'rescan' }],
  };
}

// The agent is installed and invocable but its auth probe reported a
// missing / unverifiable credential. Detection only reaches this helper
// for adapters that declare a cheap, side-effect-free authProbe; until an
// adapter also declares a spawn-safe OAuth producer, diagnostics point at
// docs.
export function buildAuthDiagnostic({ def, auth }: { def: Pick<RuntimeAgentDef, 'id' | 'name'>; auth: AgentAuthProbeResult }
): AgentDiagnostic | null {
  if (auth.status === 'ok') return null;
  const signInIntent: AgentFixIntent = { kind: 'openDocs' };
  if (auth.status === 'missing') {
    return {
      reason: 'auth-missing',
      severity: 'error',
      message: auth.message || `${def.name} is installed but not authenticated.`,
      ...(auth.stderrTail ? { detail: auth.stderrTail } : {}),
      fixActions: [signInIntent, { kind: 'rescan' }],
    };
  }
  return {
    reason: 'auth-unknown',
    severity: 'warning',
    message: auth.message || `${def.name} authentication status could not be verified.`,
    ...(auth.stderrTail ? { detail: auth.stderrTail } : {}),
    fixActions: [signInIntent, { kind: 'rescan' }],
  };
}
