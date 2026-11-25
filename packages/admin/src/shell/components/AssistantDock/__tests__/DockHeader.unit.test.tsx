// @vitest-environment jsdom
import { cleanup, render as rtlRender, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminKitProvider } from "../../../../react/kit.js";
import { fakeAdminKit } from "../../../../react/testing-kit.js";
import { DockHeader, type DockHeaderProps } from "../DockHeader.js";
import { CHAT_TOOL_CALL_OPTIONS, DEFAULT_CHAT_DISPLAY } from "../chat-display-preferences.js";
import { REPLY_LENGTH_OPTIONS } from "../assistant-runtime-preferences.js";

/**
 * @file `DockHeader` — the dock's replacement for `ChatPane`'s default header — rendered on its
 * own: the title heading, the empty-transcript greeting, and the gear menu's failed-save notice.
 * The conversation switcher's delete gate and the title editor are driven through the whole dock
 * in the host's `components/__tests__/AssistantDock.unit.test.tsx` and `conversation-title-editor.unit.test.tsx`.
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
    ...overrides,
  };
}

async function openSettingsMenu() {
  await userEvent.setup().click(screen.getByRole("button", { name: "Settings" }));
  return screen.getByRole("menu", { name: "Settings" });
}

describe("DockHeader", () => {
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

  it("shows no save notice in the gear menu when both choices saved", async () => {
    render(<DockHeader {...headerProps()} />);
    expect(within(await openSettingsMenu()).queryByRole("status")).toBeNull();
  });
});
