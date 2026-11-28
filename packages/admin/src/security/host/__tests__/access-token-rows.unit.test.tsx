// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "../../../__tests__/fetch-query-support.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AddTokenForm, TokenRow } from "../AccessTokenRows.js";
import {
  addFormState, fakeController, installDialogStandIn, providerInfo, rowState, tabBindings,
} from "./access-tokens-host-fixtures.js";

/**
 * @file `AccessTokenRows.tsx` (a saved token row and the per-provider add form) together with the
 * `AccessTokenFields.tsx` inputs they render and the per-row `RemoveConfirmDialog`. Every click and
 * keystroke is checked by the exact request it hands the injected controller.
 */

let restoreDialog: () => void;
beforeAll(() => { restoreDialog = installDialogStandIn(); });
afterAll(() => restoreDialog());

const t = (key: string) => key;

describe("TokenRow summary", () => {
  it("shows the saved name, what it works for, the save time and the token hint", () => {
    const state = rowState({ worksFor: ["host", "docs"], tokenHint: { length: 40, last4: "wxyz" } });
    render(<TokenRow bindings={tabBindings()} state={state} info={providerInfo()} controller={fakeController()} groupRowCount={1} t={t} />);
    const summary = screen.getByText("Deploy bot").closest("summary")!;
    expect(summary.textContent).toContain("Works for: host, docs · ");
    expect(within(summary).getByTestId("hint").textContent).toBe("hint wxyz");
    expect(within(summary).getByText("Replace token")).toBeInTheDocument();
    expect(screen.queryByText("Default")).toBeNull();
    expect(screen.queryByRole("button", { name: /Make default/ })).toBeNull();
  });

  it("leaves out the works-for line when the row is not attached to anything", () => {
    render(<TokenRow bindings={tabBindings()} state={rowState({ worksFor: [] })} info={providerInfo()} controller={fakeController()} groupRowCount={1} t={t} />);
    expect(screen.getByText("Deploy bot").closest("summary")!.textContent).not.toContain("Works for");
  });

  it("marks the default token once a provider has two or more saved rows", () => {
    render(<TokenRow bindings={tabBindings()} state={rowState({ isDefault: true })} info={providerInfo()} controller={fakeController()} groupRowCount={2} t={t} />);
    expect(screen.getByText("Default")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Make default/ })).toBeNull();
  });

  it("makes a non-default row the default without toggling the disclosure", () => {
    const controller = fakeController();
    const state = rowState({ isDefault: false, id: "row-2", name: "Backup bot" }, { name: "Backup bot" });
    render(<TokenRow bindings={tabBindings()} state={state} info={providerInfo()} controller={controller} groupRowCount={3} t={t} />);
    // `false` = the click's default action was cancelled: that is what stops the enclosing summary toggling.
    expect(fireEvent.click(screen.getByRole("button", { name: "Make default — Backup bot" }))).toBe(false);
    expect(controller.makeDefault).toHaveBeenCalledExactlyOnceWith(state.row);
  });
});

describe("TokenRow custom key usage", () => {
  const customInfo = providerInfo({ kind: "custom", providerId: "cus-1", label: "Example API", username: "optional" });

  it("says a site-scoped custom key is for this site only, with no attach action", () => {
    render(<TokenRow bindings={tabBindings()} state={rowState({ kind: "custom", scope: "site" })} info={customInfo} controller={fakeController()} groupRowCount={1} t={t} />);
    expect(screen.getByText("This site only")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Use on this site/ })).toBeNull();
  });

  it("lists the sites using a project key and detaches it from this site", () => {
    const controller = fakeController();
    const state = rowState({ kind: "custom", scope: "project", usedBy: ["Blog", "Shop"], usedByThisSite: true });
    render(<TokenRow bindings={tabBindings()} state={state} info={customInfo} controller={controller} groupRowCount={1} t={t} />);
    expect(screen.getByText("Blog, Shop").parentElement!.textContent).toBe("Project — used by: Blog, Shop");
    expect(fireEvent.click(screen.getByRole("button", { name: "Stop using on this site — Deploy bot" }))).toBe(false);
    expect(controller.setCustomKeyUse).toHaveBeenCalledExactlyOnceWith({ row: state.row, use: false });
    expect(screen.getByText("Access is revoked within 30 seconds.")).toBeInTheDocument();
  });

  it("offers to attach an unused project key, and replaces the edit fields with a remove-only body", () => {
    const controller = fakeController();
    // The inventory omits `usedBy` for a key no site uses yet.
    const state = rowState({ kind: "custom", scope: "project", usedByThisSite: false });
    render(<TokenRow bindings={tabBindings()} state={state} info={customInfo} controller={controller} groupRowCount={1} t={t} />);
    expect(screen.getByText("Project — not used by any site yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use on this site — Deploy bot" }));
    expect(controller.setCustomKeyUse).toHaveBeenCalledExactlyOnceWith({ row: state.row, use: true });
    expect(screen.getByText("Use on this site to replace this key.")).toBeInTheDocument();
    expect(screen.getByText("Details")).toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).toBeNull();
  });

  it("opens the remove dialog from the remove-only body of a project key this site does not use", () => {
    const state = rowState({ kind: "custom", scope: "project", usedBy: ["Blog"], usedByThisSite: false });
    render(<TokenRow bindings={tabBindings()} state={state} info={customInfo} controller={fakeController()} groupRowCount={1} t={t} />);
    const dialog = screen.getByRole("dialog", { hidden: true });
    expect(dialog).not.toHaveAttribute("open");
    fireEvent.click(screen.getByRole("button", { name: "Remove stored copy — Deploy bot" }));
    expect(dialog).toHaveAttribute("open");
  });

  it("locks the attach action while it is saving and shows its error", () => {
    const controller = fakeController({ customKeyBusy: { "row-1": { saving: true, error: "Attach failed" } } });
    const state = rowState({ kind: "custom", scope: "project", usedBy: [], usedByThisSite: false });
    render(<TokenRow bindings={tabBindings()} state={state} info={customInfo} controller={controller} groupRowCount={1} t={t} />);
    expect(screen.getByRole("button", { name: "Use on this site — Deploy bot" })).toBeDisabled();
    expect(screen.getByRole("alert").textContent).toBe("Attach failed");
  });
});

describe("TokenRow edit fields", () => {
  it("delivers each edited field to the controller as a patch for this row", () => {
    const controller = fakeController();
    const info = providerInfo({ extraFields: [{ name: "account", label: "Account ID", required: true }], username: "optional" });
    const state = rowState({ id: "row-9" }, { values: { region: "eu" }, worksFor: ["host"] });
    render(<TokenRow bindings={tabBindings()} state={state} info={info} controller={controller} groupRowCount={1} t={t} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Renamed" } });
    fireEvent.change(screen.getByLabelText("Access token"), { target: { value: "tok-a" } });
    fireEvent.change(screen.getByLabelText("Account ID"), { target: { value: "42" } });
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "ops" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Docs" }));
    expect(controller.setExistingField).toHaveBeenNthCalledWith(1, { rowId: "row-9", patch: { name: "Renamed" } });
    expect(controller.setExistingField).toHaveBeenNthCalledWith(2, { rowId: "row-9", patch: { token: "tok-a" } });
    expect(controller.setExistingField).toHaveBeenNthCalledWith(3, { rowId: "row-9", patch: { values: { region: "eu", account: "42" } } });
    expect(controller.setExistingField).toHaveBeenNthCalledWith(4, { rowId: "row-9", patch: { username: "ops" } });
    expect(controller.setExistingField).toHaveBeenNthCalledWith(5, { rowId: "row-9", patch: { worksFor: ["host", "docs"] } });
    expect(screen.getByText("Leave blank to keep the current token.")).toBeInTheDocument();
  });

  it("has no works-for choice on a source-control row", () => {
    render(<TokenRow bindings={tabBindings()} state={rowState({ kind: "source-control" })} info={providerInfo({ kind: "source-control" })} controller={fakeController()} groupRowCount={1} t={t} />);
    expect(screen.queryByRole("group", { name: "Works for" })).toBeNull();
  });

  it("warns before Save that the other sites sharing a project key switch to the new token", () => {
    const state = rowState({ kind: "custom", scope: "project", usedBy: ["This", "Blog", "Shop"], usedByThisSite: true });
    render(<TokenRow bindings={tabBindings()} state={state} info={providerInfo({ kind: "custom" })} controller={fakeController()} groupRowCount={1} t={t} />);
    expect(screen.getByText("Used by 2 other sites; they will use the new token too.")).toBeInTheDocument();
  });

  it("keeps Save off until the draft is ready, then replaces this row's token", () => {
    const controller = fakeController();
    const { rerender } = render(<TokenRow bindings={tabBindings()} state={rowState({}, { readyToSave: false })} info={providerInfo()} controller={controller} groupRowCount={1} t={t} />);
    expect(screen.getByRole("button", { name: "Save — Deploy bot" })).toBeDisabled();
    const ready = rowState({}, { readyToSave: true });
    rerender(<TokenRow bindings={tabBindings()} state={ready} info={providerInfo()} controller={controller} groupRowCount={1} t={t} />);
    fireEvent.click(screen.getByRole("button", { name: "Save — Deploy bot" }));
    expect(controller.replaceToken).toHaveBeenCalledExactlyOnceWith(ready.row);
  });

  it("names the in-flight save and shows the row's save error", () => {
    render(<TokenRow bindings={tabBindings()} state={rowState({}, { readyToSave: true, saving: true, error: "Couldn't save" })} info={providerInfo()} controller={fakeController()} groupRowCount={1} t={t} />);
    expect(screen.getByRole("button", { name: "Saving… — Deploy bot" })).toBeDisabled();
    expect(screen.getByRole("alert").textContent).toBe("Couldn't save");
  });
});

describe("RemoveConfirmDialog", () => {
  it("states the removal and where to revoke it, and notes when it is the provider's last token", () => {
    const info = providerInfo({ tokenPageUrl: "https://host.example.test/tokens" });
    render(<TokenRow bindings={tabBindings()} state={rowState()} info={info} controller={fakeController()} groupRowCount={1} t={t} />);
    const dialog = screen.getByRole("dialog", { hidden: true });
    expect(within(dialog).getByRole("heading", { hidden: true }).textContent).toBe("title(en) Deploy bot");
    expect(dialog.getAttribute("aria-labelledby")).toBe(within(dialog).getByRole("heading", { hidden: true }).id);
    expect(within(dialog).getByText("body(en) Host Pages at Host Inc")).toBeInTheDocument();
    const revoke = within(dialog).getByRole("link", { hidden: true });
    expect(revoke).toHaveAttribute("href", "https://host.example.test/tokens");
    expect(revoke.textContent).toBe("Revoke it on Host Inc ↗");
    expect(within(dialog).getByText("This is the only saved Host Pages token — after removing it, nothing here will be marked as connected.")).toBeInTheDocument();
  });

  it("has no revoke link without a token page and no last-row note when siblings remain", () => {
    render(<TokenRow bindings={tabBindings()} state={rowState()} info={providerInfo()} controller={fakeController()} groupRowCount={2} t={t} />);
    const dialog = screen.getByRole("dialog", { hidden: true });
    expect(within(dialog).queryByRole("link", { hidden: true })).toBeNull();
    expect(within(dialog).queryByText(/This is the only saved/)).toBeNull();
  });

  it("closes on Cancel without removing, and removes the row on confirm", () => {
    const controller = fakeController();
    const state = rowState();
    render(<TokenRow bindings={tabBindings()} state={state} info={providerInfo()} controller={controller} groupRowCount={2} t={t} />);
    const dialog = screen.getByRole("dialog", { hidden: true });
    fireEvent.click(screen.getByRole("button", { name: "Remove stored copy — Deploy bot" }));
    expect(dialog).toHaveAttribute("open");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(dialog).not.toHaveAttribute("open");
    expect(controller.removeToken).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remove stored copy — Deploy bot" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove stored copy" }));
    expect(dialog).not.toHaveAttribute("open");
    expect(controller.removeToken).toHaveBeenCalledExactlyOnceWith(state.row);
  });
});

describe("AddTokenForm", () => {
  const HOST_REF = { kind: "publish", providerId: "host" };

  it("delivers each field to the provider's add draft, with a works-for choice for a hosting provider", () => {
    const controller = fakeController();
    const info = providerInfo({ extraFields: [{ name: "zone", label: "Zone" }] });
    render(<AddTokenForm bindings={tabBindings()} info={info} state={addFormState({ visible: true, values: { other: "x" } })} controller={controller} t={t} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "New bot" } });
    fireEvent.change(screen.getByLabelText("Access token"), { target: { value: "tok-b" } });
    fireEvent.change(screen.getByLabelText("Zone (optional)"), { target: { value: "z1" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Host" }));
    expect(controller.setAddField).toHaveBeenNthCalledWith(1, HOST_REF, { name: "New bot" });
    expect(controller.setAddField).toHaveBeenNthCalledWith(2, HOST_REF, { token: "tok-b" });
    expect(controller.setAddField).toHaveBeenNthCalledWith(3, HOST_REF, { values: { other: "x", zone: "z1" } });
    expect(controller.setAddField).toHaveBeenNthCalledWith(4, HOST_REF, { worksFor: ["host"] });
    expect(screen.getByText("Stored encrypted.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Username")).toBeNull();
  });

  it("delivers the optional username of a custom provider and offers no works-for choice", () => {
    const controller = fakeController();
    const info = providerInfo({ kind: "custom", providerId: "cus-1", username: "optional" });
    render(<AddTokenForm bindings={tabBindings()} info={info} state={addFormState({ visible: true })} controller={controller} t={t} />);
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "me" } });
    expect(controller.setAddField).toHaveBeenCalledExactlyOnceWith({ kind: "custom", providerId: "cus-1" }, { username: "me" });
    expect(screen.queryByRole("group", { name: "Works for" })).toBeNull();
  });

  it("creates the token once the draft is ready and closes without saving on Cancel", () => {
    const controller = fakeController();
    render(<AddTokenForm bindings={tabBindings()} info={providerInfo()} state={addFormState({ visible: true, readyToSave: true })} controller={controller} t={t} />);
    fireEvent.click(screen.getByRole("button", { name: "Save — Host Pages" }));
    expect(controller.createToken).toHaveBeenCalledExactlyOnceWith(HOST_REF);
    fireEvent.click(screen.getByRole("button", { name: "Cancel adding this Host Pages token" }));
    expect(controller.closeAddForm).toHaveBeenCalledExactlyOnceWith(HOST_REF);
  });

  it("locks Save while unready or saving and shows the add error", () => {
    const { rerender } = render(<AddTokenForm bindings={tabBindings()} info={providerInfo()} state={addFormState({ visible: true })} controller={fakeController()} t={t} />);
    expect(screen.getByRole("button", { name: "Save — Host Pages" })).toBeDisabled();
    rerender(<AddTokenForm bindings={tabBindings()} info={providerInfo()} state={addFormState({ visible: true, readyToSave: true, saving: true, error: "Name taken" })} controller={fakeController()} t={t} />);
    expect(screen.getByRole("button", { name: "Saving… — Host Pages" })).toBeDisabled();
    expect(screen.getByRole("alert").textContent).toBe("Name taken");
  });
});

describe("token input fields", () => {
  it("places a host's fields declared before its token above the secret input, the rest below", () => {
    const info = providerInfo({
      tokenLabel: "Secret access key",
      publishCredential: { tokenField: "secret", fields: [{ name: "key-id", label: "Access key ID" }, { name: "secret", label: "Secret access key" }, { name: "bucket", label: "Bucket" }] },
      extraFields: [{ name: "key-id", label: "Access key ID", required: true }, { name: "bucket", label: "Bucket", required: true }, { name: "account", label: "Account", required: true }],
    } as Partial<ReturnType<typeof providerInfo>>);
    const { container } = render(<AddTokenForm bindings={tabBindings()} info={info} state={addFormState({ visible: true })} controller={fakeController()} t={t} />);
    const labels = [...container.querySelectorAll(".access-tokens-row-fields > .field > .field-label")].map((label) => label.textContent);
    expect(labels).toEqual(["Name", "Access key ID", "Secret access key", "Bucket", "Account"]);
    expect(screen.getByLabelText("Account").id).toBe("security-add-publish-host-field-account");
    expect(screen.getByText("Your account number.")).toBeInTheDocument();
    expect(container.querySelectorAll(".field-hint").length).toBe(3);
  });

  it("explains which token to create with both the guidance copy and the token-page link", () => {
    const info = providerInfo({ scopeGuidanceKey: "Grant the deploy scope.", tokenPageUrl: "https://host.example.test/new-token" });
    render(<AddTokenForm bindings={tabBindings()} info={info} state={addFormState({ visible: true })} controller={fakeController()} t={t} />);
    const guidance = screen.getByText("Which token do I need?").closest("details")!;
    expect(within(guidance).getByText(/Grant the deploy scope\./)).toBeInTheDocument();
    expect(within(guidance).getByRole("link", { name: "Create a token" })).toHaveAttribute("href", "https://host.example.test/new-token");
  });

  it("shows the guidance copy alone when there is no token page", () => {
    render(<AddTokenForm bindings={tabBindings()} info={providerInfo({ scopeGuidanceKey: "Grant the deploy scope." })} state={addFormState({ visible: true })} controller={fakeController()} t={t} />);
    const guidance = screen.getByText("Which token do I need?").closest("details")!;
    expect(guidance.querySelector("p")!.textContent).toBe("Grant the deploy scope. ");
    expect(within(guidance).queryByRole("link")).toBeNull();
  });

  it("shows only the token-page link when there is no guidance copy", () => {
    render(<AddTokenForm bindings={tabBindings()} info={providerInfo({ tokenPageUrl: "https://host.example.test/new-token" })} state={addFormState({ visible: true })} controller={fakeController()} t={t} />);
    const guidance = screen.getByText("Which token do I need?").closest("details")!;
    expect(guidance.querySelector("p")!.textContent).toBe("Create a token");
  });

  it("has no token guidance when the provider gives neither copy nor a token page", () => {
    render(<AddTokenForm bindings={tabBindings()} info={providerInfo()} state={addFormState({ visible: true })} controller={fakeController()} t={t} />);
    expect(screen.queryByText("Which token do I need?")).toBeNull();
  });

  it("keeps a saved works-for id the options no longer list as its own removable choice", () => {
    const controller = fakeController({ worksForOptions: [{ value: "host", label: "Host" }] });
    render(<TokenRow bindings={tabBindings()} state={rowState({}, { worksFor: ["retired-plugin"] })} info={providerInfo()} controller={controller} groupRowCount={1} t={t} />);
    const chips = screen.getByRole("group", { name: "chips Works for" });
    expect(within(chips).getAllByRole("checkbox").map((box) => box.parentElement!.textContent)).toEqual(["Host", "retired-plugin"]);
    fireEvent.click(within(chips).getByRole("checkbox", { name: "retired-plugin" }));
    expect(controller.setExistingField).toHaveBeenCalledExactlyOnceWith({ rowId: "row-1", patch: { worksFor: [] } });
  });
});
