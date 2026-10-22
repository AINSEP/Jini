import type { ChatAttachment } from "../messages.js";

/**
 * @file Restore cached attachment references only after the host confirms their bytes still exist.
 * Drafts persist references separately from text; staged bytes have a host-defined TTL. Dropping
 * an unconfirmed live reference costs a re-drag, while restoring a dead one causes a failed turn.
 * Ref shape, endpoint and probe cap enter through host ports: malformed/excess refs, refusals,
 * network failures and timeouts are discarded, without losing the draft's words.
 * HEAD avoids downloading every attachment to answer a liveness question. The host endpoint must
 * support it (Express routes HEAD through a GET handler when no HEAD handler exists and omits the
 * body); get-chat-attachment-route.test.ts covers the original composed route.
 */







/** In-flight probes. Matches `createDaemonAttachmentUploader`'s own upload concurrency — enough to
 *  hide localhost latency, few enough to leave the page's connection budget alone. */
const DEFAULT_CONCURRENCY = 2;

/** Abort deadline per probe. A restore runs at mount behind the composer, so a wedged request must
 *  not keep a worker (and the operator's attachment chips) pending indefinitely. */
const DEFAULT_TIMEOUT_MS = 10_000;

export interface ChatAttachmentValidatorOptions {
  /** Injected `fetch` for tests; defaults to the page's own. */
  readonly fetchImpl?: typeof fetch;
  /** In-flight probe cap. Defaults to {@link DEFAULT_CONCURRENCY}. */
  readonly concurrency?: number;
  /** Per-probe abort deadline in ms. Defaults to {@link DEFAULT_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
}

/**
 * Whether the server still serves this one reference.
 *
 * @param ref opaque `attachment:<uuid>` capability id (`ChatAttachment.path`).
 * @returns `true` only on a 2xx. Every refusal and every fault answers `false` — the caller cannot
 *   act differently on them, and a probe that could not reach the server has not confirmed anything.
 * @complexity O(1); one request, abandoned after `timeoutMs`.
 */
async function isAttachmentStillServed(ref: string, options: { fetchImpl: typeof fetch; timeoutMs: number; endpoint: (required: { ref: string }, optional: Record<string, never>) => string }): Promise<boolean> {
  try {
    const response = await options.fetchImpl(options.endpoint({ ref }, {}), {
      method: "HEAD",
      credentials: "same-origin",
      signal: AbortSignal.timeout(options.timeoutMs),
    });
    return response.ok;
  } catch {
    // A network fault, an abort, or a same-origin policy refusal. Indistinguishable from here, and
    // all mean the same thing: nothing was confirmed, so the reference does not come back.
    return false;
  }
}

/**
 * Runs `probe` over `refs` with at most `concurrency` in flight, answering positionally.
 *
 * Shared-iterator workers rather than a chunked `Promise.all` loop, for the same reason
 * `createDaemonAttachmentUploader` uses them: a chunked loop stalls the whole batch on its slowest
 * member, and this one runs while the operator is looking at a half-restored composer.
 *
 * @complexity O(n) requests, at most `concurrency` concurrent; O(n) space for the verdicts.
 */
async function probeAll(refs: readonly string[], concurrency: number, probe: (ref: string) => Promise<boolean>): Promise<boolean[]> {
  const verdicts = new Array<boolean>(refs.length).fill(false);
  const entries = refs.entries();
  async function worker(): Promise<void> {
    for (const [index, ref] of entries) {
      verdicts[index] = await probe(ref);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, refs.length)) }, worker));
  return verdicts;
}

/**
 * Builds the `validateAttachments` callback `<ChatPane>` calls when it restores a persisted draft.
 *
 * @param input.fetch injected request implementation; the host supplies it explicitly.
 * @param input.endpoint resolves a reference to the host's HEAD-capable read endpoint.
 * @param input.isSupportedRef validates the host's staged-reference grammar before a request.
 * @param input.maxProbedAttachments bounds request fan-out from malformed or hand-edited drafts.
 * @param options.concurrency in-flight probe cap; defaults to {@link DEFAULT_CONCURRENCY}.
 * @param options.timeoutMs per-probe abort deadline; defaults to {@link DEFAULT_TIMEOUT_MS}.
 * @returns a validator taking the cached references and resolving to the subset still served, in
 *   the order they were given. Never rejects: a caller's only sane response to a rejection is to
 *   restore nothing, which is what an empty subset already means.
 * @complexity O(n) requests bounded by input.maxProbedAttachments, at most concurrency at once.
 * @example
 * <ChatPane validateAttachments={createChatAttachmentValidator({ fetch, endpoint, isSupportedRef, maxProbedAttachments })} />
 */
export function createChatAttachmentValidator(
  { fetch, endpoint, isSupportedRef, maxProbedAttachments }: ChatAttachmentValidatorInput,
  options: Omit<ChatAttachmentValidatorOptions, "fetchImpl"> = {},
): (attachments: readonly ChatAttachment[]) => Promise<readonly ChatAttachment[]> {
  const probeOptions = {
    fetchImpl: fetch,
    endpoint,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;

  return async (attachments) => {
    const candidates = attachments
      .slice(0, maxProbedAttachments)
      .filter((candidate) => isSupportedRef({ ref: candidate.path }, {}));
    if (candidates.length === 0) return [];

    const verdicts = await probeAll(
      candidates.map((candidate) => candidate.path),
      concurrency,
      (ref) => isAttachmentStillServed(ref, probeOptions),
    );
    return candidates.filter((_, index) => verdicts[index]);
  };
}

export interface ChatAttachmentValidatorInput {
 readonly fetch: typeof fetch;
 readonly endpoint: (required: { ref: string }, optional: Record<string, never>) => string;
 readonly isSupportedRef: (required: { ref: string }, optional: Record<string, never>) => boolean;
 readonly maxProbedAttachments: number;
}
