// @vitest-environment jsdom
import { cleanup, render as rtlRender, screen, within } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminKitProvider } from "../../../../react/kit.js";
import { fakeAdminKit } from "../../../../react/testing-kit.js";
import { DockLeadingAccessory, type DockLeadingAccessoryProps } from "../DockLeadingAccessory.js";
import { FolderDropNotice } from "../FolderDropNotice.js";

/**
 * @file `DockLeadingAccessory` — what the dock mounts above the composer's textarea — rendered on
 * its own under the fake admin kit, with the kit's chat translator swapped for one that interpolates
 * `{name}` placeholders (the fake one is a pure passthrough, which would hide a wrong variable).
 * Covers each slot appearing only when it applies, the folder-drop notice picking exactly one of its
 * three shapes (`FolderDropNotice`, ui.spec.md §4), the paste hint's two wordings, and the chip
 * trays' remove and skill-only send actions.
 */

const interpolate = (key: string, vars: Record<string, string | number> = {}) =>
  key.replace(/\{(\w+)\}/g, (_match, name: string) => String(vars[name] ?? `{${name}}`));
const kit = fakeAdminKit({ chat: { useT: () => interpolate } });
/** A wrapper (not a parent element) so `rerender` keeps the kit above the re-rendered tree. */
const KitWrapper = ({ children }: { children: ReactNode }) => <AdminKitProvider kit={kit}>{children}</AdminKitProvider>;
const render = (ui: ReactElement) => rtlRender(ui, { wrapper: KitWrapper });

const HINT_WITH_BUTTON = "Browsers can't share folder paths. Use the folder button, or paste the path (Finder: ⌥⌘C, Explorer: Ctrl+Shift+C).";
const HINT_PASTE_ONLY = "Browsers can't share folder paths. Paste the path instead (Finder: ⌥⌘C, Explorer: Ctrl+Shift+C).";

function props(overrides: Partial<DockLeadingAccessoryProps> = {}): DockLeadingAccessoryProps {
  return {
    note: null,
    warning: null,
    folderDrop: { notice: null, dismiss: vi.fn(), retry: vi.fn() },
    folderWindowNoteKey: "folder-window-note",
    pluginChips: [],
    onRemovePlugin: vi.fn(),
    skills: { chips: [], removeSkill: vi.fn() },
    skillOnlySend: { canSendSkills: false, sendSkills: vi.fn() },
    ...overrides,
  };
}

afterEach(() => cleanup());

describe("DockLeadingAccessory", () => {
  it("renders nothing at all when no note, warning, notice or chip applies", () => {
    const { container } = render(<DockLeadingAccessory {...props()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the execution note and the sign-in warning as separate status lines, the warning announced politely", () => {
    render(<DockLeadingAccessory {...props({ note: "Runs on the deployed site.", warning: "Sign in to the agent first." })} />);
    const [noteLine, warningLine] = screen.getAllByRole("status");
    expect(noteLine).toHaveTextContent("Runs on the deployed site.");
    expect(noteLine).not.toHaveAttribute("aria-live");
    expect(warningLine).toHaveTextContent("Sign in to the agent first.");
    expect(warningLine).toHaveAttribute("aria-live", "polite");
  });

  it("shows the folder-window note, in the host's own dictionary key, only while a folder dialog is open elsewhere", () => {
    const { rerender } = render(<DockLeadingAccessory {...props({ folderWindowOpenElsewhere: true, folderWindowNoteKey: "A folder window opened on the host computer." })} />);
    const note = screen.getByRole("status");
    expect(note).toHaveClass("jini-folder-window-note");
    expect(note).toHaveTextContent("A folder window opened on the host computer.");

    rerender(<DockLeadingAccessory {...props({ folderWindowOpenElsewhere: false, folderWindowNoteKey: "A folder window opened on the host computer." })} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("points the paste hint at the folder button only when the composer shows one", () => {
    const folderDrop = { notice: { kind: "path-unavailable" } as const, dismiss: vi.fn(), retry: vi.fn() };
    const { rerender } = render(<DockLeadingAccessory {...props({ folderDrop, canPickFolder: true })} />);
    expect(screen.getByRole("status")).toHaveTextContent(HINT_WITH_BUTTON);

    rerender(<DockLeadingAccessory {...props({ folderDrop })} />);
    expect(screen.getByRole("status")).toHaveTextContent(HINT_PASTE_ONLY);
  });

  it("dismisses the paste hint through the folder-drop dismiss action, not retry", async () => {
    const folderDrop = { notice: { kind: "path-unavailable" } as const, dismiss: vi.fn(), retry: vi.fn() };
    render(<DockLeadingAccessory {...props({ folderDrop })} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Dismiss" }));
    expect(folderDrop.dismiss).toHaveBeenCalledTimes(1);
    expect(folderDrop.retry).not.toHaveBeenCalled();
  });

  it("lists every folder a multi-folder drop staged and names the active root in one sentence", () => {
    const folderDrop = { notice: { kind: "confirmation", path: "/w/site", paths: ["/w/site", "/w/assets", "/w/docs"], replacedPreviousPath: "/w/old" } as const, dismiss: vi.fn(), retry: vi.fn() };
    render(<DockLeadingAccessory {...props({ folderDrop })} />);
    expect(screen.getByRole("status")).toHaveTextContent("Folders added to the message: /w/site, /w/assets, /w/docs. Active file root: /w/site.");
  });

  it("uses the single-folder replacement wording when a drop staged just one folder", () => {
    const folderDrop = { notice: { kind: "confirmation", path: "/w/site", paths: ["/w/site"], replacedPreviousPath: "/w/old" } as const, dismiss: vi.fn(), retry: vi.fn() };
    render(<DockLeadingAccessory {...props({ folderDrop })} />);
    expect(screen.getByRole("status")).toHaveTextContent("The assistant can now read /w/site, replacing the previous folder.");
  });

  it("offers retry on a failed drop and routes it to the folder-drop retry action", async () => {
    const folderDrop = { notice: { kind: "error", path: "/w/missing", reason: "does-not-exist" } as const, dismiss: vi.fn(), retry: vi.fn() };
    render(<DockLeadingAccessory {...props({ folderDrop })} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry setting the working folder" }));
    expect(folderDrop.retry).toHaveBeenCalledTimes(1);
    expect(folderDrop.dismiss).not.toHaveBeenCalled();
  });

  it("removes a pinned plugin chip and a selected skill chip through their own remove actions", async () => {
    const onRemovePlugin = vi.fn();
    const skills = { chips: [{ pluginRefId: "skill-seo", label: "SEO audit" }], removeSkill: vi.fn() };
    render(<DockLeadingAccessory {...props({ pluginChips: [{ pluginRefId: "copy-editor", label: "Copy Editor" }], onRemovePlugin, skills })} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Remove Copy Editor" }));
    expect(onRemovePlugin).toHaveBeenCalledExactlyOnceWith("copy-editor");
    expect(skills.removeSkill).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Remove SEO audit" }));
    expect(skills.removeSkill).toHaveBeenCalledExactlyOnceWith("skill-seo");
    expect(onRemovePlugin).toHaveBeenCalledTimes(1);
  });

  it("offers the skill-only send button only while the skills can be sent", async () => {
    const skills = { chips: [{ pluginRefId: "skill-seo", label: "SEO audit" }], removeSkill: vi.fn() };
    const sendSkills = vi.fn();
    const { rerender } = render(<DockLeadingAccessory {...props({ skills, skillOnlySend: { canSendSkills: false, sendSkills } })} />);
    expect(screen.queryByRole("button", { name: "Send selected skills" })).toBeNull();

    rerender(<DockLeadingAccessory {...props({ skills, skillOnlySend: { canSendSkills: true, sendSkills } })} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Send selected skills" }));
    expect(sendSkills).toHaveBeenCalledTimes(1);
  });
});

describe("FolderDropNotice", () => {
  it("renders nothing when the notice slot is empty", () => {
    const { container } = render(<FolderDropNotice notice={null} onDismiss={vi.fn()} onRetry={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows exactly one notice for each shape the slot can hold", () => {
    const { rerender } = render(<FolderDropNotice notice={{ kind: "confirmation", path: "/w/site", replacedPreviousPath: null }} onDismiss={vi.fn()} onRetry={vi.fn()} />);
    const confirmation = screen.getByRole("status");
    expect(confirmation).toHaveClass("jini-folder-drop-notice--confirmation");
    expect(confirmation).toHaveTextContent("The assistant can now read /w/site.");
    expect(within(confirmation).queryByRole("button", { name: "Retry" })).toBeNull();

    rerender(<FolderDropNotice notice={{ kind: "path-unavailable" }} onDismiss={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveClass("jini-folder-drop-notice--hint");
  });
});
