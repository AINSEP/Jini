/**
 * @module argv-prompt-variants
 *
 * Fits one of a host's prompt variants into the argv slot an argv-bound def already filled with the
 * base prompt. The host drafts the variants (full guidance, catalog rows, a pointer, the bare base);
 * only this driver knows the image-path text, the system-overlay transformation, the resolved
 * binary, and the real argument vector, so the sizing has to happen here, against those.
 *
 * Why the argv is reused rather than rebuilt per candidate: `buildArgs` (and the staging around it)
 * can perform real effects — a `runtimeLock` def's builder writes process-global state its CLI reads
 * back, and policy/staging phases run exactly once per run. Sizing must never repeat adapter effects,
 * so each candidate replaces only the verified last argument of the single built argv, and every
 * probe is a pure budget predicate. The effectful Windows guard still runs once, afterwards, on the
 * selected argv as the final check.
 */
import type { RuntimeAgentDef, RuntimePromptBudgetError } from '@jini-ai/core/contracts/agents';
import type { AgentExecutorErrorCode, ArgvPromptVariant, ArgvPromptVariants } from './contracts.js';

/** The pure runtime budget predicates (`AgentRuntimePort['launch']`) the probes reuse unchanged. */
export type ArgvPromptBudget = {
  readonly promptArgvBudget: (required: { def: RuntimeAgentDef; composed: unknown }) => RuntimePromptBudgetError | null;
  readonly windowsCmdShimBudget: (required: { def: RuntimeAgentDef; resolvedBin: unknown; args: unknown }) => RuntimePromptBudgetError | null;
  readonly windowsDirectExeBudget: (required: { def: RuntimeAgentDef; resolvedBin: unknown; args: unknown }) => RuntimePromptBudgetError | null;
};

export type SelectedArgvPrompt = { readonly id: ArgvPromptVariant['id']; readonly prompt: string; readonly args: readonly string[] };

/** Optional guidance first, the unmodified base last. */
const VARIANT_ORDER = ['full', 'catalog', 'pointer'] as const;

function probeBudget({ def, resolvedBin, composed, args, budget }: {
  def: RuntimeAgentDef; resolvedBin: string; composed: string; args: readonly string[]; budget: ArgvPromptBudget;
}, _optional = {}): RuntimePromptBudgetError | null {
  return budget.promptArgvBudget({ def, composed })
    ?? budget.windowsCmdShimBudget({ def, resolvedBin, args })
    ?? budget.windowsDirectExeBudget({ def, resolvedBin, args });
}

/**
 * Picks the richest candidate whose composed prompt and whole argv pass every budget for the actual
 * resolved binary; falls back to the unmodified base, which must pass the same checks, or returns the
 * base's budget error. A last argument that is not exactly `baseComposedPrompt` means the declared
 * carrier does not hold, so no optional guidance is ever claimed and only the base is considered.
 * A `base` candidate is never substituted: the base is always the argv already built.
 */
export function selectArgvPromptVariant({ def, resolvedBin, baseArgs, baseComposedPrompt, candidates, compose, budget }: {
  readonly def: RuntimeAgentDef;
  readonly resolvedBin: string;
  readonly baseArgs: readonly string[];
  readonly baseComposedPrompt: string;
  readonly candidates: readonly ArgvPromptVariant[];
  readonly compose: (prompt: string) => string;
  readonly budget: ArgvPromptBudget;
}, _optional = {}): SelectedArgvPrompt | RuntimePromptBudgetError {
  const carrierVerified = baseArgs.length > 0 && baseArgs.at(-1) === baseComposedPrompt;
  if (carrierVerified) {
    const head = baseArgs.slice(0, -1);
    for (const id of VARIANT_ORDER) {
      const candidate = candidates.find((entry) => entry.id === id);
      if (candidate === undefined) continue;
      const composed = compose(candidate.prompt);
      const args = [...head, composed];
      if (probeBudget({ def, resolvedBin, composed, args, budget }) === null) return { id, prompt: composed, args };
    }
  }
  return probeBudget({ def, resolvedBin, composed: baseComposedPrompt, args: baseArgs, budget })
    ?? { id: 'base', prompt: baseComposedPrompt, args: baseArgs };
}

/** Only a def that promises the last-argv carrier, and has no subagent settings hook, opts in. */
export function acceptsArgvPromptVariants({ def }: { readonly def: RuntimeAgentDef }, _optional = {}): boolean {
  return def.argvPromptPosition === 'last' && def.promptViaStdin !== true && def.promptViaFile !== true && def.subagentStartHook === undefined;
}

function isBudgetError(value: SelectedArgvPrompt | RuntimePromptBudgetError): value is RuntimePromptBudgetError {
  return !('args' in value);
}

/**
 * Launch-side wrapper: selects (pure), and on no fit follows the existing `AGENT_PROMPT_TOO_LARGE`
 * before-spawn path. Returns the argv to hand to the final Windows guard. `variants` absent or a def
 * that did not opt in returns `baseArgs` untouched, so those runs stay byte-identical.
 */
export async function fitArgvPromptVariant({ runId, def, resolvedBin, baseArgs, baseComposedPrompt, variants, compose, budget, releaseStagedResources, failBeforeSpawn }: {
  readonly runId: string;
  readonly def: RuntimeAgentDef;
  readonly resolvedBin: string;
  readonly baseArgs: string[];
  readonly baseComposedPrompt: string;
  readonly variants: ArgvPromptVariants | undefined;
  readonly compose: (prompt: string) => string;
  readonly budget: ArgvPromptBudget;
  readonly releaseStagedResources: () => Promise<void>;
  readonly failBeforeSpawn: (required: { runId: string; code: AgentExecutorErrorCode; message: string }) => Promise<never>;
}, _optional = {}): Promise<{ readonly args: string[]; readonly selectedId: ArgvPromptVariant['id'] | null }> {
  if (variants === undefined || !acceptsArgvPromptVariants({ def })) return { args: baseArgs, selectedId: null };
  const selected = selectArgvPromptVariant({ def, resolvedBin, baseArgs, baseComposedPrompt, candidates: variants.candidates, compose, budget });
  if (isBudgetError(selected)) {
    await releaseStagedResources();
    return failBeforeSpawn({ runId, code: 'AGENT_PROMPT_TOO_LARGE', message: selected.message });
  }
  return { args: [...selected.args], selectedId: selected.id };
}

/**
 * Reports the validated selection to the host before spawn. A rejection is a refusal: staged
 * resources are released and the run fails before any process exists. The callback's own error is
 * never forwarded — it may carry host detail — only a plain-words reason.
 */
export async function confirmArgvPromptSelection({ runId, def, variants, selectedId, releaseStagedResources, failBeforeSpawn }: {
  readonly runId: string;
  readonly def: RuntimeAgentDef;
  readonly variants: ArgvPromptVariants | undefined;
  readonly selectedId: ArgvPromptVariant['id'] | null;
  readonly releaseStagedResources: () => Promise<void>;
  readonly failBeforeSpawn: (required: { runId: string; code: AgentExecutorErrorCode; message: string }) => Promise<never>;
}, _optional = {}): Promise<void> {
  if (variants === undefined || selectedId === null) return;
  try {
    await variants.onSelected({ runId, id: selectedId });
  } catch {
    await releaseStagedResources();
    await failBeforeSpawn({ runId, code: 'AGENT_SPAWN_FAILED', message: `AgentExecutor: the host declined the selected prompt for agent "${def.id}", so it was not started.` });
  }
}
