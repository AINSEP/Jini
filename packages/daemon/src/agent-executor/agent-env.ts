/**
 * Fixed baseline of host environment variables every spawned agent subprocess may see by
 * default — resolved from the host's env one name at a time, never derived programmatically
 * from `process.env` as a bag, so this can't silently widen. SEC-001's deny-by-default fix; see
 * `AgentExecutorRunInput.env`'s doc for the full threat model.
 */
const BASELINE_AGENT_ENV_KEYS = [
  'PATH', 'HOME', 'USERPROFILE', 'TMPDIR', 'TEMP', 'TMP', 'SHELL',
  'LANG', 'LC_ALL', 'LC_CTYPE',
  // `USER` is required for a spawned `claude` CLI to find its own login/credential state — with
  // it omitted (even though `HOME` is present), `claude` fails fast with "Not logged in · Please
  // run /login" despite real credentials existing on disk/keychain. Confirmed by bisection against
  // a real authenticated `claude` install: `BASELINE_AGENT_ENV_KEYS` alone fails, adding back every
  // `CLAUDE_CODE_*`/`CLAUDECODE` var still fails, `LOGNAME`/`SSH_AUTH_SOCK` alone still fail, but
  // `USER` alone flips it to success. Login lookup requires the user identity
  // as well as the home directory.
  'USER',
  'SystemRoot', 'windir', 'ComSpec', 'PATHEXT', // Windows-only; harmless no-ops elsewhere
] as const;

/**
 * Deny-by-default agent subprocess environment: `BASELINE_AGENT_ENV_KEYS` resolved from
 * `hostEnv`, plus this run's explicitly-delegated credential(s) — never a passthrough of
 * `hostEnv` itself. Run launch reaches this when the caller omits `AgentExecutorRunInput.env`;
 * supplying `env` bypasses this function for that launch (see its call site). Diagnostic bridge
 * probes reuse this same baseline without adding delegated credentials.
 */
export function buildAgentEnv({ hostEnv }: { hostEnv: NodeJS.ProcessEnv }, { credentialEnv }: { credentialEnv?: Record<string, string> | undefined } = {}): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of BASELINE_AGENT_ENV_KEYS) {
    const value = hostEnv[key];
    if (typeof value === 'string') result[key] = value;
  }
  for (const [key, value] of Object.entries(credentialEnv ?? {})) {
    result[key] = value;
  }
  return result;
}
