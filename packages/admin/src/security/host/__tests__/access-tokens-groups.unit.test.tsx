// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "../../../__tests__/fetch-query-support.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AccessTokensTab, bindAccessTokensTab } from "../AccessTokensTab.js";
import type { AccessTokensController } from "../hooks/use-access-tokens.hooks.js";
import type { OtherCredentialsController, OtherCredentialStoreInfo } from "../hooks/use-other-credentials.hooks.js";
import {
  fakeController, fakeCopyKeys, fakeOtherController, installDialogStandIn, providerGroup, providerInfo, rowState, tabBindings,
} from "./access-tokens-host-fixtures.js";

/**
 * @file `AccessTokensTab.tsx`, the body it renders (`AccessTokensGroups.tsx`: notices, search,
 * category filter, provider groups) and the "Add custom provider" dialog (`AccessTokenDialogs.tsx`),
 * rendered from injected fake controllers with the tab's real ordering and dialog hooks.
 */

let restoreDialog: () => void;
beforeAll(() => { restoreDialog = installDialogStandIn(); });
afterAll(() => restoreDialog());

const MEDIA_STORE: OtherCredentialStoreInfo = {
  id: "media-provider", label: "Media providers", category: "ai", purposeLabel: "Media", supportsReplace: true, screenLabel: "Media", screenPath: "/media",
};

function renderTab({ controller = fakeController(), other = fakeOtherController(), copy = fakeCopyKeys(), bindings = {} }: {
  controller?: AccessTokensController; other?: OtherCredentialsController; copy?: ReturnType<typeof fakeCopyKeys>;
  bindings?: Parameters<typeof tabBindings>[0];
} = {}) {
  const built = tabBindings({
    ...bindings,
    hooks: { useAccessTokensHook: () => controller, useOtherCredentialsHook: () => other, useCopyKeysHook: () => copy, ...bindings.hooks },
  });
  return { ...render(<AccessTokensTab {...built} />), controller, other, copy, built };
}

describe("AccessTokensTab copy-keys entry", () => {
  it("is hidden by default and shown when the host enables it, opening the picker", () => {
    const first = renderTab();
    expect(screen.queryByRole("button", { name: "Use a saved key" })).toBeNull();
    first.unmount();
    const { copy } = renderTab({ bindings: { deps: { showCopyKeysEntry: true } } });
    fireEvent.click(screen.getByRole("button", { name: "Use a saved key" }));
    expect(copy.show).toHaveBeenCalledOnce();
  });

  it("lets the mount's own prop override the host default either way", () => {
    const off = tabBindings({ deps: { showCopyKeysEntry: true } });
    const { unmount } = render(<AccessTokensTab {...off} showCopyKeysEntry={false} />);
    expect(screen.queryByRole("button", { name: "Use a saved key" })).toBeNull();
    unmount();
    const on = tabBindings({ deps: { showCopyKeysEntry: false } });
    render(<AccessTokensTab {...on} showCopyKeysEntry />);
    expect(screen.getByRole("button", { name: "Use a saved key" })).toBeInTheDocument();
  });

  it("hands the copy-keys hook the access-token controller's translator and reads the other tier with its query and category", () => {
    const controller = fakeController({ query: "media", category: "ai" });
    const useCopyKeysHook = vi.fn(() => fakeCopyKeys());
    const useOtherCredentialsHook = vi.fn(() => fakeOtherController());
    renderTab({ controller, bindings: { hooks: { useCopyKeysHook, useOtherCredentialsHook } } });
    expect(useCopyKeysHook).toHaveBeenCalledWith({ t: controller.t });
    expect(useOtherCredentialsHook).toHaveBeenCalledWith({ query: "media", category: "ai" });
  });
});

describe("bindAccessTokensTab", () => {
  it("renders with the bound hooks by default and lets a mount replace each one", () => {
    const boundController = fakeController({ groups: [providerGroup(providerInfo({ label: "Bound host" }))] });
    const mountController = fakeController({ groups: [providerGroup(providerInfo({ label: "Mount host" }))] });
    const { hooks, kit, deps } = tabBindings({ hooks: { useAccessTokensHook: () => boundController } });
    const { useOtherCredentialsHook: _unbound, ...boundHooks } = hooks;
    const Bound = bindAccessTokensTab({ kit, deps, hooks: boundHooks });
    const { unmount } = render(<Bound useOtherCredentialsHook={() => fakeOtherController()} />);
    expect(screen.getByText("Bound host")).toBeInTheDocument();
    unmount();
    const useCopyKeysHook = vi.fn(() => fakeCopyKeys());
    const useAdminLocaleHook = vi.fn(() => "de");
    render(<Bound useOtherCredentialsHook={() => fakeOtherController()} useAccessTokensHook={() => mountController}
      useCopyKeysHook={useCopyKeysHook} useAdminLocaleHook={useAdminLocaleHook} showCopyKeysEntry />);
    expect(screen.getByText("Mount host")).toBeInTheDocument();
    expect(screen.queryByText("Bound host")).toBeNull();
    expect(useCopyKeysHook).toHaveBeenCalledWith({ t: mountController.t });
    expect(useAdminLocaleHook).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Use a saved key" })).toBeInTheDocument();
  });
});

describe("AccessTokensBody states", () => {
  it.each([
    ["access tokens", { groups: undefined }, {}],
    ["other credentials", {}, { groups: undefined }],
  ] as const)("shows the loading line until the %s have loaded", (_tier, controllerOver, otherOver) => {
    renderTab({ controller: fakeController(controllerOver), other: fakeOtherController(otherOver) });
    expect(screen.getByText("Loading access tokens…")).toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).toBeNull();
  });

  it("shows each tier's load error, and no empty-state line beside an error", () => {
    renderTab({ controller: fakeController({ loadError: "Tokens failed" }), other: fakeOtherController({ loadError: "Media failed" }) });
    expect(screen.getAllByRole("status").map((node) => node.textContent)).toEqual(expect.arrayContaining(["Tokens failed", "Media failed"]));
    expect(screen.queryByText("Not connected")).toBeNull();
  });

  it("says nothing is connected when both tiers are empty and there is no query", () => {
    renderTab();
    expect(screen.getByText("Not connected").closest(".empty-state")).not.toBeNull();
  });

  it("suppresses the empty-state line while a query is active", () => {
    renderTab({ controller: fakeController({ query: "zzz" }) });
    expect(screen.queryByText("Not connected")).toBeNull();
  });

  it("renders a Tier-2 store's placeholder and each configured item through the host entry", () => {
    const item = { key: "media:cloud", itemId: "cloud", store: MEDIA_STORE, name: "Cloud images", valueFact: "tail", updatedAt: null, token: "", saving: false, error: null };
    renderTab({ other: fakeOtherController({ groups: [{ store: MEDIA_STORE, rows: [item] }, { store: { ...MEDIA_STORE, id: "external-mcp", label: "MCP servers" }, rows: [] }] }) });
    expect(screen.getByText("other media-provider: Cloud images")).toBeInTheDocument();
    expect(screen.getByText("other external-mcp: none")).toBeInTheDocument();
  });
});

describe("hosting plugins hint", () => {
  const sourceGroup = providerGroup(providerInfo({ kind: "source-control", providerId: "git", label: "Git host", category: "source-control", purposeLabel: "Source control" }));

  it("points to the plugins page when no hosting provider is available", () => {
    renderTab({ controller: fakeController({ groups: [sourceGroup] }) });
    expect(screen.getByText("Enable a hosting plugin to manage its access tokens.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Plugins" })).toHaveAttribute("href", "/plugins?filter=hosting");
  });

  it("also shows under the Hosting filter", () => {
    renderTab({ controller: fakeController({ groups: [sourceGroup], category: "hosting" }) });
    expect(screen.getByRole("link", { name: "Plugins" })).toBeInTheDocument();
  });

  it.each([
    ["a query is active", { query: "git" }],
    ["another category is selected", { category: "ai" as const }],
    ["a hosting provider exists", { groups: [sourceGroup, providerGroup(providerInfo())] }],
  ])("stays hidden when %s", (_case, over) => {
    renderTab({ controller: fakeController({ groups: [sourceGroup], ...over }) });
    expect(screen.queryByRole("link", { name: "Plugins" })).toBeNull();
  });
});

describe("search and category filter", () => {
  it("sends typed text to the controller and counts both tiers together", () => {
    const accessTokensCountText = vi.fn(({ totalCount, matchCount }: { totalCount: number; matchCount: number; query: string }) => `${matchCount} of ${totalCount}`);
    const { controller } = renderTab({
      controller: fakeController({ query: "ho", totalCount: 3, matchCount: 1 }),
      other: fakeOtherController({ totalCount: 2, matchCount: 2 }),
      bindings: { deps: { accessTokensCountText } },
    });
    expect(accessTokensCountText).toHaveBeenCalledWith({ totalCount: 5, matchCount: 3, query: "ho" }, { t: controller.t });
    expect(screen.getByText("3 of 5")).toHaveAttribute("aria-live", "polite");
    fireEvent.change(screen.getByRole("searchbox", { name: "Search access tokens" }), { target: { value: "host" } });
    expect(controller.setQuery).toHaveBeenCalledExactlyOnceWith("host");
  });

  it("selects the active category tab, switches category on click and on the keyboard hook's request", () => {
    const onKeyDown = vi.fn();
    const useTabBarKeyboardHook = vi.fn((_required: { tabs: readonly unknown[]; activeId: string; onChange: (id: string) => void }) => ({ onKeyDown }));
    const { controller } = renderTab({ controller: fakeController({ category: "hosting" }), bindings: { hooks: { useTabBarKeyboardHook } } });
    const tablist = screen.getByRole("tablist", { name: "Filter by category" });
    expect(within(tablist).getAllByRole("tab").map((tab) => [tab.textContent, tab.getAttribute("aria-selected"), tab.tabIndex]))
      .toEqual([["All", "false", -1], ["Hosting", "true", 0], ["Source control", "false", -1], ["AI", "false", -1]]);
    fireEvent.click(within(tablist).getByRole("tab", { name: "AI" }));
    expect(controller.setCategory).toHaveBeenLastCalledWith("ai");
    const { activeId, onChange } = useTabBarKeyboardHook.mock.calls.at(-1)![0];
    expect(activeId).toBe("hosting");
    onChange("source-control");
    expect(controller.setCategory).toHaveBeenLastCalledWith("source-control");
    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(onKeyDown).toHaveBeenCalledOnce();
  });
});

describe("provider groups", () => {
  it("offers Connect on a provider with no saved token, opening its add form", () => {
    const { controller } = renderTab({ controller: fakeController({ groups: [providerGroup(providerInfo())] }) });
    const group = screen.getByText("Host Pages").closest("section")!;
    expect(group.querySelector(".access-tokens-provider-purpose")!.textContent).toBe(" · Hosting");
    fireEvent.click(within(group).getByRole("button", { name: "Connect Host Pages" }));
    expect(controller.openAddForm).toHaveBeenCalledExactlyOnceWith({ kind: "publish", providerId: "host" });
  });

  it("shows the open add form in place of Connect and Add another", () => {
    renderTab({ controller: fakeController({ groups: [providerGroup(providerInfo(), [rowState()], { visible: true })] }) });
    const group = screen.getByText("Host Pages").closest("section")!;
    expect(within(group).getByRole("button", { name: "Save — Host Pages" })).toBeInTheDocument();
    expect(within(group).queryByRole("button", { name: /Connect/ })).toBeNull();
    expect(within(group).queryByText("Add another")).toBeNull();
  });

  it("offers another token for a listed provider that already has one", () => {
    const { controller } = renderTab({ controller: fakeController({ groups: [providerGroup(providerInfo(), [rowState()])] }) });
    const group = screen.getByText("Host Pages", { selector: "h3 span" }).closest("section")!;
    const addAnother = within(group).getByRole("button", { name: "Add another Host Pages token" });
    fireEvent.click(addAnother);
    expect(controller.openAddForm).toHaveBeenCalledExactlyOnceWith({ kind: "publish", providerId: "host" });
    expect(within(group).queryByRole("button", { name: /Connect/ })).toBeNull();
  });

  it("explains an unlisted provider and takes no new token for it", () => {
    renderTab({ controller: fakeController({ groups: [providerGroup(providerInfo({ unlisted: true }), [rowState()])] }) });
    expect(screen.getByText("Its plugin is off or missing. You can still remove saved tokens.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add another/ })).toBeNull();
  });

  it("subtitles a custom credential and takes no second token for it", () => {
    const info = providerInfo({ kind: "custom", providerId: "cus-1", label: "Example API", purposeLabel: "General", category: "ai" });
    renderTab({ controller: fakeController({ groups: [providerGroup(info, [rowState({ kind: "custom", providerId: "cus-1", scope: "site" })])] }) });
    const group = screen.getByText("Example API", { selector: "h3 span" }).closest("section")!;
    expect(group.querySelector(".access-tokens-provider-purpose")!.textContent).toBe(" · Custom · General");
    expect(within(group).queryByRole("button", { name: /Add another/ })).toBeNull();
  });
});

describe("AddCustomCredentialDialog", () => {
  const filled = { name: "Registrar", category: "ai" as const, baseUrl: "https://api.registrar.test", additionalHosts: "", token: "tok-c", username: "", worksFor: [], saving: false, error: null };

  /** The one dialog titled by the "Add custom provider" heading (its `aria-labelledby` target). */
  function dialog(): HTMLElement {
    const title = screen.getByRole("heading", { hidden: true, name: "Add custom provider" });
    const found = document.querySelector<HTMLElement>(`dialog[aria-labelledby="${title.id}"]`);
    if (!found) throw new Error("add-custom dialog is not labelled by its heading");
    return found;
  }

  it("opens from the category row and delivers each field to the custom draft", () => {
    const { controller } = renderTab();
    expect(dialog()).not.toHaveAttribute("open");
    fireEvent.click(screen.getByRole("button", { name: "+ Add custom provider" }));
    const d = dialog();
    expect(d).toHaveAttribute("open");
    fireEvent.change(within(d).getByLabelText(/^Name/), { target: { value: "Registrar" } });
    fireEvent.change(within(d).getByLabelText(/^API base URL/), { target: { value: "https://api.registrar.test" } });
    fireEvent.change(within(d).getByLabelText("Additional hosts"), { target: { value: "https://b.registrar.test" } });
    fireEvent.change(within(d).getByLabelText(/^Access token/), { target: { value: "tok-c" } });
    fireEvent.change(within(d).getByLabelText("Username"), { target: { value: "me" } });
    fireEvent.change(within(d).getByLabelText("Category"), { target: { value: "source-control" } });
    fireEvent.click(within(d).getByRole("checkbox", { name: "Docs" }));
    expect(vi.mocked(controller.setCustomAddField).mock.calls.map(([patch]) => patch)).toEqual([
      { name: "Registrar" }, { baseUrl: "https://api.registrar.test" }, { additionalHosts: "https://b.registrar.test" },
      { token: "tok-c" }, { username: "me" }, { category: "source-control" }, { worksFor: ["docs"] },
    ]);
    expect(within(d).getAllByRole("option").map((option) => option.textContent)).toEqual(["Hosting", "Source control", "AI"]);
    expect(within(d).getByLabelText(/^API base URL/)).toHaveAttribute("placeholder", "https://api.example.test");
  });

  it("flags an invalid base URL and invalid additional hosts, and keeps Save off", () => {
    renderTab({ controller: fakeController({ customAddForm: { ...filled, baseUrl: "ftp://nope", additionalHosts: "not a url" } }) });
    fireEvent.click(screen.getByRole("button", { name: "+ Add custom provider" }));
    const d = dialog();
    expect(within(d).getByText("Enter a valid http:// or https:// URL.")).toBeInTheDocument();
    expect(within(d).getByText("Each additional host must be a valid http:// or https:// URL.")).toBeInTheDocument();
    expect(within(d).getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("says where the key is stored: this site only, or the project when shared keys are available", () => {
    const { unmount } = renderTab();
    expect(within(dialog()).getByText("This site only")).toBeInTheDocument();
    unmount();
    renderTab({ controller: fakeController({ projectKeysAvailable: true }) });
    expect(within(dialog()).getByText("Save to project and use on this site")).toBeInTheDocument();
  });

  it("saves a complete form and closes only when the save succeeded", async () => {
    const createCustomCredential = vi.fn(async () => false);
    renderTab({ controller: fakeController({ customAddForm: filled, createCustomCredential }) });
    fireEvent.click(screen.getByRole("button", { name: "+ Add custom provider" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(createCustomCredential).toHaveBeenCalledOnce());
    expect(dialog()).toHaveAttribute("open");
    createCustomCredential.mockResolvedValueOnce(true);
    fireEvent.click(within(dialog()).getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(dialog()).not.toHaveAttribute("open"));
  });

  it("names the in-flight save, shows the save error, and resets the form on Cancel", () => {
    const { controller } = renderTab({ controller: fakeController({ customAddForm: { ...filled, saving: true, error: "Name already used" } }) });
    fireEvent.click(screen.getByRole("button", { name: "+ Add custom provider" }));
    const d = dialog();
    expect(within(d).getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(within(d).getByRole("alert").textContent).toBe("Name already used");
    fireEvent.click(within(d).getByRole("button", { name: "Cancel" }));
    expect(d).not.toHaveAttribute("open");
    expect(controller.resetCustomAddForm).toHaveBeenCalledOnce();
  });
});

