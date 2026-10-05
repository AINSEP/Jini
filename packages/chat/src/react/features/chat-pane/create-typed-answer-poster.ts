/**
 * @module create-typed-answer-poster
 *
 * The client half of a typed answer: a ready-made {@link DeliverTypedAnswer} that posts text the
 * human typed into the composer to the MCP-UI tool-call route, for the question a running agent is
 * holding open. Pass it as `ChatPane`'s `deliverTypedAnswer`.
 *
 * ```tsx
 * <ChatPane deliverTypedAnswer={createTypedAnswerPoster({ baseUrl: '', fetch, toolName: 'ask_choice' })} />
 * ```
 *
 * Sibling of `create-mcp-ui-tool-caller.ts`, and the same wire shape: `{toolName, params}` to the
 * same route. The difference is what the params carry and what the caller needs back.
 *
 * ## Why the body names no exchange
 *
 * A human typing into the composer has never seen an exchange id; the only client-side copy lives
 * inside the surface's own (model-influenced, sandboxed) HTML. So the body carries only the tool and
 * the text under {@link TYPED_ANSWER_PARAM}, and the server resolves which open exchange — for that
 * tool and the request's own authenticated principal — the answer is for (`@jini-ai/daemon`'s
 * `findTypedAnswerTarget`).
 *
 * ## Why it resolves an outcome instead of throwing
 *
 * The pane must tell three cases apart and act differently on each, never by queueing the text as a
 * new run: 202 delivered it; 409 means nothing is waiting any more (answered, expired, or never
 * open); anything else is a failure the human can retry. A rejection would collapse the last two.
 */
import type { DeliverTypedAnswer, TypedAnswerDelivery } from './types.js';

/**
 * The params key a typed answer travels under. Spelled here rather than imported because this
 * browser package cannot depend on `@jini-ai/daemon`, which owns the canonical
 * `SURFACE_TYPED_ANSWER_PARAM`; `@jini-ai/mcp`'s ask-choice tool keeps its own copy for the same
 * reason. All three must agree.
 */
const TYPED_ANSWER_PARAM = '__typedAnswer';

export interface CreateTypedAnswerPosterOptions {
  /** Path appended to `baseUrl`. Defaults to `/api/mcp-ui/tool-calls`, as for `createMcpUiToolCaller`. */
  readonly path?: string;
  /** Abandon a post after this many ms (reported as `'failed'`). Defaults to 30s. */
  readonly timeoutMs?: number;
  /** Extra headers per request (e.g. a CSRF token). `content-type` is always set and cannot be overridden. */
  readonly headers?: Readonly<Record<string, string>>;
}

const DEFAULT_PATH = '/api/mcp-ui/tool-calls';
const DEFAULT_TIMEOUT_MS = 30_000;

/** Maps the route's status onto an outcome. Only 202 is a delivery; a 200 would be a fresh execution. */
function deliveryFor(status: number): TypedAnswerDelivery {
  if (status === 202) return 'delivered';
  return status === 409 ? 'not-pending' : 'failed';
}

/**
 * Builds a {@link DeliverTypedAnswer} that POSTs `{toolName, params: {__typedAnswer: text}}`.
 *
 * @param deps.baseUrl - Origin to call; `''` for same-origin.
 * @param deps.fetch - The fetch to use (the browser's, in production).
 * @param deps.toolName - The host's question tool id — the server only routes typed answers to a
 *   tool that opted in, so this package cannot pick it.
 * @returns Resolves to the outcome; never rejects. Carries `toolName`, which also tells the pane
 *   which tool's open card is a question awaiting typed text.
 * @complexity O(1) — one request per call.
 */
export function createTypedAnswerPoster(
  { baseUrl, fetch, toolName }: { baseUrl: string; fetch: typeof globalThis.fetch; toolName: string },
  options: CreateTypedAnswerPosterOptions = {},
): DeliverTypedAnswer {
  const endpoint = `${baseUrl.replace(/\/$/u, '')}${options.path ?? DEFAULT_PATH}`;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const deliver = async ({ text }: { text: string }): Promise<TypedAnswerDelivery> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const outcome = await fetch(endpoint, {
      method: 'POST',
      // Same-origin cookie session: the human's own credentials authorize the answer.
      credentials: 'same-origin',
      headers: { ...options.headers, 'content-type': 'application/json' },
      body: JSON.stringify({ toolName, params: { [TYPED_ANSWER_PARAM]: text } }),
      signal: controller.signal,
    }).then((response) => deliveryFor(response.status), (): TypedAnswerDelivery => 'failed');
    clearTimeout(timer);
    return outcome;
  };
  return Object.assign(deliver, { toolName });
}
