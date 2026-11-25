import { useCallback, type ComponentProps, type ComponentType, type ReactNode } from "react";

import { ChatSettingsSegmented, ConversationList, type I18nAdapter, type KitConversationListProps } from "../../../react/kit.js";
import type { useConfirmRequest } from "../../../react/index.js";
import { useTaxonomyRowMenu } from "../../../screens/taxonomy/TaxonomyRowMenu.hooks.js";
import type { UseAssistantChats } from "../../hooks/use-assistant-chats.hooks.js";
import { SubagentsIndicator, type UseSubagentsIndicatorSettings } from "./SubagentsIndicator.js";
import { DockHeaderTip } from "./DockHeaderTip.js";
import { DockSettingsMenu } from "./DockSettingsMenu.js";
import { dockSettingsMenuSections, renameActiveConversation, type DockReplyLengthOptions, type DockRuntimeSwitches, type DockToolCallOptions } from "./dock-header-rules.js";
import type { ChatDisplayPreferencesController } from "./hooks/use-chat-display-preferences.hooks.js";
import type { ChatAgentPluginsController } from "./hooks/use-chat-agent-plugins.hooks.js";

type SubagentsIndicatorProps = ComponentProps<typeof SubagentsIndicator>;
type DockConversationRow = UseAssistantChats["conversations"][number];

/**
 * What a host adds to the dock's conversation switcher: the extra switcher props it binds (list-view
 * hooks, pinning, row ticking), a filter over the rows it shows (e.g. rows the host just removed),
 * and an accessory mounted beside the switcher (e.g. a bulk-tidy panel). The dock owns none of it.
 */
export interface DockConversationTools {
  readonly listProps: Pick<KitConversationListProps, "hooks" | "selectable" | "selectedIds" | "onTogglePin" | "onSelectionChange">;
  readonly visibleConversations: (required: { conversations: DockConversationRow[] }) => DockConversationRow[];
  readonly accessory: ReactNode;
}

export interface DockHeaderProps {
  /** The dock's conversation state; the switcher and the title editor drive it directly. */
  readonly chats: Pick<UseAssistantChats, "conversations" | "activeId" | "select" | "create" | "remove" | "rename">;
  /** The resolved display title (`resolveAssistantConversationTitle`), also the hover tooltip. */
  readonly activeTitle: string;
  /** The persisted execution mode and picked agent, for the subagents indicator. */
  readonly mode: SubagentsIndicatorProps["mode"];
  readonly agentId: SubagentsIndicatorProps["agentId"];
  readonly locale: string;
  /** The dock chrome's own translator (`useAssistantDockChrome().t`). */
  readonly t: (input: { key: string }, options?: Record<string, never>) => string;
  /** `@jini-ai/chat/react`'s translator, for the delete-confirmation copy. */
  readonly chatI18n: I18nAdapter;
  /** The admin confirm-dialog request the dock renders as `<ConfirmDialog>`. */
  readonly conversationDelete: Pick<ReturnType<typeof useConfirmRequest>, "confirm">;
  readonly chatDisplay: ChatDisplayPreferencesController;
  readonly agentPlugins: ChatAgentPluginsController;
  /** The gear's Reply length choice and runtime switches; switches need declared runtime support. */
  readonly runtime?: DockRuntimeSwitches & { saveFailed: boolean };
  /** Opens the advanced chat settings; absent when this admin may not open them. */
  readonly onMoreSettings: (() => void) | undefined;
  /** Whether the transcript is empty, which shows the greeting under the header row. */
  readonly empty: boolean;
  /** The host's assistant-copy translator (required: a Jini component never reaches for a host function itself). */
  /** The gear's tool-call display and reply-length choice lists (the host's `CHAT_TOOL_CALL_OPTIONS` / `REPLY_LENGTH_OPTIONS`). */
  readonly toolCallOptions: DockToolCallOptions;
  readonly replyLengthOptions: DockReplyLengthOptions;
  readonly translateAiAssistant: (input: { locale: string; key: string }) => string;
  /** The host's subagents-settings hook, handed to the indicator (required prop, never imported here). */
  readonly useSubagentsSettingsHook: UseSubagentsIndicatorSettings;
  /** The chat library's inline title editor (the kit has no slot for it), injected by the host. */
  readonly ConversationTitle: ComponentType<{ title: string | null; displayTitle: string; disabled: boolean; onRename: (title: string) => void | Promise<void> }>;
  /** Required, `null` for none: the host's switcher extras and the accessory mounted beside the switcher. */
  readonly conversationTools: DockConversationTools | null;
}

/** The conversations the switcher lists: the host's filtered view when it supplies one. */
function dockConversations(
  { chats, conversationTools }: Pick<DockHeaderProps, "chats" | "conversationTools">,
): DockHeaderProps["chats"]["conversations"] {
  return conversationTools ? conversationTools.visibleConversations({ conversations: chats.conversations }) : chats.conversations;
}

/** Whether any gear-menu preference failed to persist. */
function anySaveFailed(
  { chatDisplay, agentPlugins, runtime }: Pick<DockHeaderProps, "chatDisplay" | "agentPlugins"> & { runtime: DockHeaderProps["runtime"] | undefined },
): boolean {
  return Boolean(chatDisplay.saveFailed || agentPlugins.saveFailed || runtime?.saveFailed);
}

/** The stored title of the active conversation, or `null` when none is active. */
function activeStoredTitle({ chats }: Pick<DockHeaderProps, "chats">): string | null {
  return chats.conversations.find((chat) => chat.id === chats.activeId)?.title ?? null;
}

/**
 * The dock's replacement for `ChatPane`'s default header: title, subagents indicator, conversation
 * switcher and gear in one row, plus the empty-transcript greeting. See the `header` prop's doc in
 * `AssistantDock.tsx` for why the default header is replaced at all.
 *
 * @returns The header fragment (no wrapper node of its own beyond what it always rendered).
 * @complexity O(c) in the number of conversations (one `find` for the active title).
 */
export function DockHeader({
  chats, activeTitle, mode, agentId, locale, t, chatI18n, conversationDelete, chatDisplay, agentPlugins, runtime, onMoreSettings, empty,
  translateAiAssistant, useSubagentsSettingsHook, ConversationTitle, toolCallOptions, replyLengthOptions, conversationTools,
}: DockHeaderProps) {
  const onSelect = useCallback((id: string) => chats.select({ id }), [chats.select]);
  const onDelete = useCallback((id: string) => chats.remove({ id }), [chats.remove]);
  const onRename = useCallback((id: string, title: string) => chats.rename({ id, title }), [chats.rename]);
  return (
    <>
      <div className="jini-chat-pane__header">
        <div className="jini-chat-pane__heading">
          {/* The "Workspace chat" eyebrow was removed (owner, 2026-10-06): title, switcher and
              close now share one row so the transcript gets that height back. */}
          {/* Was an `<h1>` — the dock mounts on every route (ADR-049, one conversation for
              the whole session), so every admin screen had two `<h1>`s: its own page title
              and this one, with no signal to a screen-reader user navigating by heading which
              was the real page title. `<h2>` inside this `aria-label="Assistant"` complementary
              region (see `App.tsx`'s `<aside>`) reads correctly as a subsection heading
              instead of competing with the page's own `<h1>`. Class names, not the element
              type, drive this component's styling (`styles/assistant.css`), so the tag change
              is visually inert. */}
          <h2 className="jini-chat-pane__title" title={activeTitle} aria-label={activeTitle}>
            <ConversationTitle
              key={chats.activeId ?? 'new'}
              title={activeStoredTitle({ chats })}
              displayTitle={activeTitle}
              disabled={!chats.activeId}
              onRename={renameActiveConversation(chats)}
            />
          </h2>
        </div>
        {/* Beside the conversation switcher, not under the title (owner, 2026-10-10). */}
        <SubagentsIndicator mode={mode} agentId={agentId} useSettings={useSubagentsSettingsHook}
          t={(key) => translateAiAssistant({ locale, key })} />
        {/* Each header button gets the subagents icon's white tip, under it (owner, 2026-10-11). */}
        <DockHeaderTip label={t({ key: "Chats" })}>
          <ConversationList
            {...conversationTools?.listProps}
            conversations={dockConversations({ chats, conversationTools })}
            activeConversationId={chats.activeId}
            onSelect={onSelect}
            onCreate={chats.create}
            onDelete={onDelete}
            // Keep the permanent-delete gate, using the admin dialog's shared focus lifecycle.
            confirmDelete={(item) => conversationDelete.confirm({ dialog: {
              title: chatI18n.t("Delete conversation"),
              body: chatI18n.t('Delete "{title}"? This cannot be undone.', { title: item.title ?? chatI18n.t("Untitled") }),
              confirmLabel: chatI18n.t("Delete conversation"),
              tone: "danger",
            } })}
            onRename={onRename}
            // The white "Chats" tip above replaces the browser's dark native one, so the
            // switcher drops its own `title` and takes the same name for screen readers.
            triggerLabel={t({ key: "Chats" })}
            nativeTitle={false}
          />
        </DockHeaderTip>
        {conversationTools?.accessory}
        {/* Right of the switcher; the bar's ✕ (App.tsx) sits to its right. */}
        <DockHeaderTip label={t({ key: "Settings" })}>
          <DockSettingsMenu label={t({ key: "Settings" })} sections={dockSettingsMenuSections({ t: (key) => t({ key }), toolCallOptions, replyLengthOptions }, { display: chatDisplay, agentPlugins, runtime, onMoreSettings })}
            notice={anySaveFailed({ chatDisplay, agentPlugins, runtime }) ? t({ key: "Couldn't save. This choice lasts until you reload." }) : undefined}
            useTaxonomyRowMenuHook={useTaxonomyRowMenu} ChatSettingsSegmented={ChatSettingsSegmented} />
        </DockHeaderTip>
      </div>
      {empty ? (
        <div className="jini-assistant-empty-state" role="status">
          <p>{t({ key: "Hello! Ask me to help with your site." })}</p>
        </div>
      ) : null}
    </>
  );
}
