/**
 * @module create-mid-run-message-poster
 *
 * The client half of a mid-run message: a ready-made {@link DeliverMidRunMessage} that posts text the
 * human sent while a run streams to that run's live agent. Pass it as `ChatPane`'s
 * `deliverMidRunMessage`.
 *
 * ```tsx
 * <ChatPane deliverMidRunMessage={createMidRunMessagePoster({ baseUrl: '', fetch })} />
 * ```
 *
 * Sibling of `create-typed-answer-poster.ts`. The route is `@jini-ai/daemon`'s
 * `POST /api/runs/:runId/messages`: `202` when the agent took the text into its running turn, `409`
 * with `details.delivery` when it did not.
 *
 * ## Why it resolves an outcome instead of throwing
 *
 * The pane acts differently on each outcome and must never drop the text: `'unsupported'` stops the
 * run and sends the text as the next turn; `'not-running'` and `'failed'` queue it behind the run,
 * which is already ending (or may be — never cut short a run the host could not reach). A 404 means
 * the daemon never saw this run (a host-side run such as a BYOK API turn), so it is `'unsupported'`
 * too: no live process to steer, but an interrupt still works.
 */
import { redactUserText, type UserTextRedactionOptions } from '../../../core/user-text-redaction.js';
import type { DeliverMidRunMessage, MidRunMessageDelivery } from './types.js';

export interface CreateMidRunMessagePosterOptions extends UserTextRedactionOptions {
  /** Abandon a post after this many ms (reported as `'failed'`). Defaults to 30s. */
  readonly timeoutMs?: number;
  /** Extra headers per request (e.g. a CSRF token). `content-type` is always set and cannot be overridden. */
  readonly headers?: Readonly<Record<string, string>>;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/** Reads `error.details.delivery` off a 409 body; anything unreadable counts as `'unsupported'`. */
async function conflictDelivery(response: Response): Promise<MidRunMessageDelivery> {
  const body: unknown = await response.json().catch(() => null);
  const delivery = (body as { error?: { details?: { delivery?: unknown } } } | null)?.error?.details?.delivery;
  return delivery === 'not-running' ? 'not-running' : 'unsupported';
}

/** Maps the route's response onto an outcome. Only 202 is a delivery. */
async function deliveryFor(response: Response): Promise<MidRunMessageDelivery> {
  if (response.status === 202) return 'delivered';
  if (response.status === 409) return conflictDelivery(response);
  return response.status === 404 ? 'unsupported' : 'failed';
}

/**
 * Builds a {@link DeliverMidRunMessage} that POSTs `{text}` to `${baseUrl}/api/runs/:runId/messages`.
 *
 * @param deps.baseUrl - Origin to call; `''` for same-origin.
 * @param deps.fetch - The fetch to use (the browser's, in production).
 * @returns Resolves to the outcome; never rejects.
 * @complexity O(1) — one request per call.
 */
export function createMidRunMessagePoster(
  { baseUrl, fetch }: { baseUrl: string; fetch: typeof globalThis.fetch },
  options: CreateMidRunMessagePosterOptions = {},
): DeliverMidRunMessage {
  const origin = baseUrl.replace(/\/$/u, '');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return async ({ runId, text }) => {
    const result = (options.redactUserText ?? redactUserText)({ text });
    if (result.secretRedacted) options.onSecretRedacted?.({ secretRedacted: true, count: result.count });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const outcome = await fetch(`${origin}/api/runs/${encodeURIComponent(runId)}/messages`, {
      method: 'POST',
      // Same-origin cookie session: the human's own credentials authorize steering their run.
      credentials: 'same-origin',
      headers: { ...options.headers, 'content-type': 'application/json' },
      body: JSON.stringify({ text: result.text }),
      signal: controller.signal,
    }).then(deliveryFor, (): MidRunMessageDelivery => 'failed');
    clearTimeout(timer);
    return outcome;
  };
}
