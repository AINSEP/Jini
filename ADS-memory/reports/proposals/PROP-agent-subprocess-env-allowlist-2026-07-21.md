# Proposal: deny-by-default environment allowlist for agent subprocesses (SEC-001)

**Status: Implemented 2026-07-28** (commit `575b50602`, `packages/daemon/src/agent-executor.ts`'s
`BASELINE_AGENT_ENV_KEYS`/`buildAgentEnv`), following the shape sketched below almost exactly —
hardcoded baseline list (open question 1, resolved in favor of the simpler/harder-to-widen
option), `credentialEnv` added to `AgentExecutorRunInput` (open question 2's seam, still unwired
to any real credential-resolution story — that larger design question remains open). `input.env`
keeps its escape-hatch meaning per §4. Four new tests cover the five points in "What the test
evidence should look like" (point 4, the daemon's-own-token sentinel, is still N/A — no concrete
bearer-token constant exists yet in `create-local-node-daemon.ts`). Human sign-off for this
implementation came via the user directly, during npm-publish prep, choosing "patch first, then
publish" when this gap was flagged as blocking a public release — not a separate architect review
pass. Original proposal text preserved below for the record.

~~**Status:** Proposal only — not implemented. Requires human/architect sign-off before any code change, per the security review's explicit "Human sign-off required: Yes" on SEC-001 and this task's own scope boundary.~~

**Finding:** `ADS-memory/reports/security/SEC-backend-coverage-push-2026-07-20.md`, SEC-001 (High).

**Do not implement from this document without a follow-up decision.** No changes were made to `packages/daemon/src/agent-executor.ts` or any other source file as part of writing this proposal.

## The problem

`packages/daemon/src/agent-executor.ts:815,825` builds the environment for a spawned coding-agent subprocess from `input.env ?? process.env` — the caller's env if supplied, otherwise the daemon's own complete `process.env` — with no filtering:

```ts
const configuredEnv = toStringEnvRecord(input.env ?? process.env);
const launch: AgentLaunchResolution = resolveAgentLaunchFn(def, configuredEnv);
...
const spawnEnv = applyAgentLaunchEnvFn({ ...(input.env ?? process.env) }, launch);
```

`applyAgentLaunchEnvFn` (from `@jini/agent-runtime`) only prepends Node/toolchain directories onto `PATH` — it does not strip or scope anything. Whatever is in `process.env` at daemon-process-start (or whatever a caller passes as `input.env`) becomes the *entire* environment the spawned agent CLI sees, byte for byte.

`packages/node-host/src/create-local-node-daemon.ts:221` constructs the default `AgentExecutor` without supplying any environment sanitizer, so this is also the default behavior of the reference host assembly, not just a theoretical worst case if a caller passes a raw env.

## Why this matters

The coding-agent CLI a run spawns is prompt-influenced and, in the threat model this engine is built for, must be treated as potentially adversarial or compromised (a malicious/jailbroken prompt, a supply-chain-compromised CLI release, or a vulnerability in the CLI itself). Today that subprocess can trivially read its own `process.env` and exfiltrate (via its own network access, via writing to a file the agent can later read/exfiltrate, via a tool call, or simply by including it in its own output) anything the daemon process was holding, including:

- the daemon's own bearer/API token (`packages/node-host/src/create-local-node-daemon.ts`'s auth middleware config)
- unrelated provider API keys (a different agent/provider's credentials than the one this run is actually using)
- database connection strings, cloud credentials, any other host-level secret the daemon process happens to have in its env for unrelated reasons

This directly contradicts the locked architecture decision C8 (`foundry/docs/jini-port/extraction-plan.md:203`):

> Credentials = scoped handles/allowlisted env, not wholesale inheritance. Agent subprocesses: sanitized env, controlled cwd, process-group cleanup, resource limits.

## Proposed fix: deny-by-default allowlist + explicit per-run credential delegation

### 1. Baseline allowlist (always present, never a secret)

A fixed, small set of variables every agent subprocess needs regardless of provider, resolved from the *host's* env (not blindly copied from `process.env` as a bag, but explicitly read one name at a time):

- **Executable search / runtime:** `PATH`, `NODE_ENV` (if the wrapped CLI is itself Node-based and needs it), `SHELL` (POSIX-shell-invoking wrapper scripts sometimes need this).
- **Home/temp:** `HOME` (POSIX) / `USERPROFILE` (Windows), `TMPDIR` / `TEMP` / `TMP` — many CLIs write cache/config under these.
- **Locale:** `LANG`, `LC_ALL`, `LC_CTYPE` — avoids mojibake in CLI output that the daemon then has to parse.
- **Windows-specific plumbing the CLI may need to even start:** `SystemRoot`, `windir`, `ComSpec`, `PATHEXT` (Windows-only; matches what Node's own child_process docs recommend preserving on Windows).

This list should live as a single exported constant (e.g. `BASELINE_AGENT_ENV_KEYS`) in `@jini/agent-runtime` or `packages/daemon/src/agent-executor.ts` itself, with a comment explaining why each entry is there — not derived programmatically from `process.env`, so it can't silently grow.

### 2. Per-run delegated credentials (explicit, not inherited)

The credential(s) actually needed for *this run's* selected agent/provider (e.g. `ANTHROPIC_API_KEY` for a Claude-backed CLI, `OPENAI_API_KEY` for an OpenAI-backed one) must be:

- Named explicitly by the host when starting the run — e.g. a new field on `AgentExecutorRunInput` such as `readonly credentialEnv?: Record<string, string>` that the host populates from its own credential store, scoped to exactly the provider this `agentId`/`def` needs.
- Merged into the baseline allowlist by the executor, never read implicitly from `process.env`.

This makes credential delegation an explicit, auditable act by the host (or by `@jini/node-host`'s default assembly, which would need its own credential-resolution story — out of scope for this proposal, but the seam should exist for it to plug into).

### 3. What must always be stripped

- The daemon's own bearer/API token (whatever `create-local-node-daemon.ts`'s auth middleware uses) must never appear in `spawnEnv`, full stop — it should not even be in the candidate set the allowlist filters, i.e. the daemon should not read it via `process.env` lookups that could accidentally get forwarded.
- Any variable not in the baseline allowlist or the per-run delegated-credential set is dropped, including variables that *look* like they might be needed (unknown `*_API_KEY`, `*_TOKEN`, `*_SECRET`, `DATABASE_URL`, cloud provider credential variables like `AWS_*`/`GOOGLE_APPLICATION_CREDENTIALS`/`AZURE_*`, etc.) — deny-by-default means no pattern-matching allowlist-by-exclusion; only the two explicit sources above are ever included.

### 4. Backward compatibility / migration

- `input.env` (the existing optional field) should be reinterpreted as "the resolved final environment for tests/advanced callers who want to bypass the allowlist entirely" (as it partially is today for tests — see `packages/daemon/src/__tests__/agent-executor.test.ts`'s `createHarness` fixture, which injects `applyAgentLaunchEnv: (env) => env`) — i.e. keep it as an escape hatch for tests and hosts that have already done their own scoping, but change the **default** (`input.env` omitted) from "inherit `process.env` wholesale" to "baseline allowlist only, no credentials" rather than "baseline allowlist plus everything else."
- This is a behavior change for any existing caller relying on implicit full-env inheritance (there are none in this repo today, since `@jini/node-host`'s `createLocalNodeDaemon` doesn't yet configure `AgentExecutor`'s env resolution at all beyond the default) — but it should still be called out as a breaking-default change in the package's changelog/handoff docs when implemented.

## Suggested implementation shape (for the follow-up session, not this one)

```ts
// packages/daemon/src/agent-executor.ts (illustrative — not implemented)
const BASELINE_AGENT_ENV_KEYS = [
  'PATH', 'HOME', 'USERPROFILE', 'TMPDIR', 'TEMP', 'TMP', 'SHELL',
  'LANG', 'LC_ALL', 'LC_CTYPE',
  'SystemRoot', 'windir', 'ComSpec', 'PATHEXT', // Windows only; harmless no-ops elsewhere
] as const;

function buildAgentEnv(hostEnv: NodeJS.ProcessEnv, credentialEnv: Record<string, string> | undefined): Record<string, string> {
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
```

`AgentExecutorRunInput.env`, if explicitly supplied, continues to mean "use exactly this, no allowlist filtering" (the test/advanced-caller escape hatch); when omitted, `buildAgentEnv(process.env, input.credentialEnv)` replaces the current `process.env` passthrough.

## What the test evidence should look like

A follow-up PR implementing this should add tests that:

1. **Prove non-inheritance:** set one or more sentinel "secret" values in `process.env` (e.g. `process.env.JINI_TEST_SECRET_TOKEN = 'should-never-appear'`, a fake `DATABASE_URL`, a fake unrelated-provider API key) before spawning, assert none of them appear in the actual `env` object passed to the injected `spawn` fake (the existing `createHarness` fixture in `packages/daemon/src/__tests__/agent-executor.test.ts` already captures `spawnCalls[].options.env` — extend that assertion).
2. **Prove baseline presence:** assert `PATH`/`HOME`/locale vars set in `process.env` DO appear in the spawned child's env (a false-positive-free allowlist, not an allowlist that accidentally denies everything).
3. **Prove credential delegation works:** pass `credentialEnv: { ANTHROPIC_API_KEY: 'sk-test-explicit' }` and assert it appears in the child's env even though it's absent from `process.env` — proving the delegation path is independent of `process.env` entirely, not just "also allowed if present."
4. **Prove the daemon's own token is never forwarded:** if/when `create-local-node-daemon.ts` gains a concrete bearer-token constant or config field, add a same-shape sentinel assertion there too.
5. Keep the existing `applyAgentLaunchEnv: (env) => env` escape-hatch tests passing unchanged (they exercise the "advanced caller bypasses the allowlist" path, which should remain supported).

## Open questions for the architect / human sign-off

1. Should the baseline allowlist be a hardcoded list (as sketched above) or itself configurable per-host (e.g. `CreateAgentExecutorOptions.baselineEnvKeys`)? A hardcoded list is simpler and harder to accidentally widen; a configurable one accommodates an OD-specific CLI needing an extra baseline var without forking the engine.
2. Where should the per-run credential resolution actually live? This proposal only names the seam (`AgentExecutorRunInput.credentialEnv`) — deciding *how* a host resolves "which credential(s) does this `agentId` need for this run" (a registry keyed by provider? a pack-level config? user-supplied per-run?) is a larger design question that likely belongs in `@jini/node-host` or a future credentials package, not `agent-executor.ts` itself.
3. Does this interact with `@jini/capability-providers`' speculative auth/secrets ports (greenfield, no current consumer, per its own source-map.md)? If a future credentials capability provider exists, `credentialEnv` might be better sourced from that provider than passed as a raw record — worth deciding before this ships, to avoid building two competing credential-resolution stories.
