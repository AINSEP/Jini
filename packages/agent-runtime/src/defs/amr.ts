/** Ported from OD's `apps/daemon/src/runtimes/defs/amr.ts` (two de-branded comments; see `source-map.md`). */
import { execAgentFile } from './shared.js';
import type { RuntimeAgentDef, RuntimeModelOption } from '../types.js';

const AMR_MODELS_TIMEOUT_MS = 10_000;
const AMR_MODELS_RETRY_DELAYS_MS = [250, 750] as const;
export type VelaModelJsonSource = 'preset' | 'remote';

const PREFERRED_AMR_CHAT_MODEL_ORDER = [
  'deepseek-v4-flash',
  'deepseek-v3.2',
  'glm-5.1',
  'gemini-2.5-flash',
] as const;

const PREFERRED_AMR_CHAT_MODEL_RANK: ReadonlyMap<string, number> = new Map(
  PREFERRED_AMR_CHAT_MODEL_ORDER.map((id, index) => [id, index]),
);

// AMR is the vela CLI's ACP stdio mode. `vela agent run --runtime opencode`
// starts a private OpenCode server and forwards stream-json over ACP JSON-RPC.
// Required env (set on the daemon process or via Settings → CLI env):
//   VELA_RUNTIME_KEY  — OpenRouter (or compatible) API key
//   VELA_LINK_URL     — OpenAI-compatible endpoint, e.g. https://openrouter.ai/api/v1
//   VELA_OPENCODE_BIN — optional; absolute path to opencode when not on PATH
// See docs/new-agent-runtime-acp.md and the vela
// `specs/current/runtime/manual-agent-run-openrouter.md`.
//
// Model wiring notes:
//
//   1. vela rejects `session/prompt` until `session/set_model` has been
//      called, so AMR cannot accept the synthetic `default` model id —
//      attachAcpSession skips set_model whenever model === 'default'.
//
//   2. Vela 0.0.1 exposes the current link-supported catalog through
//      `vela models`, but that command prints public ids such as
//      `public_model_deepseek_v3_2`. The ACP `session/set_model` call accepts
//      the link-facing slug (`deepseek-v3.2` / `glm-5.1`), so this adapter
//      normalizes those public ids at the spawn boundary until Vela exposes
//      canonical ACP ids directly.
export function normalizeVelaModelId(rawId: string): string | null {
  const trimmed = rawId.trim();
  if (!trimmed) return null;
  const withoutProvider = trimmed.startsWith('vela/')
    ? trimmed.slice('vela/'.length)
    : trimmed;
  const withoutPrefix = withoutProvider.startsWith('public_model_')
    ? withoutProvider.slice('public_model_'.length)
    : withoutProvider;
  if (!withoutPrefix) return null;
  if (/^deepseek_v3_2$/i.test(withoutPrefix)) return 'deepseek-v3.2';
  if (/^deepseek-v3-2$/i.test(withoutPrefix)) return 'deepseek-v3.2';
  if (/^kimi_k2_6$/i.test(withoutPrefix)) return 'kimi-k2.6';
  if (/^kimi_k2_7_code$/i.test(withoutPrefix)) return 'kimi-k2.7-code';
  if (/^glm_5_1$/i.test(withoutPrefix)) return 'glm-5.1';
  if (/^glm_5$/i.test(withoutPrefix)) return 'glm-5';
  const versioned = normalizeKnownVelaVersionId(withoutPrefix);
  if (versioned) return versioned;
  return withoutPrefix.replace(/_/g, '-');
}

// Every capture group below is a mandatory (non-optional) part of its
// pattern — `(haiku|opus|sonnet)` is a required alternation and `(\d+)`
// requires 1+ digit characters — so none can be empty/undefined when the
// overall regex matches. `family` needs an explicit assertion because it's
// the only capture with a method called on it directly; the others type-check
// fine interpolated bare (`noUncheckedIndexedAccess` types them
// `string | undefined`, but TypeScript doesn't restrict template-literal
// interpolation the way it restricts a method call on a possibly-undefined
// value).
function normalizeKnownVelaVersionId(rawId: string): string | null {
  const claude = /^claude[_-](haiku|opus|sonnet)[_-](\d+)[_-](\d+)(.*)$/i.exec(rawId);
  if (claude) {
    const [, family, major, minor, suffix = ''] = claude;
    return `claude-${family!.toLowerCase()}-${major}.${minor}${suffix.replace(/_/g, '-')}`;
  }

  const gpt = /^gpt_(\d+)_(\d+)(.*)$/i.exec(rawId);
  if (gpt) {
    const [, major, minor, suffix = ''] = gpt;
    return `gpt-${major}.${minor}${suffix.replace(/_/g, '-')}`;
  }

  const gemini = /^gemini_(\d+)_(\d+)(.*)$/i.exec(rawId);
  if (gemini) {
    const [, major, minor, suffix = ''] = gemini;
    return `gemini-${major}.${minor}${suffix.replace(/_/g, '-')}`;
  }

  const minimax = /^minimax_m(\d+)_(\d+)(.*)$/i.exec(rawId);
  if (minimax) {
    const [, major, minor, suffix = ''] = minimax;
    return `minimax-m${major}.${minor}${suffix.replace(/_/g, '-')}`;
  }

  return null;
}

function isVelaChatModelId(modelId: string): boolean {
  // Temporary chat-surface guard: Vela already lists media-generation models,
  // but this AMR runtime adapter currently drives only chat completions.
  // Remove this filter when AMR grows first-class image/video execution.
  const id = modelId.toLowerCase();
  if (id.startsWith('gpt-image-')) return false;
  if (id.startsWith('seedance-')) return false;
  if (id.startsWith('doubao-seedance-')) return false;
  if (id.startsWith('veo-')) return false;
  if (id.startsWith('imagen-')) return false;
  return true;
}

export function parseVelaModels(stdout: string): RuntimeModelOption[] {
  const seen = new Set<string>();
  const models: RuntimeModelOption[] = [];
  for (const line of String(stdout || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    // `trimmed` is already non-empty and has no leading whitespace (checked
    // above), so its first whitespace-split token is always non-empty too.
    const rawId = trimmed.split(/\s+/)[0]!;
    const id = normalizeVelaModelId(rawId);
    if (!id || seen.has(id) || !isVelaChatModelId(id)) continue;
    seen.add(id);
    models.push({ id, label: id });
  }
  return orderAmrChatModels(models);
}

export function parseVelaModelJson(
  stdout: string,
  expectedSource: VelaModelJsonSource,
): RuntimeModelOption[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Invalid vela model JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid vela model JSON: expected object');
  }
  const source = (parsed as { source?: unknown }).source;
  if (source !== expectedSource) {
    throw new Error(`Invalid vela model JSON source: expected ${expectedSource}, got ${String(source)}`);
  }
  const data = (parsed as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    throw new Error('Invalid vela model JSON: expected data array');
  }
  const seen = new Set<string>();
  const models: RuntimeModelOption[] = [];
  for (const item of data) {
    const rawId = item && typeof item === 'object'
      ? (item as { id?: unknown }).id
      : null;
    const id = typeof rawId === 'string' ? rawId.trim() : '';
    if (!id || seen.has(id) || !isVelaChatModelId(id)) continue;
    seen.add(id);
    models.push({ id, label: id });
  }
  return orderAmrChatModels(models);
}

function orderAmrChatModels(
  models: RuntimeModelOption[],
): RuntimeModelOption[] {
  return models
    .map((model, index) => ({ model, index }))
    .sort((a, b) => {
      const aRank =
        PREFERRED_AMR_CHAT_MODEL_RANK.get(a.model.id) ?? Number.MAX_SAFE_INTEGER;
      const bRank =
        PREFERRED_AMR_CHAT_MODEL_RANK.get(b.model.id) ?? Number.MAX_SAFE_INTEGER;
      return aRank - bRank || a.index - b.index;
    })
    .map(({ model }) => model);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function velaModelsErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error ?? '');
}

function isRetriableVelaModelsError(error: unknown): boolean {
  const message = velaModelsErrorMessage(error).toLowerCase();
  return [
    'deadline exceeded',
    'timed out',
    'timeout',
    'temporarily unavailable',
    'temporary failure',
    'econnreset',
    'econnrefused',
    'enotfound',
    '502',
    '503',
    '504',
  ].some((pattern) => message.includes(pattern));
}

export async function fetchVelaPresetModels(
  resolvedBin: string,
  env: NodeJS.ProcessEnv,
): Promise<RuntimeModelOption[]> {
  const { stdout } = await execAgentFile(resolvedBin, ['model', 'preset', '--format', 'json'], {
    env,
    timeout: AMR_MODELS_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
  });
  return parseVelaModelJson(String(stdout), 'preset');
}

export async function fetchVelaRemoteModelsWithRetry(
  resolvedBin: string,
  env: NodeJS.ProcessEnv,
): Promise<RuntimeModelOption[]> {
  // The internal exhaustion check below (`attempt === AMR_MODELS_RETRY_DELAYS_MS.length`)
  // always throws on the last allowed attempt — strictly before the `for`
  // condition itself would ever end the loop — so there's no way to fall
  // through normally; no trailing fallback throw is needed. That same check
  // also means `attempt` is always a valid in-bounds index into
  // `AMR_MODELS_RETRY_DELAYS_MS` whenever we reach the `sleep()` call below
  // (the assertion just satisfies `noUncheckedIndexedAccess`).
  //
  // Coverage note (re-derived, not merely restated from the paragraph
  // above): `for (let attempt = 0; ; attempt += 1)` has an empty middle
  // clause — an unconditional, infinite loop — and its body contains no
  // `break` (grepped: none). The only two ways out are the `return` on a
  // successful parse and the `throw` in the catch arm, and the `throw` is
  // unconditionally forced once `attempt === AMR_MODELS_RETRY_DELAYS_MS.length`
  // (`AMR_MODELS_RETRY_DELAYS_MS` is the literal 2-element `[250, 750]`
  // above, so that's guaranteed after at most 3 attempts). So this
  // function's implicit end-of-body statement (the closing `}` two lines
  // below) can never execute — v8/istanbul still instruments it because
  // it can't prove an arbitrary `for(;;)` terminates, but the real control
  // flow genuinely never reaches it. Documented here (and in
  // `source-map.md`'s 2026-07-22 entry) instead of forced via a test,
  // per this repo's no-`/* v8 ignore */` standard.
  for (let attempt = 0; ; attempt += 1) {
    try {
      const { stdout } = await execAgentFile(resolvedBin, ['model', 'list', '--format', 'json'], {
        env,
        timeout: AMR_MODELS_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
      });
      return parseVelaModelJson(String(stdout), 'remote');
    } catch (error) {
      if (
        attempt === AMR_MODELS_RETRY_DELAYS_MS.length ||
        !isRetriableVelaModelsError(error)
      ) {
        throw error;
      }
      await sleep(AMR_MODELS_RETRY_DELAYS_MS[attempt]!);
    }
  }
}

/** Live account fields parsed from `vela billing summary --format json`. */
export interface VelaBillingSummary {
  /** Real subscription tier (e.g. "max"); absent for free accounts. */
  plan?: string;
  /** Total available balance in USD (string), or null when unavailable. */
  balanceUsd?: string | null;
}

/**
 * Read the signed-in account's billing summary via the vela CLI — the same
 * data source used for models, so balance/tier come through the versioned CLI
 * contract rather than a separate HTTP call. Returns total available balance
 * and the real membership tier.
 */
export async function fetchVelaBillingSummary(
  resolvedBin: string,
  env: NodeJS.ProcessEnv,
): Promise<VelaBillingSummary> {
  const { stdout } = await execAgentFile(
    resolvedBin,
    ['billing', 'summary', '--format', 'json'],
    { env, timeout: AMR_MODELS_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
  );
  const data = JSON.parse(String(stdout)) as {
    balanceUsd?: unknown;
    totalAvailableCreditsUsd?: unknown;
    membershipTier?: unknown;
  };
  // Use `balanceUsd` — the same field the console wallet page renders as the
  // headline "余额" — so the two surfaces always agree. Fall back to the total
  // available only if `balanceUsd` is missing.
  const balanceUsd =
    typeof data.balanceUsd === 'string'
      ? data.balanceUsd
      : typeof data.totalAvailableCreditsUsd === 'string'
        ? data.totalAvailableCreditsUsd
        : null;
  // `membershipTier` is omitted for free accounts. A SUCCESSFUL summary with no
  // tier therefore means "free" — normalize to the explicit sentinel so the UI
  // shows the plan and the Upgrade CTA for free users. "Unknown" (billing
  // unavailable) is signalled separately by the fetch rejecting → null account,
  // never by an absent tier on a successful read.
  const tier =
    typeof data.membershipTier === 'string' && data.membershipTier.trim()
      ? data.membershipTier.trim()
      : 'free';
  return { plan: tier, balanceUsd };
}

export const amrAgentDef = {
  id: 'amr',
  name: 'AMR',
  bin: 'vela',
  versionArgs: ['--version'],
  fetchModels: fetchVelaRemoteModelsWithRetry,
  // Fail closed when Vela's live catalog is unavailable. Stale static
  // fallbacks let users select models that link/opencode no longer accepts.
  fallbackModels: [] as RuntimeModelOption[],
  buildArgs: () => ['agent', 'run', '--runtime', 'opencode'],
  streamFormat: 'acp-json-rpc',
  // vela resumes the upstream OpenCode session via ACP session/load across
  // turns (the OpenCode session store persists per conversation), so the daemon
  // captures the durable handle, skips the transcript resend on resume, and
  // maps vela's resume_failed onto the reseed path. See resumesSessionViaAcpLoad.
  resumesSessionViaAcpLoad: true,
  // Vela routes model selection through ACP's `session/set_model` and only
  // accepts ids that survived the `vela models` preflight check, so a
  // free-text "Custom" id silently fails at spawn. The model picker
  // surfaces the live Vela catalog instead.
  supportsCustomModel: false,
  // vela's ACP transport carries images as `resource_link` prompt blocks —
  // see `agent-protocol/acp/session-params.ts#buildPromptBlocks`, shared by
  // every `acp-json-rpc` def, confirmed live to receive `imagePaths` from
  // `agent-executor.ts#wireAcpLifecycle` for all 9 of them, not just AMR.
  imageDelivery: 'native',
  // Daemon-process env override for emergency operator pinning. Normal UI
  // selection comes from the live `vela models` catalog and is preflighted
  // before spawn.
  defaultModelEnvVar: 'VELA_DEFAULT_MODEL',
  // Vela/OpenCode can spend extended stretches silent while the upstream
  // provider is still working. Keep the outer chat watchdog aligned with the
  // 30-minute ACP stage timeout so the daemon does not fail the run first.
  inactivityTimeoutMs: 30 * 60 * 1000,
} satisfies RuntimeAgentDef;
