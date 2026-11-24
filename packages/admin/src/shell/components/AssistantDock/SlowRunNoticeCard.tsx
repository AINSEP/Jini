import type { ExtEventRenderProps, KitChatTranslator } from "../../../react/kit.js";

import { isSlowRunNoticeVisible, resolveSlowRunDetail } from "./SlowRunNoticeCard.hooks.js";

/**
 * @file Renders Jini's slow-run notice inline in the transcript — the wall-clock "still working"
 * signal `@jini-ai/daemon`'s `run-lifecycle.ts` emits (a `type: 'slow_running'` agent event) once a
 * run has gone `DEFAULT_SLOW_RUN_THRESHOLD_MS` (45s, kernel-wide default — no host-side opt-in
 * needed) with no activity. That daemon-side watchdog is deliberately NON-terminating: the run is
 * left `running`, so this card is purely informational — the composer's existing Stop button (part
 * of `ChatPane`'s own always-available run controls) is the operator's one and only action, exactly
 * as it already is for any other in-progress run.
 *
 * `hooks/use-dock-renderer-registry.hooks.ts` registers this component under `slow_running` in
 * the dock's owned registry, the same extension point used for `mcp-ui`/`a2ui` (`OverflowAwareMcpUiSurfaceCard`,
 * `RoutedA2uiSurfaceCard`, this folder's siblings). That registration is deliberate, not incidental:
 * `@jini-ai/protocol`'s `RunAgentPayload` already has an older `'status'` variant that could have
 * carried this same `label`/`detail` shape, but nothing in this codebase renders `kind: 'status'`
 * events anywhere — verified across `@jini-ai/chat`'s `MessageRow.tsx`/`message-blocks.ts` and
 * the host's own `assistant-transport.ts` (whose existing `terminalReasonNotice` "Stopped early" notice
 * uses that same unrendered kind). The daemon's `'slow_running'` type instead falls through
 * `translateRunAgentPayload`'s `default` branch into `kind: 'ext'`, which this card renders.
 */

export function SlowRunNoticeCard({ events, runStreaming, runSucceeded, awaitingAnswer,
  useTHook }: (ExtEventRenderProps) & {
  /** The host's chat translator hook (the kit chat `useT`). */
  useTHook: () => KitChatTranslator; }) {
  const t = useTHook();
  if (!isSlowRunNoticeVisible({ runStreaming, runSucceeded }, { awaitingAnswer })) return null;
  return (
    <div className="jini-chat-pane__status" role="status">
      {resolveSlowRunDetail(events) ?? t("Still working — this is taking longer than usual.")}
    </div>
  );
}
