import type { ComponentProps, ComponentType, ReactNode } from "react";
import type { KitChatPaneProps } from "../../../react/kit.js";

import type { UseNativeFolderPicker } from "../../../screens/fs-files/use-native-folder-picker.hooks.js";
import type { FolderPathButton } from "./FolderPathButton.js";

/**
 * @file Pure prop builders `AssistantDock.tsx` hands to `ChatPane` and its header. Each one is a
 * decision the dock used to make inline in its JSX; living here they are testable on every branch
 * without rendering the whole dock.
 */

type ChatPaneProps = KitChatPaneProps;

export interface OptionalChatPanePropsInput {
  /** The picker's agent list (placeholder while `listAgents` is in flight); absent when unknown. */
  readonly agents: ChatPaneProps["agents"];
  /** The active conversation's id; `null` before the first conversation exists. */
  readonly conversationId: string | null;
  /** `useConversationRefreshSignal`'s signal; absent without an active conversation. */
  readonly refreshSignal: ChatPaneProps["refreshSignal"];
  /** Recent prompt recall is local to this signed-in admin, including in a new chat. */
  readonly composerHistoryScope: string | undefined;
}

/**
 * The `ChatPane` props the dock passes only when they hold a value: an empty one is omitted
 * entirely rather than passed as `undefined`/`null`, so the pane keeps its own default.
 *
 * @param input The four optional values; each is passed on only when truthy.
 * @returns An object with exactly the keys whose values are truthy.
 * @complexity O(1).
 */
export function optionalChatPaneProps(input: OptionalChatPanePropsInput, _optional = {}) {
  return {
    ...(input.agents ? { agents: input.agents } : {}),
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    ...(input.refreshSignal ? { refreshSignal: input.refreshSignal } : {}),
    ...(input.composerHistoryScope ? { composerHistoryScope: input.composerHistoryScope } : {}),
  };
}

export interface ExecutionChatPanePropsInput {
  /** The persisted execution mode; `"byok"` is the only one that routes a turn to the API. */
  readonly mode: string;
  /** The subagent settings' native-tool policy; absent until those settings load cleanly. */
  readonly nativeToolPolicy: ChatPaneProps["nativeToolPolicy"] | undefined;
}

/**
 * The picker's execution-mode row props: `executionMode` mirrors the branch
 * `assistant-transport.ts`'s `startRun` takes on the same `executionConfig.mode`, and
 * `nativeToolPolicy` is passed only once it holds a value, so the pane keeps its own default.
 *
 * @param input The execution mode and the optional native-tool policy.
 * @returns `executionMode` (`"api"` for BYOK, `"local"` otherwise), plus `nativeToolPolicy` when set.
 * @complexity O(1).
 */
export function executionChatPaneProps(input: ExecutionChatPanePropsInput, _optional = {}) {
  return {
    executionMode: input.mode === "byok" ? ("api" as const) : ("local" as const),
    ...(input.nativeToolPolicy ? { nativeToolPolicy: input.nativeToolPolicy } : {}),
  };
}

/**
 * The composer footer's push-to-talk slot. When voice input is switched off the slot is empty —
 * owner, 2026-10-30 ~5 PM: "just hide it", reversing the same day's grayed placeholder
 * (`VoiceInputPlaceholder`, kept for later). See the `footerLeadingAccessory` comment in
 * `AssistantDock.tsx` and `voice-input-config.ts`.
 *
 * @param input.enabled `VOICE_INPUT_ENABLED` at the call site.
 * @param input.onTranscript Where a finished transcript is appended (`useComposerVoiceInput`).
 * @returns The mic button, or `undefined` (no mic) when voice input is off.
 * @complexity O(1).
 */
export function voiceFooterAccessory(input: { readonly enabled: boolean; readonly onTranscript: (text: string) => void; kit: { PushToTalkMicButton: ComponentType<{ onTranscript: (text: string) => void }> } }, _optional = {}) {
  const { PushToTalkMicButton } = input.kit;
  return input.enabled ? <PushToTalkMicButton onTranscript={input.onTranscript} /> : undefined;
}

/**
 * Everything in the composer footer's `footerLeadingAccessory` slot, right after "+": the folder
 * button (only once the server confirmed it can open a folder dialog here), then the mic. `undefined`
 * when none shows, so the slot is omitted rather than rendered empty.
 *
 * @param input.folderPicker `useNativeFolderPicker`'s result.
 * @param input.voice `voiceFooterAccessory`'s result.
 * @complexity O(1).
 */
export function composerFooterLeading(input: { readonly folderPicker: UseNativeFolderPicker; readonly voice: ReactNode | undefined; kit: { FolderPathButton: ComponentType<ComponentProps<typeof FolderPathButton>>; chat: { useT: ComponentProps<typeof FolderPathButton>["useTHook"] } } }, _optional = {}) {
  const { FolderPathButton, chat: { useT } } = input.kit;
  if (!input.folderPicker.available) return input.voice;
  return (
    <>
      <FolderPathButton picking={input.folderPicker.picking} onPick={input.folderPicker.pickFolder} useTHook={useT} />
      {input.voice}
    </>
  );
}

/**
 * Whether the dock says "Folder window opened on the computer running the host" (owner bug 11-01): from a
 * browser tab the folder dialog opens on that computer, which may not be in front of the owner; the
 * desktop app's dialog opens in front of its own window. Shown only while the dialog is open.
 *
 * @param input.picking `useNativeFolderPicker`'s `picking`.
 * @param options.desktop Whether this is the desktop app (`isDesktopAdmin`).
 * @complexity O(1).
 */
export function folderWindowOpenElsewhere(
  { picking, deps }: { readonly picking: boolean; deps: { isDesktopAdmin: (required: {}) => boolean } },
  { desktop = deps.isDesktopAdmin({}) }: { readonly desktop?: boolean } = {},
) {
  return picking && !desktop;
}
