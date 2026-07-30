/**
 * @module detection
 *
 * Probes each registered agent def's version/auth/model availability and
 * builds a `DetectedAgent`. Ported from OD's
 * `apps/daemon/src/runtimes/detection/detection.ts` with one change: the
 * origin's `import { resolveAmrProfile } from '../../integrations/vela.js'`
 * — an OD-specific AMR/vela provider adapter — becomes an injected
 * `AmrProfileResolver` port (see `amr-profile-resolver.ts`), defaulting to
 * a no-op. `detectAgents`/`detectAgentsStream` take it as an optional last
 * parameter; every other agent's detection path is unaffected. See
 * `source-map.md`.
 */
import { execAgentFile } from './invocation.js';
import { getRememberedLiveModels, rememberLiveModels } from './models.js';
import { agentCapabilities } from './capabilities.js';
import { installMetaForAgent } from './metadata.js';
import { AGENT_DEFS } from './registry.js';
import { applyAgentLaunchEnv, resolveAgentLaunch } from './launch.js';
import { spawnEnvForAgent } from './env.js';
import { probeAgentAuthStatus } from './auth.js';
import { noopAmrProfileResolver, type AmrProfileResolver } from './amr-profile-resolver.js';
import { buildAuthDiagnostic, buildExecutableDiagnostic, buildNotInvocableDiagnostic, type NotInvocableCause } from './diagnostics.js';
import type {
  AgentDiagnostic,
  DetectedAgent,
  RuntimeAgentDef,
  RuntimeCapabilityMap,
  RuntimeModelSource,
  RuntimeModelOption,
} from './types.js';

type FetchedRuntimeModels = {
  models: RuntimeModelOption[];
  source: RuntimeModelSource;
};

function amrModelScopeFromEnv(env: NodeJS.ProcessEnv, amrProfileResolver: AmrProfileResolver): string {
  return amrProfileResolver.resolveProfile(env);
}

function withRememberedAmrModels(
  def: RuntimeAgentDef,
  env: NodeJS.ProcessEnv,
  modelResult: FetchedRuntimeModels,
  amrProfileResolver: AmrProfileResolver,
): FetchedRuntimeModels {
  if (def.id !== 'amr' || modelResult.models.length > 0) return modelResult;
  const rememberedModels = getRememberedLiveModels(def.id, amrModelScopeFromEnv(env, amrProfileResolver));
  if (rememberedModels.length === 0) return modelResult;
  return { models: rememberedModels, source: 'live' };
}

async function fetchModels(
  def: RuntimeAgentDef,
  resolvedBin: string,
  env: NodeJS.ProcessEnv,
): Promise<FetchedRuntimeModels> {
  if (typeof def.fetchModels === 'function') {
    try {
      const parsed = await def.fetchModels(resolvedBin, env);
      if (!parsed || parsed.length === 0) {
        return { models: def.fallbackModels, source: 'fallback' };
      }
      return { models: parsed, source: 'live' };
    } catch {
      return { models: def.fallbackModels, source: 'fallback' };
    }
  }
  if (!def.listModels) {
    return { models: def.fallbackModels, source: 'fallback' };
  }
  try {
    const { stdout } = await execAgentFile(resolvedBin, def.listModels.args, {
      env,
      timeout: def.listModels.timeoutMs,
      // Models lists from popular CLIs (e.g. opencode) easily exceed the
      // default 1MB buffer once you include every openrouter model. Bump
      // it so we don't truncate the listing.
      maxBuffer: 8 * 1024 * 1024,
    });
    const parsed = def.listModels.parse(String(stdout));
    // Empty / null parse result means the CLI didn't actually return a
    // usable list (e.g. cursor-agent's "No models available"); fall back
    // to the static hint so the picker isn't stuck on Default-only.
    if (!parsed || parsed.length === 0) {
      return { models: def.fallbackModels, source: 'fallback' };
    }
    return { models: parsed, source: 'live' };
  } catch {
    return { models: def.fallbackModels, source: 'fallback' };
  }
}

type VersionProbeOutcome = { kind: 'not-invocable'; cause: NotInvocableCause } | { kind: 'spawned'; version: string | null };

/**
 * Run the agent's `--version` probe and classify the result. The probe
 * has two distinct failure modes the catch arm has to discriminate:
 *
 *   - **Not invocable.** The OS rejected the spawn outright, OR the
 *     wrapper script spawned but its underlying interpreter / target
 *     failed. We split permission failures (EACCES / exit 126) from
 *     missing-target failures (ENOENT / ENOTDIR / exit 127) so a settings
 *     UI can offer permission-specific copy instead of treating every
 *     failure as a broken shim. We still mark the agent unavailable so
 *     the UI does not advertise a ghost entry.
 *
 *   - **Spawned but `--version` was unhappy.** The binary itself ran
 *     (any other rejection: timeout, generic non-zero exit, stderr
 *     noise) so the CLI is invocable; we just can't read a version
 *     string. Adapters whose `--version` flag is unsupported land
 *     here and must keep working with `version: null`.
 *
 * `child_process.execFile` reports OS-level rejections with a string
 * `err.code` (`'ENOENT'`, `'EACCES'`, `'ENOTDIR'`) and non-zero exit codes
 * with a *numeric* `err.code` equal to the exit status, so the two arms
 * below are unambiguous.
 */
async function probeVersionAtPath(def: RuntimeAgentDef, resolved: string, env: NodeJS.ProcessEnv): Promise<VersionProbeOutcome> {
  try {
    const { stdout } = await execAgentFile(resolved, def.versionArgs, {
      env,
      timeout: def.versionProbeTimeoutMs ?? 3000,
    });
    // `String.split()` on a non-empty string always returns at least one
    // element, so `[0]` is never `undefined` here — the assertion just
    // satisfies `noUncheckedIndexedAccess`.
    const version = String(stdout).trim().split('\n')[0]!;
    return { kind: 'spawned', version };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (typeof code === 'string') {
      if (code === 'EACCES') return { kind: 'not-invocable', cause: 'not-executable' };
      if (code === 'ENOENT' || code === 'ENOTDIR') return { kind: 'not-invocable', cause: 'missing-target' };
    } else if (typeof code === 'number' && (code === 126 || code === 127)) {
      return { kind: 'not-invocable', cause: code === 126 ? 'not-executable' : 'missing-target' };
    }
    return { kind: 'spawned', version: null };
  }
}

function unavailableAgent(def: RuntimeAgentDef, diagnostics: AgentDiagnostic[] = []): DetectedAgent {
  return {
    ...stripFns(def),
    // `fallbackModels` is a required field on `RuntimeAgentDef`, never
    // `undefined` for a well-typed def.
    models: def.fallbackModels,
    modelsSource: 'fallback',
    available: false,
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
    ...installMetaForAgent(def.id),
  };
}

// Probe the agent's `--help` once and record which advertised flags the
// installed CLI supports, so buildArgs can consult the cache. Extracted
// from the main probe so it can run concurrently with model + auth probing
// instead of blocking them. Returns the capability map (or null when the
// agent declares no help/capability metadata or the probe failed).
async function probeCapabilities(def: RuntimeAgentDef, launchPath: string, env: NodeJS.ProcessEnv): Promise<RuntimeCapabilityMap | null> {
  if (!def.helpArgs || !def.capabilityFlags) return null;
  try {
    const { stdout } = await execAgentFile(launchPath, def.helpArgs, { env, timeout: 5000, maxBuffer: 4 * 1024 * 1024 });
    const caps: RuntimeCapabilityMap = {};
    for (const [flag, key] of Object.entries(def.capabilityFlags)) {
      caps[key] = String(stdout).includes(flag);
    }
    return caps;
  } catch {
    // If --help fails, leave caps empty so buildArgs falls back to the
    // safe baseline (no optional flags).
    return {};
  }
}

async function probe(
  def: RuntimeAgentDef,
  configuredEnv: Record<string, string> = {},
  amrProfileResolver: AmrProfileResolver,
): Promise<DetectedAgent> {
  // Detection must probe the exact path the runtime will spawn, not just
  // the PATH-visible shim. This is load-bearing under nvm/fnm/mise: the
  // discovered entry is often a `#!/usr/bin/env node` wrapper that is not
  // invocable from a GUI-launched app's stripped PATH, while the launch
  // resolver can still upgrade it to a packaged native binary. If
  // detection probes the shim but chat/run spawns the native binary, the
  // UI incorrectly reports "not installed" until the user pins the bin
  // override by hand even though the real launch path is healthy.
  const launch = resolveAgentLaunch(def, configuredEnv);
  if (!launch.selectedPath || !launch.launchPath) {
    return unavailableAgent(def, [buildExecutableDiagnostic(def, configuredEnv)]);
  }
  const probeEnv = applyAgentLaunchEnv(
    spawnEnvForAgent(def.id, { ...process.env, ...(def.env || {}) }, configuredEnv, undefined, {}),
    launch,
  );
  const outcome = await probeVersionAtPath(def, launch.launchPath, probeEnv);
  if (outcome.kind === 'not-invocable') {
    return unavailableAgent(def, [buildNotInvocableDiagnostic(def, launch, outcome.cause)]);
  }
  // The version probe must finish first (it gates availability), but the
  // three post-version probes are independent reads — run them
  // concurrently so a single agent's detection wall is
  // max(help, models, auth) instead of the sum. `--help` capabilities are
  // cached on `agentCapabilities` for buildArgs to consult.
  const [caps, modelResult, auth] = await Promise.all([
    probeCapabilities(def, launch.launchPath, probeEnv),
    fetchModels(def, launch.launchPath, probeEnv),
    probeAgentAuthStatus(def, launch.launchPath, probeEnv),
  ]);
  const surfacedModelResult = withRememberedAmrModels(def, probeEnv, modelResult, amrProfileResolver);
  if (caps) {
    agentCapabilities.set(def.id, caps);
  }
  const authDiagnostic = auth ? buildAuthDiagnostic(def, auth) : null;
  return {
    ...stripFns(def),
    models: surfacedModelResult.models,
    modelsSource: surfacedModelResult.source,
    available: true,
    path: launch.selectedPath,
    version: outcome.version,
    ...(auth ? { authStatus: auth.status, ...(auth.message ? { authMessage: auth.message } : {}) } : {}),
    ...(authDiagnostic ? { diagnostics: [authDiagnostic] } : {}),
    ...installMetaForAgent(def.id),
  };
}

function stripFns(def: RuntimeAgentDef): Omit<DetectedAgent, 'models' | 'modelsSource' | 'available' | 'path' | 'version'> {
  // Drop the buildArgs / listModels closures but keep declarative metadata
  // (reasoningOptions, streamFormat, name, bin, etc.). `models` is
  // populated separately by `fetchModels`, so we strip the static
  // `fallbackModels` slot here too. `helpArgs` / `capabilityFlags` /
  // `fallbackBins` / `maxPromptArgBytes` / `env` are probe-or-spawn-only
  // metadata and shouldn't bleed into an API response either.
  // `inactivityTimeoutMs` is a spawn-time hint for a chat-run watchdog and
  // is not part of a public AgentInfo contract — strip it here so the
  // runtime registry stays the only consumer. `needsAgentLogFile` /
  // `stdoutPolicy` / `runtimeLock` are stripped for the same reason: they
  // instruct whoever spawns the CLI, not whoever lists agents. The latter two
  // matter extra because they carry closures — `JSON.stringify` would drop
  // the functions but keep their enclosing objects, publishing a misleading
  // `{"buffering":"until-close"}` / `{}` instead of omitting them.
  const {
    buildArgs: _buildArgs,
    listModels: _listModels,
    fetchModels: _fetchModels,
    fallbackModels: _fallbackModels,
    helpArgs: _helpArgs,
    capabilityFlags: _capabilityFlags,
    fallbackBins: _fallbackBins,
    versionProbeTimeoutMs: _versionProbeTimeoutMs,
    maxPromptArgBytes: _maxPromptArgBytes,
    env: _env,
    inactivityTimeoutMs: _inactivityTimeoutMs,
    authProbe: _authProbe,
    needsAgentLogFile: _needsAgentLogFile,
    stdoutPolicy: _stdoutPolicy,
    runtimeLock: _runtimeLock,
    ...rest
  } = def;
  return rest;
}

async function safeProbe(
  def: RuntimeAgentDef,
  configuredEnv: Record<string, string> = {},
  amrProfileResolver: AmrProfileResolver,
): Promise<DetectedAgent> {
  try {
    return await probe(def, configuredEnv, amrProfileResolver);
  } catch {
    // Fault isolation: one adapter's probe blowing up — e.g. a
    // synchronous filesystem throw during PATH walking on a packaged
    // Windows host, or an async rejection from one of the post-launch
    // probes — must not collapse the whole agent picker.
    return unavailableAgent(def);
  }
}

function rememberDetectedLiveModels(
  def: RuntimeAgentDef,
  configuredEnv: Record<string, string>,
  agent: DetectedAgent,
  amrProfileResolver: AmrProfileResolver,
): void {
  if (def.id === 'amr' && agent.models.length === 0) return;
  const scope =
    def.id === 'amr'
      ? amrModelScopeFromEnv({ ...process.env, ...(def.env || {}), ...configuredEnv }, amrProfileResolver)
      : null;
  rememberLiveModels(agent.id, agent.models, scope);
}

export async function detectAgents(
  configuredEnvByAgent: Record<string, Record<string, string>> = {},
  amrProfileResolver: AmrProfileResolver = noopAmrProfileResolver,
) {
  const results = await Promise.all(
    AGENT_DEFS.map((def) => safeProbe(def, configuredEnvByAgent?.[def.id] ?? {}, amrProfileResolver)),
  );
  // Refresh the validation cache from whatever we just surfaced to the UI
  // so a chat endpoint can accept any model the user could have just
  // picked, including ones that only showed up after a CLI re-auth.
  for (const [index, agent] of results.entries()) {
    // `results` is `AGENT_DEFS.map(...)`, so every index in `results.entries()`
    // is in-bounds for `AGENT_DEFS` too — the assertion just satisfies
    // `noUncheckedIndexedAccess`.
    const def = AGENT_DEFS[index]!;
    rememberDetectedLiveModels(def, configuredEnvByAgent?.[def.id] ?? {}, agent, amrProfileResolver);
  }
  return results;
}

// Streaming variant: yields each agent the moment its probe settles, in
// completion order rather than registry order, so the UI can paint a card
// as soon as it resolves instead of waiting for the slowest CLI. The model
// validation cache is refreshed per-agent (same effect as the batch path,
// just incrementally). `detectAgents` keeps the array contract for callers
// that don't care about incremental delivery.
export async function* detectAgentsStream(
  configuredEnvByAgent: Record<string, Record<string, string>> = {},
  amrProfileResolver: AmrProfileResolver = noopAmrProfileResolver,
): AsyncGenerator<DetectedAgent> {
  const tagged = AGENT_DEFS.map((def, index) =>
    safeProbe(def, configuredEnvByAgent?.[def.id] ?? {}, amrProfileResolver).then((agent) => {
      rememberDetectedLiveModels(def, configuredEnvByAgent?.[def.id] ?? {}, agent, amrProfileResolver);
      return { index, agent };
    }),
  );
  const pending = new Set(tagged.keys());
  while (pending.size > 0) {
    const { index, agent } = await Promise.race(tagged.filter((_, i) => pending.has(i)));
    pending.delete(index);
    yield agent;
  }
}
