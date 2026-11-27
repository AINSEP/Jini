import { useCallback, useRef } from "react";
import type { ChatMessage } from "../../../../react/kit.js";

import type { UseAssistantChats } from "../../../hooks/use-assistant-chats.hooks.js";

/**
 * Whether a completed run's messages-change delta should trigger the refresh announcements, and
 * what the next `settledRunMessageId` marker should be. Pulled out of `handleMessagesChange` so the
 * "fire once per finished run, not once per streaming delta" dedup logic is directly assertable
 * without a live `ChatPane`.
 *
 * Deliberately triggered by RUN COMPLETION rather than by inspecting the transcript for a settings
 * or content tool call. Matching tool names here would put a list of them in the admin shell, where
 * it would fall out of date the first time the catalog grows — and the whole cost of being wrong is
 * a few sub-millisecond SQLite reads per run. Ignorance is cheaper than coupling.
 *
 * @param input.messages - The full transcript as of this `onMessagesChange` event.
 * @param input.settledRunMessageId - The last message id already published for, or `null`.
 * @returns `publish` (whether to announce now) and `nextSettledRunMessageId`
 *   (what the caller's ref should hold next; a live retry clears its earlier completion mark).
 * @example
 * const { publish, nextSettledRunMessageId } = shouldPublishOnMessagesChange({
 *   messages,
 *   settledRunMessageId: settledRunMessageId.current,
 * });
 */
export function shouldPublishOnMessagesChange(
  { messages, settledRunMessageId, deps }: { messages: ChatMessage[]; settledRunMessageId: string | null; deps: { isTerminalRunStatus: (required: { status: ChatMessage["runStatus"] }) => boolean } },
): { publish: boolean; nextSettledRunMessageId: string | null } {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") {
    return { publish: false, nextSettledRunMessageId: settledRunMessageId };
  }
  if (!deps.isTerminalRunStatus({ status: last.runStatus })) {
    // Retry reuses a saved assistant message's id; its next real completion must still publish.
    return { publish: false, nextSettledRunMessageId: settledRunMessageId === last.id ? null : settledRunMessageId };
  }
  if (settledRunMessageId === last.id) {
    return { publish: false, nextSettledRunMessageId: settledRunMessageId };
  }
  return { publish: true, nextSettledRunMessageId: last.id };
}

/** How far through a run's tool calls the content-refresh publisher has already announced. */
export interface ToolProgressMark {
  readonly messageId: string;
  readonly toolResultCount: number;
}

/**
 * Whether a newly-returned tool call should announce a content refresh right now, and what the
 * next {@link ToolProgressMark} the caller's ref should hold is.
 *
 * Exists because {@link shouldPublishOnMessagesChange} only fires at run completion: a run that
 * writes content and then, in the same turn, navigates to inspect the write is shown a screen that
 * fetched before the write, since nothing had been published yet. Counting `tool_result` events
 * (rather than matching a tool name) keeps the "ignorance is cheaper than coupling" property this
 * file's own doc argues for — see {@link shouldPublishOnMessagesChange}'s doc comment. The count is
 * monotonic within one RUN, but not within one message id: a retry reuses the failed message's id
 * with `events` reset, so the mark is superseded by a lower count as well as by a different id.
 *
 * @param input.messages - The full transcript as of this `onMessagesChange` event.
 * @param input.publishedToolProgress - The mark already published for, or `null`.
 * @returns `publish` (whether to announce now) and `nextPublishedToolProgress` (what the caller's
 *   ref should hold next — unchanged when `publish` is `false`, except that a retry's reset to zero
 *   results lowers the mark).
 */
export function shouldPublishContentOnToolProgress(
  { messages, publishedToolProgress }: {
    messages: ChatMessage[];
    publishedToolProgress: ToolProgressMark | null;
  },
): { publish: boolean; nextPublishedToolProgress: ToolProgressMark | null } {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") {
    return { publish: false, nextPublishedToolProgress: publishedToolProgress };
  }
  const toolResultCount = (last.events ?? []).filter((event) => event.kind === "tool_result").length;
  // A count BELOW the mark under the same id is a NEW run, not a delta already announced: retrying
  // a failed run rebuilds that assistant message in place — same `id`, `events` reset to `[]` — so
  // the retry's counts restart at 1 while the mark still holds the failed run's higher count.
  // Keyed on the id alone, every retried tool call up to that count reads as "already announced",
  // and `shouldPublishOnMessagesChange` cannot cover for it because its own `settledRunMessageId`
  // already holds the same id. Within one run `events` only ever grows, so a decrease is unambiguous.
  const mark = publishedToolProgress?.messageId === last.id ? publishedToolProgress : null;
  const alreadyPublished = mark && mark.toolResultCount <= toolResultCount ? mark.toolResultCount : 0;
  if (toolResultCount <= alreadyPublished) {
    // A retry's reset (`events: []`) must lower the mark now; otherwise its first result is
    // compared against the failed run's count and reads as already announced.
    const lowered = mark !== null && mark.toolResultCount > toolResultCount;
    return { publish: false, nextPublishedToolProgress: lowered ? { messageId: last.id, toolResultCount } : publishedToolProgress };
  }
  return { publish: true, nextPublishedToolProgress: { messageId: last.id, toolResultCount } };
}

/**
 * Builds the `onMessagesChange` callback `AssistantDock.tsx` passes to `<ChatPane>`. Pure
 * state/wiring, not I/O of its own — `chats.onMessagesChange` and `publishSettingsRefresh` are
 * already-wired dependencies (the former injected via `useChats`, the latter the same bus singleton
 * {@link useExecutionConfig} already calls directly), so this hook has nothing of its own to inject;
 * no `INFO.md` rule-3 seam.
 *
 * Owns `settledRunMessageId` internally (a `useRef`, not exposed) — last assistant message id seen
 * in a terminal state, so a run's completion fires the settings refresh below exactly once.
 * `onMessagesChange` runs on every delta of a streaming reply, and the terminal message keeps
 * arriving in later calls after it settles. A restored pane seeds these markers from its saved
 * history: hydration is not a new run completion or a newly returned tool call.
 *
 * A finished run may have written a setting — `settings_set_ui_preference` is agent-callable — so
 * the mounted settings tabs re-read. Without this the write lands in `content.db` and the open tab
 * keeps rendering the value it fetched at mount, which reads as the tool having silently done
 * nothing.
 *
 * The identical thing was true of CONTENT until 2026-08-26, just with no bus to say it on:
 * `taxonomy_create_taxonomy` is agent-callable too, and the Categories & Tags screen sitting beside
 * this dock kept listing what it fetched at mount until the operator hit Ctrl-R. So this publisher
 * now announces on `lib/content-refresh-bus` as well. It is one trigger with two announcements, not
 * a second trigger — the dedup below still fires it exactly once per finished run, and neither bus
 * carries a payload, so widening what is announced cannot widen what any subscriber can read.
 *
 * Deliberately triggered by RUN COMPLETION rather than by inspecting the transcript for a settings
 * or taxonomy tool call — see {@link shouldPublishOnMessagesChange}'s own doc for why. `undefined`
 * scope (rather than a namespace or resource list) for the same reason: this publisher does not know
 * what changed, and saying so is more honest than guessing.
 *
 * @param input.chats - The persistence callback and optional pane/history metadata, which seeds
 *   the existing publication markers on restoration.
 * @returns The memoized `onMessagesChange` callback.
 * @example
 * const handleMessagesChange = useMessagesChangeHandler({ chats });
 */
export function useMessagesChangeHandler(
  { chats, publishSettingsRefresh, publishContentRefresh, publishMessages, deps }: {
    deps: { isTerminalRunStatus: (required: { status: ChatMessage["runStatus"] }) => boolean };
    chats: Pick<UseAssistantChats, "onMessagesChange"> & Partial<Pick<UseAssistantChats, "paneKey" | "initialMessages">>;
    publishSettingsRefresh: () => void; publishContentRefresh: () => void; publishMessages: (messages: ChatMessage[]) => void;
  },
  _optional: Record<string, never> = {},
): (messages: ChatMessage[]) => void {
  const settledRunMessageId = useRef<string | null>(null);
  const publishedToolProgress = useRef<ToolProgressMark | null>(null);
  const history = useRef<{ paneKey?: UseAssistantChats["paneKey"] | undefined; initialMessages?: UseAssistantChats["initialMessages"] | undefined }>({});

  return useCallback(
    (messages: ChatMessage[]) => {
      if (history.current.paneKey !== chats.paneKey || history.current.initialMessages !== chats.initialMessages) {
        history.current = { paneKey: chats.paneKey, initialMessages: chats.initialMessages };
        const initialMessages = chats.initialMessages ?? [];
        settledRunMessageId.current = shouldPublishOnMessagesChange({ messages: initialMessages, settledRunMessageId: null, deps }).nextSettledRunMessageId;
        publishedToolProgress.current = shouldPublishContentOnToolProgress({ messages: initialMessages, publishedToolProgress: null }).nextPublishedToolProgress;
      }
      publishMessages(messages);
      // Persistence is selective, not per-delta — see `lib/assistant-chats.ts`'s
      // `persistableMessages` for why a streaming reply is written once rather than per token.
      chats.onMessagesChange({ messages });

      const { publish, nextSettledRunMessageId } = shouldPublishOnMessagesChange({
        messages,
        settledRunMessageId: settledRunMessageId.current,
        deps,
      });
      settledRunMessageId.current = nextSettledRunMessageId;

      const toolProgress = shouldPublishContentOnToolProgress({
        messages,
        publishedToolProgress: publishedToolProgress.current,
      });
      publishedToolProgress.current = toolProgress.nextPublishedToolProgress;

      // Settings stay on run completion: `settings_set_ui_preference` writes are rare, and the
      // settings tabs hold editable form state a mid-run reload would be more likely to disturb
      // than to help.
      if (publish) publishSettingsRefresh();
      // One publish per delta at most, so a terminal delta that also carries a new tool result
      // does not announce twice.
      if (publish || toolProgress.publish) publishContentRefresh();
    },
    [chats, publishSettingsRefresh, publishContentRefresh, publishMessages, deps],
  );
}

