/**
 * @file The per-section authorize-then-collect step both Site Inspection aggregators share:
 * `buildSiteProfile` (`site-profile.ts`) and `buildSiteCapabilities` (`site-capabilities.ts`).
 * Each section uses its own permission, isolates failures and excludes error messages from the
 * response. One implementation prevents the two aggregators' security guarantees from drifting.
 *
 * `site-profile.ts`'s header explains why that shape is structural rather than a convention: an
 * aggregator gated on one permission would be a privilege-escalation shortcut around every domain
 * gate it aggregates.
 */

/**
 * Why a section carries no data.
 * - `ok` — collected.
 * - `forbidden` — `authorize()` denied THIS section's own permission. Never silent.
 * - `unavailable` — the read threw, timed out, or its port was never wired. Also never silent: a
 *   consumer must read this as "unable to assess", not as a pass or as "nothing there".
 */
export type InspectionSectionStatus = "ok" | "forbidden" | "unavailable";

/**
 * The host's server-side reporter for one failed section. Receives the FULL error (the response
 * never does). The host owns the log format and sink; this package never prints.
 */
export type InspectionFailureReporter = (input: { label: string; section: string; error: unknown }) => void;

export interface InspectionSection<T> {
  status: InspectionSectionStatus;
  /** Present if and only if `status === "ok"`. */
  data?: T;
  /** `true` when a cap dropped rows/values from `data` — never inferred from array length. */
  truncated?: boolean;
  /**
   * Machine-readable cause for a non-`ok` status. For `forbidden` this is `authorize()`'s own
   * `reason`. For `unavailable` it is `"timed-out"`, a {@link SectionUnavailableError}'s own reason,
   * or the thrown error's CLASS NAME — deliberately not its message: an error message can quote row
   * data the DTO never chose to expose, and this response is handed to an LLM. The full error is
   * logged server-side instead.
   */
  reason?: string;
}

/** What one section collector produced, before it is wrapped in an {@link InspectionSection}. */
export interface CollectedSection<T> {
  data: T;
  truncated?: boolean;
}

/**
 * `authorize()`'s shape, declared structurally rather than imported from `@jini-ai/cms/core`, so this
 * module names only what it calls. `AuthorizeFn` satisfies it directly.
 */
export type InspectionAuthorizeFn = (params: {
  principalId: string;
  permission: string;
  workspaceId: string;
  entityType?: string;
  entityId?: string;
}) => Promise<{ allowed: boolean; reason: string }>;

/** Default per-section wall clock. These are local reads; a section still hanging past this is a
 *  fault, and reporting `unavailable` beats hanging the agent's turn. */
export const DEFAULT_SECTION_TIMEOUT_MS = 5_000;

/**
 * Thrown by a collector that knows exactly why it cannot run — today, a port the composition root
 * never supplied. Its `reason` is a fixed, data-free string, so unlike an arbitrary error it is safe
 * to report verbatim.
 */
export class SectionUnavailableError extends Error {
  readonly reason: string;

  constructor({ reason }: { reason: string }) {
    super(`section unavailable: ${reason}`);
    this.name = "SectionUnavailableError";
    this.reason = reason;
  }
}

/**
 * Rejects after `ms`, so one wedged read cannot hang the whole aggregate.
 *
 * The timer is always cleared, including on the success path, so nothing here keeps a Node process
 * (or a `node:test` run) alive past the call.
 *
 * @throws {Error} Named `SectionTimeoutError` when `ms` elapses first.
 * @complexity O(1) beyond `work`.
 */
async function withTimeout<T>({ work, ms, label }: { work: Promise<T>; ms: number; label: string }, _optional = {}): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          const error = new Error(`${label} section timed out after ${ms}ms`);
          error.name = "SectionTimeoutError";
          reject(error);
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Authorizes ONE section against its own permission, then collects it.
 *
 * `authorize()` runs BEFORE `collect` is ever called, so a denied section performs no read at all.
 *
 * @param spec.authorize - The authorization port.
 * @param spec.workspaceId - The workspace every decision is scoped to.
 * @param spec.principalId - Who is asking.
 * @param spec.section - The section name, passed to `authorize()` as the entity id.
 * @param spec.permission - That section's own domain permission.
 * @param spec.entityType - The aggregate's entity type for `authorize()` (e.g. `site-profile-section`).
 * @param spec.logLabel - Label passed to `reportFailure` and used in the timeout message.
 * @param spec.reportFailure - The host's server-side failure reporter. It receives the FULL error;
 *   this module never formats or prints a log line itself.
 * @param spec.timeoutMs - Wall clock before the section is `unavailable`/`timed-out`.
 * @param spec.collect - The section's read, invoked only after authorization passes.
 * @returns `ok` on success, `forbidden` on denial, `unavailable` on throw/timeout. Never throws: one
 * broken section must not fail the others.
 * @complexity O(1) plus one `authorize()` call plus `collect`'s own cost.
 * @example
 * await authorizeAndCollectSection({ authorize, workspaceId, principalId, section: "tools", permission: "admin.assistant.use",
 *   entityType: "site-capabilities-section", logLabel: "site-capabilities", reportFailure, timeoutMs: 5000,
 *   collect: async () => ({ data }) });
 */
export async function authorizeAndCollectSection<T>(spec: {
  authorize: InspectionAuthorizeFn;
  workspaceId: string;
  principalId: string;
  section: string;
  permission: string;
  entityType: string;
  logLabel: string;
  reportFailure: InspectionFailureReporter;
  timeoutMs: number;
  collect: () => Promise<CollectedSection<T>>;
}): Promise<InspectionSection<T>> {
  try {
    const decision = await spec.authorize({
      principalId: spec.principalId,
      permission: spec.permission,
      workspaceId: spec.workspaceId,
      entityType: spec.entityType,
      entityId: spec.section,
    });
    if (!decision.allowed) {
      return { status: "forbidden", reason: decision.reason };
    }

    const collected = await withTimeout({ work: spec.collect(), ms: spec.timeoutMs, label: spec.logLabel });
    return collected.truncated
      ? { status: "ok", data: collected.data, truncated: true }
      : { status: "ok", data: collected.data };
  } catch (err) {
    // Observability: the FULL error goes to the host's server-side reporter, where a secret in an
    // error message is no worse off than it already was. Only a fixed reason or the class name
    // crosses into the response — see `InspectionSection.reason`'s own doc for why the message
    // deliberately does not.
    spec.reportFailure({ label: spec.logLabel, section: spec.section, error: err });
    if (err instanceof SectionUnavailableError) return { status: "unavailable", reason: err.reason };
    const name = err instanceof Error ? err.name : "UnknownError";
    return { status: "unavailable", reason: name === "SectionTimeoutError" ? "timed-out" : name };
  }
}

/**
 * De-duplicates and orders requested section names against a closed vocabulary, so a response's key
 * order is stable however the caller ordered its `sections` array.
 *
 * @param input.vocabulary - Every section the aggregate can report, in response order.
 * @param input.requested - The caller's selection. Omitted or empty means all of `vocabulary`.
 * @returns The selected names, in vocabulary order.
 * @complexity O(V + R) in the vocabulary and requested sizes.
 * @example resolveRequestedSections({ vocabulary: ["a", "b"], requested: ["b", "a", "b"] }); // => ["a", "b"]
 */
export function resolveRequestedSections<N extends string>(input: {
  vocabulary: readonly N[];
  requested: readonly N[] | undefined;
}): N[] {
  if (input.requested === undefined || input.requested.length === 0) return [...input.vocabulary];
  const asked = new Set<string>(input.requested);
  return input.vocabulary.filter((name) => asked.has(name));
}
