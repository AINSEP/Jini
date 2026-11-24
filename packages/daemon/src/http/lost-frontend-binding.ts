/**
 * @file Turns "no frontend is bound" into a host-worded "reload the tab" for a run whose tab bound
 * with a token the daemon no longer knows.
 *
 * The daemon's frontend-session registry is in memory, so a restart (a watch-mode reload in dev, a
 * crash or deploy in production) forgets every tab's session. A tab that has not reconnected yet
 * still sends its old bind token with the next run; `bindRunByToken` throws "unknown or expired
 * bind token", `createFrontendControl`'s `onBindError` receives it, and the run goes on unbound
 * (deliberately: a failed bind never fails the run). Every frontend tool call in that run then
 * fails with the registry's bare `no frontend is bound to run "…"`, which tells neither the agent
 * nor the operator what to do.
 *
 * Both registry messages are accurate for what the registry knows; only the host knows what its
 * frontend is called and what the operator should do, so the host injects the three replacement
 * texts ({@link LostFrontendBindingMessages}). Matched on the registry's exact wording, pinned by
 * `__tests__/lost-frontend-binding.test.ts`.
 */
import type { ToolExecutionContext, ToolRegistration } from '@jini-ai/core';

const UNKNOWN_TOKEN = /unknown or expired bind token/;
const NOT_BOUND = /^no frontend is bound to run /;
const DETACHED = /^frontend session ".*" detached before answering$/;

/** Host-owned wording for the three frontend-loss cases. */
export interface LostFrontendBindingMessages {
  /** Replaces "no frontend is bound" for a run whose bind token was unknown (the daemon restarted under an open tab). */
  readonly lostBinding: string;
  /** Detail of the recoverable error when no frontend is bound for any other reason (tab closed, reloaded, stream dropped). */
  readonly unboundDetail: string;
  /** Detail of the recoverable error when the frontend detached before answering (outcome unknown). */
  readonly detachedDetail: string;
}

/**
 * The tab is simply gone for this run (closed, reloaded, its stream dropped) — not the restart
 * case above. Recoverable, so the agent asks for the tab and retries instead of reporting a dead
 * end. Only the message reaches the model (`ToolExecutor` keeps `err.message`), so it leads with
 * the code; `code`/`retryable` are for host code that inspects the error.
 */
export class FrontendDisconnectedError extends Error {
  readonly code = 'frontend_disconnected';
  readonly retryable = true;
  constructor({ detail, cause }: { detail: string; cause: unknown }) {
    super(`frontend_disconnected (retryable): ${detail}`, { cause });
    this.name = 'FrontendDisconnectedError';
  }
}

/** The host-facing replacement for a frontend-tool failure, or `null` to rethrow it unchanged. */
function rewrapFrontendError(
  { err, lostBinding, messages }: { err: unknown; lostBinding: boolean; messages: LostFrontendBindingMessages },
  _optional = {},
): Error | null {
  if (!(err instanceof Error)) return null;
  if (NOT_BOUND.test(err.message)) {
    return lostBinding
      ? new Error(messages.lostBinding, { cause: err })
      : new FrontendDisconnectedError({ detail: messages.unboundDetail, cause: err });
  }
  return DETACHED.test(err.message) ? new FrontendDisconnectedError({ detail: messages.detachedDetail, cause: err }) : null;
}

export interface LostFrontendBindings {
  /** Pass as `createFrontendControl`'s `onBindError` body. Records only unknown/expired-token failures. */
  noteBindError(context: { runId: string; error: unknown }): void;
  /** Wraps one frontend tool so a lost-binding run's "no frontend is bound" gets the reload message,
   *  and any other run's lost tab gets a recoverable {@link FrontendDisconnectedError}. */
  wrap(required: { registration: ToolRegistration }, optional?: Record<string, never>): ToolRegistration;
}

/**
 * @param required.messages - The host's wording for the three cases (see {@link LostFrontendBindingMessages}).
 * @param required.maxRuns - How many runs to remember. Bounded instead of released on terminal: a
 * run id only matters while its run is live, so forgetting the oldest after this many lost binds
 * costs nothing, and it keeps this off the run lifecycle entirely.
 */
export function createLostFrontendBindings(
  { messages, maxRuns = 256 }: { messages: LostFrontendBindingMessages; maxRuns?: number },
  _optional = {},
): LostFrontendBindings {
  const lostRuns = new Set<string>();

  return {
    noteBindError({ runId, error }) {
      if (!(error instanceof Error) || !UNKNOWN_TOKEN.test(error.message)) return;
      lostRuns.delete(runId);
      lostRuns.add(runId);
      if (lostRuns.size > maxRuns) lostRuns.delete(lostRuns.values().next().value as string);
    },
    wrap({ registration }) {
      return {
        ...registration,
        handler: async (ctx: ToolExecutionContext, options) => {
          try {
            return await registration.handler(ctx, options);
          } catch (err) {
            throw rewrapFrontendError({ err, lostBinding: lostRuns.has(ctx.run.id), messages }) ?? err;
          }
        },
      };
    },
  };
}
