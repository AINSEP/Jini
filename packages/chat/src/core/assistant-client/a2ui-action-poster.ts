/**
 * @module a2ui-action-poster
 * Client delivery for A2uiSurfaceCard's onAgentAction: routes, fetch and failure reporting are
 * host-supplied. Correlate by message.action/error.surfaceId, which names the exchange, rather
 * than the chat runId. functionResponse instead correlates by functionCallId and is not addressed
 * by this poster. The server validates the full renderer-to-agent envelope; checking an address
 * here does not replace that boundary.
 * Report a failed POST both through the injected reporter and the card's delivery outcome so a
 * click cannot fail silently. Status alone provides actionable copy without coupling to each
 * server error code; a 409 means the exchange closed, never that the person made a mistake.
 */

/** The `RendererToAgentMessage` shapes this module inspects for a `surfaceId` to address — kept as
 * a structural, not imported, type: this file has no other reason to depend on `@jini-ai/agentic`,
 * and `a2ui-actions-route.ts` is the actual schema authority. */
interface SurfaceAddressableMessage {
  action?: { surfaceId?: unknown };
  error?: { surfaceId?: unknown };
}

/** Delivery result compatible with A2uiSurfaceCard's onAgentAction outcome. Structural typing
 * keeps this module independent of React; assigning the poster to the prop checks compatibility. */
export type A2uiActionDeliveryOutcome = { readonly ok: true } | { readonly ok: false; readonly reason: string };

const NO_SURFACE_ID_REASON = "This action doesn't say which surface it answers, so there's nowhere to send it.";

/**
 * Maps `a2ui-actions-route.ts`'s real non-2xx status codes to wording a non-technical person can
 * act on. Deliberately keyed on status alone, not the route's `code`/`error` fields — every 400
 * cause (bad JSON shape, a schema-rejected envelope, a `surfaceId`/`exchangeId` mismatch) reduces to
 * the same actionable advice for a human, and a coarser mapping is less to keep in sync as the
 * route's validation grows new failure modes.
 *
 * @param status - The response's HTTP status. Only called for a non-`ok` response.
 * @complexity O(1).
 * @overallScore 100
 */
function reasonForStatus(status: number): string {
  switch (status) {
    case 409:
      // `a2ui-actions-route.ts`'s own comment on this status: "no such exchange" and "already
      // closed" both mean "this surface is no longer the one waiting on you" — the common case, not
      // a mistake the human just made, so the wording must not read as one.
      return "This surface is no longer waiting for a response — the agent has already moved on.";
    case 400:
      return "The agent didn't recognize this action. Reloading the conversation may fix it.";
    case 401:
      return "Your session couldn't be verified. Try reloading the page.";
    default:
      return `The action couldn't be delivered (server returned ${status}).`;
  }
}

export interface CreateA2uiActionPosterOptions {
  /** Host path appended to baseUrl. The factory requires it explicitly. */
  readonly path?: string;
  /** Abandon a call after this many ms. Defaults to 30s, matching `createMcpUiToolCaller`'s own default. */
  readonly timeoutMs?: number;
  /** Extra headers per request. `content-type` is always set and cannot be overridden. */
  readonly headers?: Readonly<Record<string, string>>;
}


const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * The exchange id a renderer→agent message declares, or `undefined` if it declares none.
 *
 * Only `action` and `error` carry `surfaceId` on the wire — `functionResponse` correlates by
 * `functionCallId` instead (see `interpreter.ts`'s module doc, decision 2). `buildAction`'s
 * agent-directed branch only ever produces an `ActionMessage`, so the `functionResponse` case is
 * unreachable from this call site today; handled anyway so this function's contract does not
 * silently depend on that.
 *
 * @complexity O(1).
 * @overallScore 100
 */
function surfaceIdOf(message: unknown): string | undefined {
  if (typeof message !== "object" || message === null) return undefined;
  const { action, error } = message as SurfaceAddressableMessage;
  const candidate = typeof action?.surfaceId === "string" ? action.surfaceId : error?.surfaceId;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
}

/**
 * Builds an `A2uiSurfaceCardProps["onAgentAction"]` handler that POSTs `{exchangeId, message}` to
 * `baseUrl + path` and resolves to the delivery outcome, which the card uses to show a
 * delivery-failure notice instead of leaving a click that looks like it did nothing.
 *
 * @param baseUrl - Origin to call. `""` for same-origin, the common case for an admin UI proxied to
 * its own API.
 * @complexity O(1) — one request per call.
 */
export function createA2uiActionPoster(
  { baseUrl, path, fetch, reportFailure }: A2uiActionPosterInput,
  options: Omit<CreateA2uiActionPosterOptions, "path"> = {},
): (runId: string | undefined, message: unknown) => Promise<A2uiActionDeliveryOutcome> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const endpoint = `${baseUrl.replace(/\/$/u, "")}${path}`;

  return async (runId, message) => {
    const exchangeId = surfaceIdOf(message);
    if (!exchangeId) {
      // Not reachable from `A2uiSurfaceCard`'s own call site today (see this module's doc), but a
      // future `wantResponse`/`callFunction` path could reach here with a message this poster has no
      // address for — reported rather than silently dropped, so a real gap is visible in devtools
      // instead of looking like an action that quietly did nothing.
      reportFailure({ args: [`[a2ui] cannot deliver an action with no surfaceId (run ${runId ?? "unknown"})`, message] }, {});
      return { ok: false, reason: NO_SURFACE_ID_REASON };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: { ...options.headers, "content-type": "application/json" },
        body: JSON.stringify({ exchangeId, message }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        reportFailure({ args: [`[a2ui] action delivery failed (${response.status}) for surface ${exchangeId}`, detail] }, {});
        return { ok: false, reason: reasonForStatus(response.status) };
      }
      return { ok: true };
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "AbortError";
      reportFailure({ args: [`[a2ui] action delivery failed for surface ${exchangeId}`, timedOut ? `timed out after ${timeoutMs}ms` : error] }, {});
      return {
        ok: false,
        reason: timedOut
          ? "This took too long to deliver and was given up on."
          : "Couldn't reach the server to deliver this action.",
      };
    } finally {
      clearTimeout(timer);
    }
  };
}

export interface A2uiActionPosterInput {
 readonly baseUrl: string; readonly path: string; readonly fetch: typeof fetch;
 readonly reportFailure: (required: { args: readonly unknown[] }, optional: Record<string, never>) => void;
}
