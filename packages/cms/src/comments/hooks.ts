/**
 * @file `hooks.ts` — fixed-order, fail-closed hook dispatch for the two typed hook points
 * `ports.ts#CommentHookPoints` declares (ADR-009 §3, ADR-024 §7). Mirrors
 * `newsletter/hooks.ts`'s factory-not-singleton shape (`createHookRegistry`) — avoids a hidden
 * cross-test/cross-instance module-level singleton.
 *
 * `comments.beforeSubmit` handlers run in registration order; the first `reject` short-circuits
 * (fail-closed on veto, same as a throw). A THROWING handler is also fail-closed rejection, never
 * "keep by default" — the spam-check adapter is expected to attach here as one such handler.
 */
import type { CommentHookPoints, CommentIngressRejection } from "./ports.js";
import type { CommentSubmission } from "./types.js";

export type BeforeSubmitHook = CommentHookPoints["comments.beforeSubmit"];
export type StatusChangedHook = CommentHookPoints["comments.statusChanged"];

export type BeforeSubmitChainResult = { submission: CommentSubmission } | { reject: CommentIngressRejection };

export interface CommentHookRegistry {
  /** Adds a filter in registration order; throws during dispatch reject the submission.
   * @complexity Amortized O(1) registration time and space.
   * @example registry.registerBeforeSubmitHook({ hook: async ({ submission }) => ({ submission }) }, {})
   */
  registerBeforeSubmitHook(required: { hook: BeforeSubmitHook }, optional?: Record<string, never>): void;
  /** Adds a post-commit notification; errors during dispatch never undo committed writes.
   * @complexity Amortized O(1) registration time and space.
   * @example registry.registerStatusChangedHook({ hook: async () => {} }, {})
   */
  registerStatusChangedHook(required: { hook: StatusChangedHook }, optional?: Record<string, never>): void;
  runBeforeSubmitChain(submission: CommentSubmission, optional?: Record<string, never>): Promise<BeforeSubmitChainResult>;
  runStatusChangedHooks(payload: Parameters<StatusChangedHook>[0], optional?: Record<string, never>): Promise<void>;
}

export function createCommentHookRegistry(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): CommentHookRegistry {
  const beforeSubmitHooks: BeforeSubmitHook[] = [];
  const statusChangedHooks: StatusChangedHook[] = [];

  return {
    registerBeforeSubmitHook({ hook }, _optional = {}) {
      beforeSubmitHooks.push(hook);
    },
    registerStatusChangedHook({ hook }, _optional = {}) {
      statusChangedHooks.push(hook);
    },
    async runBeforeSubmitChain(initial) {
      let submission = initial;
      for (const hook of beforeSubmitHooks) {
        let result: Awaited<ReturnType<BeforeSubmitHook>>;
        try {
          result = await hook({ submission });
        } catch {
          // A throwing filter is fail-closed rejection, never "keep by default".
          return { reject: "invalid" };
        }
        if ("reject" in result) return result;
        submission = result.submission;
      }
      return { submission };
    },
    async runStatusChangedHooks(payload) {
      for (const hook of statusChangedHooks) {
        try {
          await hook(payload);
        } catch {
          // Action hooks are post-commit notifications — a throwing one must not undo the
          // already-committed status change; it is swallowed, not fail-closed like beforeSubmit.
        }
      }
    },
  };
}
