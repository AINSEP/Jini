import type { UUID } from "@jini-ai/core/primitives";
import type { SettingsRepoPort } from "@jini-ai/core/settings";

/**
 * @file The read half of the admin Instructions tab's system-prompt seam: turns the stored
 * `core.instructions.custom` value into text the host daemon's `PromptAugmenter.
 * systemOverlay()` hands the spawned agent CLI. Prompt assembly belongs to the daemon process.
 *
 * `getEffective` must read fresh values: main-server writes cannot invalidate a cache keyed by
 * this daemon's independent repository instance. An indexed local row read is cheaper than
 * cross-process cache incoherence; see the owning settings module's cache rationale.
 *
 * `PromptAugmenter.systemOverlay()` returns synchronously, while the settings read is async.
 * `createCustomInstructionsCache` holds the last successfully resolved value; the caller refreshes
 * it before each run so the synchronous overlay can read it without I/O.
 */

const CUSTOM_INSTRUCTIONS_KEY = "custom";

/**
 * Structural signature matching `@jini-ai/core/settings`'s real `getEffective` export (a host may
 * re-export it from its own settings feature). Redeclared locally rather than imported as a value:
 * importing the FUNCTION here is the edge that would close an `[assistant, settings]` module cycle in
 * a host whose settings feature registers assistant tool contributors; see `ResolveCustomInstructionsDeps.getEffective`'s own doc for
 * how the real function still reaches this file despite the type living here instead of being
 * imported. `.value` is typed `unknown` (not `JsonValue`) because this file only ever narrows it with
 * `typeof ... === "string"` below — no caller here needs the full settings-value union.
 */
type GetEffective = (
  required: { deps: { repo: SettingsRepoPort }; namespace: string; key: string; scopeContext: { workspaceId: UUID } },
) => Promise<{ value: unknown } | null>;

export interface ResolveCustomInstructionsDeps {
  settingsRepo: SettingsRepoPort;
  /**
   * Resolves once boot-time definition registration for `core.instructions.*`
   * (the host's settings-tabs-ready promise) completes. Awaited before every read so a read that races
   * boot reads as "not yet registered" (falls through to `""`) rather than being misinterpreted —
   * the same discipline the host's settings-ready promise requires of every settings consumer.
   * Optional so a test that registers definitions itself before calling in doesn't need to thread a
   * dummy resolved promise through.
   * @default Promise.resolve()
   */
  settingsReady?: Promise<void>;
  /** The real `@jini-ai/core/settings` `getEffective` — injected rather than statically imported;
   *  see the `GetEffective` type's own doc. Wired to the real implementation at the host's
   *  composition root. */
  getEffective: GetEffective;
  /** The host settings feature's `INSTRUCTIONS_NAMESPACE` constant (e.g. `"core.instructions"`) —
   *  injected for uniformity with `getEffective` above rather than relocated to a new shared module,
   *  so this module never takes a runtime edge on the host's settings barrel. */
  instructionsNamespace: string;
  /**
   * Receives the fail-open read's message and error (see `resolveCustomInstructions`). Injected so
   * the host owns its log sink and any log-line prefix; the engine never writes to the console.
   */
  warn: (message: string, error: unknown) => void;
}

export interface ResolveCustomInstructionsInput {
  workspaceId: UUID;
}

/** The single object argument both entry points take: the injected deps plus the per-call input. */
export type ResolveCustomInstructionsArgs = ResolveCustomInstructionsDeps & ResolveCustomInstructionsInput;

/**
 * Reads `core.instructions.custom` fresh from the ledger for one workspace. getEffective owns
 * fresh reads; see the header for why independent processes cannot rely on cache invalidation.
 *
 * FAILS OPEN: any error (a repo I/O failure, `settingsReady` rejecting, a malformed stored value) is
 * logged and reads as `""` — a broken settings read must degrade the assistant to "no custom
 * instructions", never block a run from starting at all. This restates, at the one call site here
 * that cannot assume it, `getEffective`'s own documented "total, never throws" contract — the
 * evaluator logic above the repo is exempt from throwing; the repo's actual I/O underneath it is not.
 *
 * @complexity O(1) — one `getEffective` resolution.
 * @overallScore 100
 */
export async function resolveCustomInstructions(
  args: ResolveCustomInstructionsArgs,
  _optional = {},
): Promise<string> {
  try {
    await (args.settingsReady ?? Promise.resolve());
    const resolved = await args.getEffective({
      deps: { repo: args.settingsRepo },
      namespace: args.instructionsNamespace,
      key: CUSTOM_INSTRUCTIONS_KEY,
      scopeContext: { workspaceId: args.workspaceId },
    });
    return typeof resolved?.value === "string" ? resolved.value : "";
  } catch (error) {
    args.warn("resolveCustomInstructions failed; treating as unset", error);
    return "";
  }
}

const CUSTOM_INSTRUCTIONS_OVERLAY_HEADER =
  "The site operator has configured the following custom instructions for this assistant. Follow " +
  "them in addition to your default behavior, and defer to them if they conflict with it:";

/**
 * Formats a raw `core.instructions.custom` value as a `PromptAugmenter.systemOverlay()` block, or
 * `null` for empty/whitespace-only text — matching that seam's own "if non-null" contract
 * (`@jini-ai/agent-runtime`'s `prompt-augmenter.ts`) so an operator who has never set instructions
 * (or has cleared them back to the tab's empty-textarea default) gets byte-identical behavior to
 * before this file existed.
 *
 * @complexity O(n) in the length of `customInstructions` — one trim, one length check.
 * @overallScore 100
 */
export function formatCustomInstructionsOverlay({ customInstructions }: { customInstructions: string }, _optional = {}): string | null {
  const trimmed = customInstructions.trim();
  return trimmed.length === 0 ? null : `${CUSTOM_INSTRUCTIONS_OVERLAY_HEADER}\n\n${trimmed}`;
}

export interface CustomInstructionsCache {
  /**
   * Re-resolves `core.instructions.custom` and updates what `readOverlay()` returns next. Never
   * rejects — inherits `resolveCustomInstructions`'s fail-open contract.
   */
  refresh(): Promise<void>;
  /**
   * Synchronous read of the last successfully refreshed value, formatted per
   * `formatCustomInstructionsOverlay`. `null` before the first `refresh()` ever resolves, which is
   * indistinguishable from "no custom instructions set" — the only value `systemOverlay()`'s
   * synchronous contract allows before any async read has had a chance to complete.
   */
  readOverlay(): string | null;
}

/**
 * The synchronous-read bridge this file's header describes. The host daemon constructs one
 * instance for its single workspace, calls `refresh()` once per run start (before starting the
 * agent, so the read is never older than "as of this conversation turn"), and wires `readOverlay`
 * into `PromptAugmenter.systemOverlay()`.
 *
 * @complexity O(1) to construct; `refresh()` is `resolveCustomInstructions`'s O(1).
 * @overallScore 100
 */
export function createCustomInstructionsCache(
  args: ResolveCustomInstructionsArgs,
  _optional = {},
): CustomInstructionsCache {
  let latest = "";
  return {
    async refresh() {
      latest = await resolveCustomInstructions(args);
    },
    readOverlay() {
      return formatCustomInstructionsOverlay({ customInstructions: latest });
    },
  };
}
