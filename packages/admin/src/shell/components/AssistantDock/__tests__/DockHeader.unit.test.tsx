// @vitest-environment jsdom
import { cleanup, render as rtlRender, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminKitProvider } from "../../../../react/kit.js";
import { fakeAdminKit } from "../../../../react/testing-kit.js";
import { DockHeader, type DockConversationTools, type DockHeaderProps } from "../DockHeader.js";
import type { KitConversationListProps } from "../../../../react/kit.js";
import { CHAT_TOOL_CALL_OPTIONS, DEFAULT_CHAT_DISPLAY } from "../chat-display-preferences.js";
import { DEFAULT_ASSISTANT_RUNTIME_PREFERENCES, REPLY_LENGTH_OPTIONS } from "../assistant-runtime-preferences.js";
import { SubagentsIndicator } from "../SubagentsIndicator.js";
import { DockCleanupHeader, type DockChatCleanup } from "../DockCleanupHeader.js";

/**
 * @file `DockHeader` — the dock's replacement for `ChatPane`'s default header — rendered on its
 * own: the title heading, the empty-transcript greeting, and the gear menu's failed-save notice.
 * The conversation switcher's delete gate and the title editor are driven through the whole dock
 * in `components/__tests__/AssistantDock.unit.test.tsx` and `conversation-title-editor.unit.test.tsx`.
 */

afterEach(() => cleanup());

const kit = fakeAdminKit();
const KitWrapper = ({ children }: { children: ReactNode }) => <AdminKitProvider kit={kit}>{children}</AdminKitProvider>;
const render = (ui: ReactElement) => rtlRender(ui, { wrapper: KitWrapper });
const ConversationTitle: DockHeaderProps["ConversationTitle"] = ({ displayTitle }) => <span>{displayTitle}</span>;

const SAVE_FAILED = "Couldn't save. This choice lasts until you reload.";

function headerProps(overrides: Partial<DockHeaderProps> = {}): DockHeaderProps {
  return {
    chats: { conversations: [], activeId: null, select: vi.fn(), create: vi.fn(), remove: vi.fn(), rename: vi.fn() },
    activeTitle: "Assistant",
    mode: "local-cli",
    agentId: "claude",
    locale: "en",
    t: ({ key }) => key,
    chatI18n: { t: (key) => key, locale: "en" },
    conversationDelete: { confirm: vi.fn(async () => true) },
    chatDisplay: { preferences: DEFAULT_CHAT_DISPLAY, update: vi.fn(), saveFailed: false },
    agentPlugins: { mode: "auto", update: vi.fn(), saveFailed: false },
    onMoreSettings: undefined,
    empty: false,
    toolCallOptions: CHAT_TOOL_CALL_OPTIONS,
    replyLengthOptions: REPLY_LENGTH_OPTIONS,
    translateAiAssistant: ({ key }) => key,
    useSubagentsSettingsHook: () => ({ tooltipKey: null }),
    ConversationTitle,
    conversationTools: null,
    ...overrides,
  };
}

async function openSettingsMenu() {
  await userEvent.setup().click(screen.getByRole("button", { name: "Settings" }));
  return screen.getByRole("menu", { name: "Settings" });
}

describe("DockHeader", () => {
  it("uses the injected cleanup header without forwarding its binding fields", () => {
    const props = headerProps();
    const Header = vi.fn((_props: DockHeaderProps) => null);
    const cleanup: DockChatCleanup = { listHooks: {}, open: true, selectedIds: ["b"], select: vi.fn(),
      togglePin: vi.fn(), visibleConversations: ({ conversations }) => conversations };
    const useChatCleanup = vi.fn(() => cleanup);
    const ChatCleanupPanel = vi.fn((_props: { cleanup: DockChatCleanup; confirm: DockHeaderProps["conversationDelete"]["confirm"] }) => <p>cleanup</p>);
    render(<DockCleanupHeader {...props} DockHeader={Header} useChatCleanup={useChatCleanup} ChatCleanupPanel={ChatCleanupPanel} />);
    expect(useChatCleanup).toHaveBeenCalledExactlyOnceWith({ t: props.t, locale: props.locale, untitled: "Untitled" });
    const forwarded = Header.mock.calls[0]![0];
    expect(forwarded).not.toHaveProperty("DockHeader");
    expect(forwarded).not.toHaveProperty("useChatCleanup");
    expect(forwarded).not.toHaveProperty("ChatCleanupPanel");
    expect(forwarded).toEqual(expect.objectContaining({ activeTitle: props.activeTitle, chats: props.chats }));
    expect(forwarded.conversationTools?.listProps).toEqual({ hooks: cleanup.listHooks, onTogglePin: cleanup.togglePin,
      selectable: true, selectedIds: cleanup.selectedIds, onSelectionChange: cleanup.select });
    expect(forwarded.conversationTools?.visibleConversations).toBe(cleanup.visibleConversations);
    render(<>{forwarded.conversationTools?.accessory}</>);
    expect(screen.getByText("cleanup")).toBeTruthy();
    expect(ChatCleanupPanel.mock.calls[0]![0]).toEqual({ cleanup, confirm: props.conversationDelete.confirm });
  });

  it("names the heading after the active conversation's display title, as text and tooltip", () => {
    render(<DockHeader {...headerProps({ activeTitle: "Quarterly report" })} />);
    const heading = screen.getByRole("heading", { level: 2, name: "Quarterly report" });
    expect(heading).toHaveAttribute("title", "Quarterly report");
  });

  it("greets an empty transcript under the header row", () => {
    render(<DockHeader {...headerProps({ empty: true })} />);
    expect(screen.getByText("Hello! Ask me to help with your site.").closest(".jini-assistant-empty-state")).toHaveAttribute("role", "status");
  });

  it("shows no greeting once the transcript has messages", () => {
    render(<DockHeader {...headerProps({ empty: false })} />);
    expect(screen.queryByText("Hello! Ask me to help with your site.")).toBeNull();
  });

  it("reports a failed chat display save in the gear menu", async () => {
    render(<DockHeader {...headerProps({ chatDisplay: { preferences: DEFAULT_CHAT_DISPLAY, update: vi.fn(), saveFailed: true } })} />);
    expect(within(await openSettingsMenu()).getByRole("status")).toHaveTextContent(SAVE_FAILED);
  });

  it("reports a failed Agent plugins save in the gear menu", async () => {
    render(<DockHeader {...headerProps({ agentPlugins: { mode: "auto", update: vi.fn(), saveFailed: true } })} />);
    expect(within(await openSettingsMenu()).getByRole("status")).toHaveTextContent(SAVE_FAILED);
  });

  it("reports a failed runtime preference save in the gear menu", async () => {
    const runtime = { preferences: { ...DEFAULT_ASSISTANT_RUNTIME_PREFERENCES }, update: vi.fn(),
      visible: { preferSubagents: true, useClaudeInChrome: false, replyLength: true }, saveFailed: true };
    render(<DockHeader {...headerProps({ runtime })} />);
    expect(within(await openSettingsMenu()).getByRole("status")).toHaveTextContent(SAVE_FAILED);
  });

  it("shows no save notice in the gear menu when both choices saved", async () => {
    render(<DockHeader {...headerProps()} />);
    expect(within(await openSettingsMenu()).queryByRole("status")).toBeNull();
  });
});

describe("DockHeader conversation tools", () => {
  const conversations = [{ id: "a", title: "Alpha" }, { id: "b", title: "Beta" }] as DockHeaderProps["chats"]["conversations"];
  const chats = { conversations, activeId: "a", select: vi.fn(), create: vi.fn(), remove: vi.fn(), rename: vi.fn() };

  it("mounts the host's accessory beside the conversation switcher", () => {
    const tools: DockConversationTools = { accessory: <button type="button">Tidy chats</button>, listProps: {}, visibleConversations: ({ conversations: rows }) => rows };
    render(<DockHeader {...headerProps({ chats, conversationTools: tools })} />);
    const accessory = screen.getByRole("button", { name: "Tidy chats" });
    expect(accessory.closest(".jini-chat-pane__header")).not.toBeNull();
  });

  it("forwards the host's switcher extras and row filter to the conversation list", () => {
    const seen: KitConversationListProps[] = [];
    const listKit = fakeAdminKit({ chat: { ConversationList: (props: KitConversationListProps) => { seen.push(props); return null; } } });
    const listHooks = { useConversationListView: vi.fn() };
    const onTogglePin = vi.fn();
    const onSelectionChange = vi.fn();
    const tools: DockConversationTools = {
      accessory: null,
      listProps: { hooks: listHooks, selectable: true, selectedIds: ["b"], onTogglePin, onSelectionChange },
      visibleConversations: ({ conversations: rows }) => rows.filter((row) => row.id !== "a"),
    };
    rtlRender(<DockHeader {...headerProps({ chats, conversationTools: tools })} />, { wrapper: ({ children }) => <AdminKitProvider kit={listKit}>{children}</AdminKitProvider> });
    const props = seen.at(-1)!;
    expect(props.hooks).toBe(listHooks);
    expect(props.selectable).toBe(true);
    expect(props.selectedIds).toEqual(["b"]);
    expect(props.onTogglePin).toBe(onTogglePin);
    expect(props.onSelectionChange).toBe(onSelectionChange);
    expect(props.conversations.map((row) => row.id)).toEqual(["b"]);
  });

  it("passes no extras and every row when the host injects no tools", () => {
    const seen: KitConversationListProps[] = [];
    const listKit = fakeAdminKit({ chat: { ConversationList: (props: KitConversationListProps) => { seen.push(props); return null; } } });
    rtlRender(<DockHeader {...headerProps({ chats, conversationTools: null })} />, { wrapper: ({ children }) => <AdminKitProvider kit={listKit}>{children}</AdminKitProvider> });
    const props = seen.at(-1)!;
    expect(props.hooks).toBeUndefined();
    expect(props.selectable).toBeUndefined();
    expect(props.conversations.map((row) => row.id)).toEqual(["a", "b"]);
  });
});

describe("DockHeader subagents indicator and delete gate", () => {
  it("shows the subagents icon beside the switcher, its tip translated for the dock's locale, only when settings name a tooltip", () => {
    const useSubagentsSettingsHook = vi.fn((_required: { mode: string; agentId: string | null }) => ({ tooltipKey: "subagents.on" as string | null }));
    const translateAiAssistant = vi.fn(({ locale, key }: { locale: string; key: string }) => `${locale}:${key}`);
    const { rerender } = render(<DockHeader {...headerProps({ mode: "local-cli", agentId: "codex", locale: "fr", translateAiAssistant, useSubagentsSettingsHook })} />);

    expect(useSubagentsSettingsHook).toHaveBeenLastCalledWith({ mode: "local-cli", agentId: "codex" });
    const indicator = screen.getByRole("status");
    expect(indicator).toHaveClass("jini-chat-pane__subagents");
    expect(indicator.closest(".jini-chat-pane__header")).not.toBeNull();
    expect(within(indicator).getByTitle("fr:subagents.on")).toBeInTheDocument();
    expect(translateAiAssistant).toHaveBeenCalledWith({ locale: "fr", key: "subagents.on" });

    useSubagentsSettingsHook.mockImplementation(() => ({ tooltipKey: null }));
    rerender(<DockHeader {...headerProps({ translateAiAssistant, useSubagentsSettingsHook })} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("gates a conversation delete behind the admin's danger confirm dialog, naming the conversation", async () => {
    const seen: KitConversationListProps[] = [];
    const listKit = fakeAdminKit({ chat: { ConversationList: (props: KitConversationListProps) => { seen.push(props); return null; } } });
    const confirm = vi.fn(async () => false);
    const chatI18n = { locale: "en", t: (key: string, vars: Record<string, string | number> = {}) => `<${key.replace(/\{(\w+)\}/g, (_m, name: string) => String(vars[name]))}>` };
    rtlRender(<DockHeader {...headerProps({ chatI18n, conversationDelete: { confirm } })} />, { wrapper: ({ children }) => <AdminKitProvider kit={listKit}>{children}</AdminKitProvider> });

    const confirmDelete = seen.at(-1)!.confirmDelete!;
    await expect(confirmDelete({ id: "a", title: "Alpha" })).resolves.toBe(false);
    expect(confirm).toHaveBeenLastCalledWith({ dialog: {
      title: "<Delete conversation>",
      body: "<Delete \"Alpha\"? This cannot be undone.>",
      confirmLabel: "<Delete conversation>",
      tone: "danger",
    } });

    await confirmDelete({ id: "b", title: null });
    expect(confirm).toHaveBeenLastCalledWith({ dialog: expect.objectContaining({ body: "<Delete \"<Untitled>\"? This cannot be undone.>" }) });
  });
});

describe("SubagentsIndicator", () => {
  it("shows the settings' tooltip key untranslated when the host passes no translator", () => {
    render(<SubagentsIndicator mode="local-cli" agentId={null} useSettings={() => ({ tooltipKey: "Subagents are on" })} />);
    expect(within(screen.getByRole("status")).getByTitle("Subagents are on")).toBeInTheDocument();
  });
});
