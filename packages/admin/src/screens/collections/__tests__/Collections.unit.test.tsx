// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Collections as CollectionsScreen, type CollectionsProps } from "../Collections.js";
import { bindCollectionsRules } from "../rules.js";
import { AdminKitProvider } from "../../../react/kit.js";
import { fakeAdminKit } from "../../../react/testing-kit.js";
import type { CollectionsHostKit } from "../collections-host-kit.js";
import type { CollectionsController } from "../hooks/use-collections.hooks.js";
import type { NewContentTypeDialogController } from "../hooks/use-new-content-type-dialog.hooks.js";
import type { EditFieldsDialogController } from "../hooks/use-edit-fields-dialog.hooks.js";
import type { LifecycleConfirmDialogController } from "../hooks/use-lifecycle-confirm-dialog.hooks.js";
import type { AdminContentType } from "../api/collections-api.types.js";

/**
 * @file `Collections` — the `/admin/collections` list screen (design-spec.md §1, ADR-022/ADR-043)
 * plus its three dialogs (`NewContentTypeDialog`, `EditFieldsDialog`, `LifecycleConfirmDialog`).
 *
 * `Collections` itself is driven through the injectable `useCollectionsHook` seam (same
 * convention as `Pages.tsx`/`Recovery.tsx`). The three dialogs each declare their own `use*Hook`
 * seam too; `Collections.dialogHooks` threads the controller fakes through to each dialog,
 * reaching every dialog state without a real `fetch` or module mocks.
 */

    // Substitutes the zero-deps wrapper `NewContentTypeDialog`'s default prop points at post-
    // `useWiredX` conversion — was `useNewContentTypeDialog` (the pure, deps-taking hook) before; a
    // call-site rename of what gets intercepted, not a behavior or assertion change.
    // Substitutes the zero-port wrapper `EditFieldsDialog`'s default prop points at post-`useWiredX`
    // conversion — was `useEditFieldsDialog` (the pure, port-taking hook) before; a call-site
    // rename of what gets intercepted, not a behavior or assertion change.
const newDialogRef = { current: null as unknown };
const newDialogPropsRef = { current: null as unknown };
const editDialogRef = { current: null as unknown };
const editDialogPropsRef = { current: null as unknown };
const lifecycleDialogRef = { current: null as unknown };
const lifecycleDialogPropsRef = { current: null as unknown };

const TYPE: AdminContentType = {
  workspaceId: "w1",
  key: "recipe",
  label: "Recipe",
  fields: [
    { name: "prep_time", kind: "integer", required: true, queryable: true },
    { name: "notes", kind: "text", required: false, queryable: false },
  ],
  status: "active",
  version: 1,
};
const DEPRECATED_TYPE: AdminContentType = { ...TYPE, key: "old", label: "Old Type", status: "deprecated" };
const TOMBSTONE_TYPE: AdminContentType = { ...TYPE, key: "gone", label: "Gone Type", status: "tombstone" };

function collectionsController(overrides: Partial<CollectionsController> = {}): CollectionsController {
  return {
    types: [TYPE],
    error: null,
    showNewDialog: false,
    setShowNewDialog: vi.fn(),
    pendingLifecycle: null,
    setPendingLifecycle: vi.fn(),
    editingFieldsFor: null,
    setEditingFieldsFor: vi.fn(),
    actionError: null,
    load: vi.fn(),
    runLifecycle: vi.fn(async () => {}),
    copiedKey: null,
    copyFallback: null,
    copyEmbedCode: vi.fn(async () => {}),
    // Identity `t` + "en" locale — matches what the pre-`useWiredX` component got from a real,
    // unmocked `useAdminLocale()` call in this render-only test (defaults to `DEFAULT_LOCALE`
    // synchronously; `COLLECTIONS_DICT` has no "en" entries, so every lookup already fell through
    // to `?? key`), so every existing literal-English-string assertion below stays valid unchanged.
    t: ({ key }: { key: string }, _optional = {}) => key,
    locale: "en",
    ...overrides,
  };
}

function newDialogController(overrides: Partial<NewContentTypeDialogController> = {}): NewContentTypeDialogController {
  return {
    label: "",
    setLabel: vi.fn(),
    key: "",
    setKey: vi.fn(),
    fields: [{ _rowId: 1, name: "", kind: "text", required: false, queryable: false }],
    updateField: vi.fn(),
    removeField: vi.fn(),
    addField: vi.fn(),
    error: null,
    saving: false,
    submit: vi.fn((e: React.FormEvent) => e.preventDefault()),
    cancel: vi.fn(),
    ...overrides,
  };
}

function editDialogController(overrides: Partial<EditFieldsDialogController> = {}): EditFieldsDialogController {
  return {
    fields: [{ _rowId: 1, name: "prep_time", kind: "integer", required: true, queryable: true }],
    updateField: vi.fn(),
    removeField: vi.fn(),
    addField: vi.fn(),
    error: null,
    saving: false,
    submit: vi.fn((e: React.FormEvent) => e.preventDefault()),
    cancel: vi.fn(),
    ...overrides,
  };
}

function lifecycleDialogController(overrides: Partial<LifecycleConfirmDialogController> = {}): LifecycleConfirmDialogController {
  return {
    copy: { title: "Deprecate content type", body: "Existing entries stay readable; no new entries can be created." },
    autoFocusCancel: false,
    ...overrides,
  };
}

beforeEach(() => {
  newDialogRef.current = newDialogController();
  editDialogRef.current = editDialogController();
  lifecycleDialogRef.current = lifecycleDialogController();
  lifecycleDialogPropsRef.current = null;
});

describe('collection dialog presentation', () => {
  it.each([
    ['create', 'Create content type'], ['edit', 'Save fields'],
  ] as const)('keeps %s actions outside the scrolling field body with Cancel first', (mode, action) => {
    renderCollections(mode === 'create' ? { showNewDialog: true } : { editingFieldsFor: TYPE });
    const dialog = screen.getByRole('dialog');
    const body = dialog.querySelector('.jini-dialog-body')!;
    const footer = dialog.querySelector('.jini-dialog-footer')!;
    expect(within(body as HTMLElement).getByRole('heading', { name: 'Fields', level: 3 })).toBeInTheDocument();
    expect(within(body as HTMLElement).getByRole('checkbox', { name: 'Use for filtering and sorting' })).toBeInTheDocument();
    expect(body.contains(footer)).toBe(false);
    expect(within(footer as HTMLElement).getAllByRole('button').map(button => button.textContent)).toEqual(['Cancel', action]);
    expect(within(footer as HTMLElement).getByRole('button', { name: action })).toHaveAttribute('type', 'submit');
    expect(within(footer as HTMLElement).getByRole('button', { name: 'Cancel' })).toHaveAttribute('type', 'button');
  });
});

const TEST_KIT: CollectionsHostKit = {
  translate: ({ key }) => key,
  isApiError: (e): e is Error & { status: number } => e instanceof Error && typeof (e as { status?: unknown }).status === "number",
  describeApiError: ({ fallback }) => fallback,
  isVersionConflict: () => false,
  embedMarkerSnippet: ({ type, key, value }) => `<div data-embed-config='${JSON.stringify({ type, [key]: value })}'></div>`,
  nextDraftRowId: () => 1,
};

/** Stand-in for the host's `ServerLabel`: the status word, capitalised. */
function StatusLabel({ value }: { value: string }) {
  return <>{value.charAt(0).toUpperCase() + value.slice(1)}</>;
}

/** The screen with every required host collaborator bound to test doubles. */
function Collections(props: Pick<CollectionsProps, "useCollectionsHook"> & { dialogHooks: Pick<CollectionsProps,
  "useNewContentTypeDialogHook" | "useEditFieldsDialogHook" | "useLifecycleConfirmDialogHook"> }) {
  return (
    <AdminKitProvider kit={fakeAdminKit()}>
      <CollectionsScreen
        useCollectionsHook={props.useCollectionsHook}
        {...props.dialogHooks}
        StatusLabel={StatusLabel}
        publishButton={<button type="button">Publish collections</button>}
        contentTypeMenuItems={bindCollectionsRules({ kit: TEST_KIT }).contentTypeMenuItems}
      />
    </AdminKitProvider>
  );
}

function renderCollections(overrides: Partial<CollectionsController> = {}) {
  const c = collectionsController(overrides);
  const useCollectionsHook = () => c;
  render(<Collections useCollectionsHook={useCollectionsHook} dialogHooks={{
    useNewContentTypeDialogHook: (props) => { newDialogPropsRef.current = props; return newDialogRef.current as NewContentTypeDialogController; },
    useEditFieldsDialogHook: (props) => { editDialogPropsRef.current = props; return editDialogRef.current as EditFieldsDialogController; },
    useLifecycleConfirmDialogHook: (props) => { lifecycleDialogPropsRef.current = props; return lifecycleDialogRef.current as LifecycleConfirmDialogController; },
  }} />);
  return c;
}

describe("loading and error-before-load states", () => {
  it("shows a loading notice while types is null and there is no error", () => {
    renderCollections({ types: null, error: null });
    expect(screen.getByText("Loading content types…")).toBeInTheDocument();
  });

  it("shows only the error notice when types is still null and error is set", () => {
    renderCollections({ types: null, error: "failed to load content types" });
    expect(screen.getByText("failed to load content types")).toBeInTheDocument();
  });

  it("shows an inline banner ABOVE the table once types have loaded and a later error occurs", () => {
    renderCollections({ types: [TYPE], error: "failed to load content types" });
    expect(screen.getByText("failed to load content types")).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("shows the actionError banner separately from the load error", () => {
    renderCollections({ types: [TYPE], actionError: 'Failed to deprecate "Recipe"' });
    expect(screen.getByText('Failed to deprecate "Recipe"')).toBeInTheDocument();
  });
});

describe("empty and populated list", () => {
  it("shows the empty state when there are no content types", () => {
    renderCollections({ types: [] });
    expect(screen.getByText("No Collections yet.")).toBeInTheDocument();
  });

  it("wraps the status cell in the host stylesheet's jini-status classes", () => {
    renderCollections({ types: [TYPE, DEPRECATED_TYPE] });
    const active = screen.getByText("Active").closest("span");
    expect(active?.className).toBe("jini-status jini-status-active");
    const deprecated = screen.getByText("Deprecated").closest("span");
    expect(deprecated?.className).toBe("jini-status jini-status-deprecated");
  });

  it("renders label, key, field count, queryable count, status, and the manage-entries link", () => {
    renderCollections({ types: [TYPE] });
    expect(screen.getByText("Recipe")).toBeInTheDocument();
    expect(screen.getByText("recipe")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument(); // field count
    expect(screen.getByText("1")).toBeInTheDocument(); // queryable count
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage entries" })).toHaveAttribute("href", "/admin/collections/recipe");
  });
});

describe("Copy embed code", () => {
  it("renders a Copy embed code button per row and calls copyEmbedCode(ct) on click", async () => {
    const user = userEvent.setup();
    const c = renderCollections({ types: [TYPE] });
    await user.click(screen.getByRole("button", { name: "Copy embed code" }));
    expect(c.copyEmbedCode).toHaveBeenCalledWith(TYPE);
  });

  it("shows the snippet as selectable text on the failed row only, when the clipboard write failed", () => {
    const snippet = '<div data-embed-config=\'{"type":"collection","id":"recipe"}\'></div>';
    renderCollections({ types: [TYPE, DEPRECATED_TYPE], copyFallback: { key: "recipe", snippet } });
    expect(screen.getByText(snippet)).toBeInTheDocument();
    expect(screen.getAllByText(/data-embed-config/)).toHaveLength(1);
    expect(within(screen.getByRole("row", { name: /Recipe/ })).getByText(snippet)).toBeInTheDocument();
    expect(within(screen.getByRole("row", { name: /Old Type/ })).queryByText(snippet)).not.toBeInTheDocument();
  });

  it("shows Copied only for the row whose key matches copiedKey", () => {
    renderCollections({ types: [TYPE, DEPRECATED_TYPE], copiedKey: "recipe" });
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy embed code" })).toBeInTheDocument();
    expect(within(screen.getByRole("row", { name: /Recipe/ })).getByRole("button", { name: "Copied" })).toBeInTheDocument();
    expect(within(screen.getByRole("row", { name: /Old Type/ })).getByRole("button", { name: "Copy embed code" })).toBeInTheDocument();
  });
});

describe("New content type button", () => {
  it("clicking calls setShowNewDialog(true)", async () => {
    const user = userEvent.setup();
    const c = renderCollections();
    await user.click(screen.getByRole("button", { name: "New content type" }));
    expect(c.setShowNewDialog).toHaveBeenCalledWith(true);
  });

  it("dialog is not rendered when showNewDialog is false", () => {
    renderCollections({ showNewDialog: false });
    expect(screen.queryByRole("dialog", { name: "New content type" })).not.toBeInTheDocument();
  });
});

describe("row menu — status-driven visibility (mirrors contentTypeMenuItems)", () => {
  it("active: offers Deprecate and Tombstone, not Reactivate", async () => {
    const user = userEvent.setup();
    renderCollections({ types: [TYPE] });
    await user.click(screen.getByRole("button", { name: 'Actions for content type "Recipe"' }));
    expect(screen.getByRole("menuitem", { name: "Deprecate" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Reactivate" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
  });

  it("deprecated: offers Reactivate and Tombstone, not Deprecate", async () => {
    const user = userEvent.setup();
    renderCollections({ types: [DEPRECATED_TYPE] });
    await user.click(screen.getByRole("button", { name: 'Actions for content type "Old Type"' }));
    expect(screen.queryByRole("menuitem", { name: "Deprecate" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Reactivate" })).toBeInTheDocument();
  });

  it("tombstone: offers none of Deprecate/Reactivate/Tombstone", async () => {
    const user = userEvent.setup();
    renderCollections({ types: [TOMBSTONE_TYPE] });
    await user.click(screen.getByRole("button", { name: 'Actions for content type "Gone Type"' }));
    expect(screen.queryByRole("menuitem", { name: "Deprecate" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Reactivate" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("Edit fields calls setEditingFieldsFor with the row", async () => {
    const user = userEvent.setup();
    const c = renderCollections({ types: [TYPE] });
    await user.click(screen.getByRole("button", { name: 'Actions for content type "Recipe"' }));
    await user.click(screen.getByRole("menuitem", { name: "Edit fields" }));
    expect(c.setEditingFieldsFor).toHaveBeenCalledWith(TYPE);
  });

  it("Deprecate calls setPendingLifecycle({ op: 'deprecate', contentType }) — confirm-gated, not immediate", async () => {
    const user = userEvent.setup();
    const c = renderCollections({ types: [TYPE] });
    await user.click(screen.getByRole("button", { name: 'Actions for content type "Recipe"' }));
    await user.click(screen.getByRole("menuitem", { name: "Deprecate" }));
    expect(c.setPendingLifecycle).toHaveBeenCalledWith({ op: "deprecate", contentType: TYPE });
    expect(c.runLifecycle).not.toHaveBeenCalled();
  });

  it("Tombstone calls setPendingLifecycle({ op: 'tombstone', contentType }) — confirm-gated", async () => {
    const user = userEvent.setup();
    const c = renderCollections({ types: [TYPE] });
    await user.click(screen.getByRole("button", { name: 'Actions for content type "Recipe"' }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(c.setPendingLifecycle).toHaveBeenCalledWith({ op: "tombstone", contentType: TYPE });
    expect(c.runLifecycle).not.toHaveBeenCalled();
  });

  it("Reactivate calls runLifecycle directly — NOT confirm-gated", async () => {
    const user = userEvent.setup();
    const c = renderCollections({ types: [DEPRECATED_TYPE] });
    await user.click(screen.getByRole("button", { name: 'Actions for content type "Old Type"' }));
    await user.click(screen.getByRole("menuitem", { name: "Reactivate" }));
    expect(c.runLifecycle).toHaveBeenCalledWith(DEPRECATED_TYPE, "reactivate");
    expect(c.setPendingLifecycle).not.toHaveBeenCalled();
  });
});

describe("NewContentTypeDialog", () => {
  it("renders when showNewDialog is true, driven by the mocked hook", () => {
    renderCollections({ showNewDialog: true });
    expect(screen.getByRole("dialog", { name: "New content type" })).toBeInTheDocument();
  });

  it("renders one fieldset per draft field, with Remove field only when more than one exists", () => {
    newDialogRef.current = newDialogController({
      fields: [
        { _rowId: 1, name: "a", kind: "text", required: false, queryable: false },
        { _rowId: 2, name: "b", kind: "text", required: false, queryable: false },
      ],
    });
    renderCollections({ showNewDialog: true });
    expect(screen.getAllByText(/^Field \d$/)).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Remove field" })).toHaveLength(2);
  });

  it("omits Remove field when only one field remains", () => {
    renderCollections({ showNewDialog: true });
    expect(screen.queryByRole("button", { name: "Remove field" })).not.toBeInTheDocument();
  });

  it("typing the label calls setLabel", async () => {
    const user = userEvent.setup();
    const dlg = newDialogController();
    newDialogRef.current = dlg;
    renderCollections({ showNewDialog: true });
    await user.type(screen.getByLabelText("Label"), "x");
    expect(dlg.setLabel).toHaveBeenCalledWith("x");
  });

  it("typing the key calls setKey", async () => {
    const user = userEvent.setup();
    const dlg = newDialogController();
    newDialogRef.current = dlg;
    renderCollections({ showNewDialog: true });
    await user.type(screen.getByLabelText("Key"), "x");
    expect(dlg.setKey).toHaveBeenCalledWith("x");
  });

  it("typing a field name calls updateField with { name }", async () => {
    const user = userEvent.setup();
    const dlg = newDialogController({ fields: [{ _rowId: 1, name: "", kind: "text", required: false, queryable: false }] });
    newDialogRef.current = dlg;
    renderCollections({ showNewDialog: true });
    await user.type(screen.getByLabelText("Name"), "x");
    expect(dlg.updateField).toHaveBeenCalledWith({ rowId: 1, patch: { name: "x" } });
  });

  it("changing the Kind select calls updateField with { kind }", async () => {
    const user = userEvent.setup();
    const dlg = newDialogController({ fields: [{ _rowId: 1, name: "n", kind: "text", required: false, queryable: false }] });
    newDialogRef.current = dlg;
    renderCollections({ showNewDialog: true });
    await user.selectOptions(screen.getByLabelText("Kind"), "real");
    expect(dlg.updateField).toHaveBeenCalledWith({ rowId: 1, patch: { kind: "real" } });
  });

  it("toggling Required calls updateField with { required }", async () => {
    const user = userEvent.setup();
    const dlg = newDialogController({ fields: [{ _rowId: 1, name: "n", kind: "text", required: false, queryable: false }] });
    newDialogRef.current = dlg;
    renderCollections({ showNewDialog: true });
    await user.click(screen.getByRole("checkbox", { name: "Required" }));
    expect(dlg.updateField).toHaveBeenCalledWith({ rowId: 1, patch: { required: true } });
  });

  it("toggling Queryable calls updateField with { queryable }", async () => {
    const user = userEvent.setup();
    const dlg = newDialogController({ fields: [{ _rowId: 1, name: "n", kind: "text", required: false, queryable: false }] });
    newDialogRef.current = dlg;
    renderCollections({ showNewDialog: true });
    await user.click(screen.getByRole("checkbox", { name: "Use for filtering and sorting" }));
    expect(dlg.updateField).toHaveBeenCalledWith({ rowId: 1, patch: { queryable: true } });
  });

  it("clicking 'Remove field' (only shown when >1 field) calls removeField", async () => {
    const user = userEvent.setup();
    const dlg = newDialogController({
      fields: [
        { _rowId: 1, name: "a", kind: "text", required: false, queryable: false },
        { _rowId: 2, name: "b", kind: "text", required: false, queryable: false },
      ],
    });
    newDialogRef.current = dlg;
    renderCollections({ showNewDialog: true });
    await user.click(screen.getAllByRole("button", { name: "Remove field" })[0]!);
    expect(dlg.removeField).toHaveBeenCalledWith({ rowId: 1 });
  });

  it("clicking 'Add field' calls addField", async () => {
    const user = userEvent.setup();
    const dlg = newDialogController();
    newDialogRef.current = dlg;
    renderCollections({ showNewDialog: true });
    await user.click(screen.getByRole("button", { name: "Add field" }));
    expect(dlg.addField).toHaveBeenCalledTimes(1);
  });

  it("shows the dialog's own error", () => {
    newDialogRef.current = newDialogController({ error: "Key must start with a lowercase letter." });
    renderCollections({ showNewDialog: true });
    expect(screen.getByRole("alert")).toHaveTextContent("Key must start with a lowercase letter.");
  });

  it("disables submit and shows 'Saving…' while saving", () => {
    newDialogRef.current = newDialogController({ saving: true });
    renderCollections({ showNewDialog: true });
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  });

  it("submitting the form calls the dialog's submit handler", async () => {
    const user = userEvent.setup();
    const dlg = newDialogController();
    newDialogRef.current = dlg;
    renderCollections({ showNewDialog: true });
    await user.click(screen.getByRole("button", { name: "Create content type" }));
    expect(dlg.submit).toHaveBeenCalledTimes(1);
  });

  it("clicking Cancel calls the dialog's own cancel (H4 — routes through the in-flight guard, not the raw prop)", async () => {
    const user = userEvent.setup();
    const dlg = newDialogController();
    newDialogRef.current = dlg;
    renderCollections({ showNewDialog: true });
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(dlg.cancel).toHaveBeenCalledTimes(1);
  });



  it("Cancel is disabled while saving, so a click can't reach the dialog's cancel (H4)", async () => {
    const user = userEvent.setup();
    const dlg = newDialogController({ saving: true });
    newDialogRef.current = dlg;
    renderCollections({ showNewDialog: true });
    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    expect(cancelButton).toBeDisabled();
    await user.click(cancelButton);
    expect(dlg.cancel).not.toHaveBeenCalled();
  });

  it("onCreated closes the dialog AND reloads the list — Collections passes both through, not just one", () => {
    // `newDialogPropsRef` captures the props Collections.tsx passed to the (mocked)
    // useNewContentTypeDialog hook — invoking the real `onCreated` it wired up is how
    // `onCreated={() => { setShowNewDialog(false); load(); }}` itself gets exercised, since the
    // dialog-hook mock has no real submit flow of its own to click through.
    const c = renderCollections({ showNewDialog: true });
    (newDialogPropsRef.current as { onCreated: () => void }).onCreated();
    expect(c.setShowNewDialog).toHaveBeenCalledWith(false);
    expect(c.load).toHaveBeenCalledTimes(1);
  });

  it("onCancel closes the dialog without reloading the list", () => {
    const c = renderCollections({ showNewDialog: true });
    (newDialogPropsRef.current as { onCancel: () => void }).onCancel();
    expect(c.setShowNewDialog).toHaveBeenCalledWith(false);
    expect(c.load).not.toHaveBeenCalled();
  });
});

describe("EditFieldsDialog", () => {
  it("renders when editingFieldsFor is set, showing the content type's own label in the title", () => {
    renderCollections({ editingFieldsFor: TYPE });
    expect(screen.getByRole("heading", { name: "Edit fields — Recipe" })).toBeInTheDocument();
  });

  it("does not render when editingFieldsFor is null", () => {
    renderCollections({ editingFieldsFor: null });
    expect(screen.queryByRole("heading", { name: /Edit fields/ })).not.toBeInTheDocument();
  });

  it("clicking 'Remove field' always calls removeField, even for the only remaining field (no length guard here)", async () => {
    const user = userEvent.setup();
    const dlg = editDialogController({ fields: [{ _rowId: 1, name: "prep_time", kind: "integer", required: true, queryable: true }] });
    editDialogRef.current = dlg;
    renderCollections({ editingFieldsFor: TYPE });
    await user.click(screen.getByRole("button", { name: "Remove field" }));
    expect(dlg.removeField).toHaveBeenCalledWith({ rowId: 1 });
  });

  it("typing the field name calls updateField with { name }", async () => {
    const user = userEvent.setup();
    const dlg = editDialogController({ fields: [{ _rowId: 1, name: "", kind: "text", required: false, queryable: false }] });
    editDialogRef.current = dlg;
    renderCollections({ editingFieldsFor: TYPE });
    await user.type(screen.getByLabelText("Name"), "x");
    expect(dlg.updateField).toHaveBeenCalledWith({ rowId: 1, patch: { name: "x" } });
  });

  it("changing the Kind select calls updateField with { kind }", async () => {
    const user = userEvent.setup();
    const dlg = editDialogController({ fields: [{ _rowId: 1, name: "n", kind: "text", required: false, queryable: false }] });
    editDialogRef.current = dlg;
    renderCollections({ editingFieldsFor: TYPE });
    await user.selectOptions(screen.getByLabelText("Kind"), "boolean");
    expect(dlg.updateField).toHaveBeenCalledWith({ rowId: 1, patch: { kind: "boolean" } });
  });

  it("toggling Required calls updateField with { required }", async () => {
    const user = userEvent.setup();
    const dlg = editDialogController({ fields: [{ _rowId: 1, name: "n", kind: "text", required: false, queryable: false }] });
    editDialogRef.current = dlg;
    renderCollections({ editingFieldsFor: TYPE });
    await user.click(screen.getByRole("checkbox", { name: "Required" }));
    expect(dlg.updateField).toHaveBeenCalledWith({ rowId: 1, patch: { required: true } });
  });

  it("toggling Queryable calls updateField with { queryable }", async () => {
    const user = userEvent.setup();
    const dlg = editDialogController({ fields: [{ _rowId: 1, name: "n", kind: "text", required: false, queryable: false }] });
    editDialogRef.current = dlg;
    renderCollections({ editingFieldsFor: TYPE });
    await user.click(screen.getByRole("checkbox", { name: "Use for filtering and sorting" }));
    expect(dlg.updateField).toHaveBeenCalledWith({ rowId: 1, patch: { queryable: true } });
  });

  it("clicking 'Add field' calls addField", async () => {
    const user = userEvent.setup();
    const dlg = editDialogController();
    editDialogRef.current = dlg;
    renderCollections({ editingFieldsFor: TYPE });
    await user.click(screen.getByRole("button", { name: "Add field" }));
    expect(dlg.addField).toHaveBeenCalledTimes(1);
  });

  it("shows the dialog's own error", () => {
    editDialogRef.current = editDialogController({ error: "This content type changed since you loaded it, refresh and try again." });
    renderCollections({ editingFieldsFor: TYPE });
    expect(screen.getByRole("alert")).toHaveTextContent("refresh and try again");
  });

  it("disables submit and shows 'Saving…' while saving", () => {
    editDialogRef.current = editDialogController({ saving: true });
    renderCollections({ editingFieldsFor: TYPE });
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  });

  it("submitting calls the dialog's submit handler", async () => {
    const user = userEvent.setup();
    const dlg = editDialogController();
    editDialogRef.current = dlg;
    renderCollections({ editingFieldsFor: TYPE });
    await user.click(screen.getByRole("button", { name: "Save fields" }));
    expect(dlg.submit).toHaveBeenCalledTimes(1);
  });

  it("clicking Cancel calls the dialog's own cancel (H4 — routes through the in-flight guard, not the raw prop)", async () => {
    const user = userEvent.setup();
    const dlg = editDialogController();
    editDialogRef.current = dlg;
    renderCollections({ editingFieldsFor: TYPE });
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(dlg.cancel).toHaveBeenCalledTimes(1);
  });



  it("Cancel is disabled while saving, so a click can't reach the dialog's cancel (H4)", async () => {
    const user = userEvent.setup();
    const dlg = editDialogController({ saving: true });
    editDialogRef.current = dlg;
    renderCollections({ editingFieldsFor: TYPE });
    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    expect(cancelButton).toBeDisabled();
    await user.click(cancelButton);
    expect(dlg.cancel).not.toHaveBeenCalled();
  });

  it("onSaved closes the dialog AND reloads the list — Collections passes both through, not just one", () => {
    const c = renderCollections({ editingFieldsFor: TYPE });
    (editDialogPropsRef.current as { onSaved: () => void }).onSaved();
    expect(c.setEditingFieldsFor).toHaveBeenCalledWith(null);
    expect(c.load).toHaveBeenCalledTimes(1);
  });

  it("onCancel closes the dialog without reloading the list", () => {
    const c = renderCollections({ editingFieldsFor: TYPE });
    (editDialogPropsRef.current as { onCancel: () => void }).onCancel();
    expect(c.setEditingFieldsFor).toHaveBeenCalledWith(null);
    expect(c.load).not.toHaveBeenCalled();
  });
});

describe("LifecycleConfirmDialog", () => {
  it.each(["deprecate", "tombstone"] as const)("passes %s and a working cancel callback to the dialog hook", (op) => {
    const c = renderCollections({ pendingLifecycle: { op, contentType: TYPE } });
    const props = lifecycleDialogPropsRef.current as { op: string; onCancel: () => void };
    expect(props.op).toBe(op);
    props.onCancel();
    expect(c.setPendingLifecycle).toHaveBeenCalledExactlyOnceWith(null);
    expect(c.runLifecycle).not.toHaveBeenCalled();
  });

  it("renders when pendingLifecycle is set, using the hook's copy and the content type's label", () => {
    renderCollections({ pendingLifecycle: { op: "deprecate", contentType: TYPE } });
    expect(screen.getByRole("heading", { name: "Deprecate content type" })).toBeInTheDocument();
    expect(screen.getByText("Recipe", { selector: "strong" })).toBeInTheDocument();
  });


  it("does not render when pendingLifecycle is null", () => {
    renderCollections({ pendingLifecycle: null });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("uses jini-btn-warning for the deprecate confirm button", () => {
    renderCollections({ pendingLifecycle: { op: "deprecate", contentType: TYPE } });
    expect(screen.getByRole("button", { name: "Deprecate" })).toHaveClass("jini-btn-warning");
  });

  it("uses jini-btn-danger for the tombstone confirm button", () => {
    renderCollections({ pendingLifecycle: { op: "tombstone", contentType: TYPE } });
    expect(screen.getByRole("button", { name: "Delete" })).toHaveClass("jini-btn-danger");
  });

  it("confirming calls runLifecycle(contentType, op) then setPendingLifecycle(null)", async () => {
    const user = userEvent.setup();
    const c = renderCollections({ pendingLifecycle: { op: "deprecate", contentType: TYPE } });
    await user.click(screen.getByRole("button", { name: "Deprecate" }));
    expect(c.runLifecycle).toHaveBeenCalledWith(TYPE, "deprecate");
    expect(c.setPendingLifecycle).toHaveBeenCalledWith(null);
  });

  it("canceling calls setPendingLifecycle(null) without calling runLifecycle", async () => {
    const user = userEvent.setup();
    const c = renderCollections({ pendingLifecycle: { op: "tombstone", contentType: TYPE } });
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(c.setPendingLifecycle).toHaveBeenCalledWith(null);
    expect(c.runLifecycle).not.toHaveBeenCalled();
  });



});
