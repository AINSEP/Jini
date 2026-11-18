import { fireEvent, render, screen } from "../../../__tests__/fetch-query-support.js";
import { describe, expect, it, vi } from "vitest";
import type { ReactElement, MutableRefObject } from "react";

import { FormsTestProvider } from "./harness.js";
import { fieldSettingsFor, settingsFormFromField } from "../../field-settings.js";
import type { AdminFormDefinition, AdminFormField } from "../../models.js";
import type { FieldAttributesDialogController } from "../hooks/use-field-attributes-dialog.hooks.js";
import type { FormFieldsEditorController } from "../hooks/use-form-fields-editor.hooks.js";
import type { useWiredFormSubmissionDetail } from "../hooks/use-form-submission-detail.hooks.js";
import type { useWiredFormsList } from "../hooks/use-forms-list.hooks.js";
import type { FormSubmissionsController } from "../hooks/use-form-submissions.hooks.js";
import type { useFieldAttributesView, useFieldSettingsView, useFormFieldsBodyView, useFormFieldsView, useFormsListView, useFormTabStripView, useSubmissionsView } from "../hooks/forms-view.hooks.js";
import { FieldAttributesDialog } from "../components/FieldAttributesDialog.js";
import { FieldSettingsSection } from "../components/FieldSettingsSection.js";
import { FormEditorFieldsBody } from "../components/FormEditorFieldsBody.js";
import { FormEditorTabStrip } from "../components/FormEditorTabStrip.js";
import { FormFieldsEditor } from "../components/FormFieldsEditor.js";
import { FormSubmissionDetail } from "../components/FormSubmissionDetail.js";
import { FormSubmissions } from "../components/FormSubmissions.js";
import { FormsList } from "../pages/FormsList.js";

/**
 * @file One fake-hook output test per forms component that takes a view hook as a prop (hook-injection
 * rule). Each fake returns fixed values that the real hook could never produce, so the rendered
 * text proves the injected hook, not the real one, fed the markup; a handler fake proves the event
 * reached the injected hook's callback. The `jini-` class-prefix rule applies when a component moves,
 * so it is not asserted here.
 */

const t = (key: string) => key;
const field = (extra: Partial<AdminFormField> = {}): AdminFormField => ({ id: "real-id", label: "Real label", type: "text", required: false, ...extra }) as AdminFormField;
const wrap = (node: ReactElement) => render(<FormsTestProvider>{node}</FormsTestProvider>);

const dialogController = (): FieldAttributesDialogController => ({
  className: "FAKE-CLASS", setClassName: vi.fn(), rows: [], updateRow: vi.fn(), removeRow: vi.fn(), addRow: vi.fn(),
  settings: settingsFormFromField({ field: field() }), setSettings: vi.fn(), toggleDefaultChoice: vi.fn(), toggleAccept: vi.fn(),
  updateOption: vi.fn(), addOption: vi.fn(), removeOption: vi.fn(), moveOption: vi.fn(), error: null, submit: vi.fn(),
});

describe("forms components render from their injected view hooks", () => {
  it("FormEditorTabStrip renders only the one tab the fake hook returns", () => {
    const onClick = vi.fn();
    const useFormTabStripViewHook = vi.fn<typeof useFormTabStripView>(() => [{ id: "fields", label: "Fields", ref: vi.fn(), onClick }]);
    const tabRefs: MutableRefObject<Array<HTMLButtonElement | null>> = { current: [] };
    render(<FormEditorTabStrip showTabs tab="fields" onTabChange={vi.fn()} tabRefs={tabRefs} onTabsKeyDown={vi.fn()} t={t} useFormTabStripViewHook={useFormTabStripViewHook} />);
    fireEvent.click(screen.getByRole("tab", { name: "Fields" }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.queryByRole("tab", { name: "Submissions" })).toBeNull();
    expect(tabRefs.current).toEqual([]);
  });

  it("FieldSettingsSection renders values and handlers from the fake view", () => {
    const f = field();
    const controller = dialogController();
    const onPlaceholder = vi.fn();
    const view = {
      settings: fieldSettingsFor({ type: "text" }), form: { ...settingsFormFromField({ field: f }), placeholder: "FAKE-PLACEHOLDER" }, boundsType: "number" as const,
      boundsClass: "field-settings-num", defaultInputType: "text" as const, defaultClass: undefined, onPlaceholder, onHelpText: vi.fn(), onDefaultText: vi.fn(),
      onMinLength: vi.fn(), onMaxLength: vi.fn(), onPattern: vi.fn(), onMin: vi.fn(), onMax: vi.fn(), onStep: vi.fn(), onMaxFileSize: vi.fn(),
      onDefaultChecked: vi.fn(), onDefaultChoice: vi.fn(), addOption: vi.fn(), defaultChoices: [], options: [], uploads: [],
    } satisfies ReturnType<typeof useFieldSettingsView>;
    const hook = vi.fn<typeof useFieldSettingsView>(() => view);
    const { container } = render(<FieldSettingsSection field={f} controller={controller} t={t} useFieldSettingsViewHook={hook} />);
    const input = container.querySelector<HTMLInputElement>("#field-settings-placeholder");
    expect(input?.value).toBe("FAKE-PLACEHOLDER");
    fireEvent.change(input!, { target: { value: "typed" } });
    expect(onPlaceholder).toHaveBeenCalledOnce();
    expect(controller.setSettings).not.toHaveBeenCalled();
  });

  it("FormEditorFieldsBody wires the name input to the fake hook's handler", () => {
    const onName = vi.fn();
    const hook = vi.fn<typeof useFormFieldsBodyView>(() => ({ onName, onSlug: vi.fn(), onHtml: vi.fn(), onBuilder: vi.fn(), onHtmlMode: vi.fn() }));
    const onNameChange = vi.fn();
    wrap(
      <FormEditorFieldsBody name="N" onNameChange={onNameChange} slug="s" onSlugChange={vi.fn()} isNew fields={[]} existingFieldIds={[]} onFieldsChange={vi.fn()}
        form={null} saving={false} onStatusToggle={vi.fn()} onSave={vi.fn()} t={t} mode="builder" onModeChange={vi.fn()} html="" onHtmlChange={vi.fn()}
        onCopyEmbed={vi.fn()} copyFeedback={null} useFormFieldsBodyViewHook={hook} />,
    );
    fireEvent.change(screen.getByDisplayValue("N"), { target: { value: "x" } });
    expect(onName).toHaveBeenCalledOnce();
    expect(onNameChange).not.toHaveBeenCalled();
  });

  it("FormFieldsEditor renders the rows the fake view returns", () => {
    const f = field({ id: "FAKE-ID" });
    const hook = vi.fn<typeof useFormFieldsView>(() => ({
      editingField: null, saveAttributes: vi.fn(),
      rows: [{ field: f, index: 0, base: "fake-base", isExisting: false, displayName: "FAKE name", typeGroups: [], hasLength: false,
        onId: vi.fn(), onLabel: vi.fn(), onType: vi.fn(), onRequired: vi.fn(), onMaxLength: vi.fn(), ref: vi.fn(), onAttributes: vi.fn(), onRemove: vi.fn() }],
    }));
    const controller: FormFieldsEditorController = {
      editingAttrsIndex: null, openAttrsDialog: vi.fn(), closeAttrsDialog: vi.fn(), kebabRefs: { current: [] },
      updateField: vi.fn(), replaceField: vi.fn(), addField: vi.fn(), removeField: vi.fn(),
    };
    wrap(<FormFieldsEditor fields={[f]} onChange={vi.fn()} t={t} useFormFieldsEditorHook={() => controller} useFormFieldsViewHook={hook} />);
    expect(screen.getByLabelText("Field 1 id")).toHaveProperty("value", "FAKE-ID");
    expect(hook).toHaveBeenCalledOnce();
  });

  it("FieldAttributesDialog titles itself from the fake view", () => {
    const onClose = vi.fn();
    const hook = vi.fn<typeof useFieldAttributesView>(() => ({ displayName: "FAKE display", onClose, hasStyling: false, onClassName: vi.fn(), rows: [] }));
    wrap(<FieldAttributesDialog field={field()} fieldIndex={0} onSave={vi.fn()} onCancel={vi.fn()} t={t} useFieldAttributesDialogHook={dialogController} useFieldAttributesViewHook={hook} />);
    expect(screen.getByText("Field settings — FAKE display")).toBeTruthy();
    expect(hook).toHaveBeenCalledOnce();
  });

  it("FormSubmissions renders rows and the date from the fake hooks", () => {
    const view = vi.fn<typeof useSubmissionsView>(() => ({ back: vi.fn(), loadMore: vi.fn(), rows: [{ id: "s1", formDefinitionId: "f", data: {}, sourceIp: "FAKE-IP", submittedAt: "x", handle: "fake-handle", view: vi.fn() }] }));
    const date = vi.fn(() => ({ text: "FAKE-DATE", full: "full", dateTime: undefined }));
    const controller: FormSubmissionsController = { submissions: [{ id: "real", formDefinitionId: "f", data: {}, sourceIp: "REAL-IP", submittedAt: "x" }], nextCursor: null, error: null, selectedId: null, setSelectedId: vi.fn(), load: vi.fn(), loadingMore: false };
    wrap(<FormSubmissions formId="f" t={t} useFormSubmissionsHook={() => controller} useFormSubmissionDateHook={() => date} useSubmissionsViewHook={view} />);
    expect(screen.getByText("FAKE-IP")).toBeTruthy();
    expect(screen.queryByText("REAL-IP")).toBeNull();
    expect(screen.getByText("FAKE-DATE")).toBeTruthy();
  });

  it("FormSubmissionDetail formats the date with the fake hook", () => {
    const date = vi.fn(() => ({ text: "FAKE-DATE", full: "full", dateTime: undefined }));
    const detail: ReturnType<typeof useWiredFormSubmissionDetail> = { submission: { id: "s", formDefinitionId: "f", data: {}, sourceIp: "1.2.3.4", submittedAt: "x" }, error: null, confirmOpen: false, deleting: false,
      requestDelete: vi.fn(), cancelDelete: vi.fn(), confirmDelete: vi.fn(), fileUrl: () => null };
    wrap(<FormSubmissionDetail formId="f" submissionId="s" onBack={vi.fn()} onDeleted={vi.fn()} t={t}
      useFormSubmissionDetailHook={() => detail}
      useFormSubmissionDateHook={() => date} />);
    expect(screen.getByText("FAKE-DATE")).toBeTruthy();
    expect(date).toHaveBeenCalled();
  });

  it("FormsList renders the rows and the header slot from the fake hooks", () => {
    const form: AdminFormDefinition = {
      id: "f1", workspaceId: "workspace-local", slug: "fake-slug", name: "FAKE form", fields: [], notify: { enabled: false, recipients: [] },
      status: "active", createdAt: "2026-07-01T09:00:00.000Z", updatedAt: "2026-07-01T09:00:00.000Z",
    };
    const listHook = (): ReturnType<typeof useWiredFormsList> => ({ forms: [form], formatFormDates: () => [], error: null, rowSavingId: null, toggleStatus: vi.fn(), pendingDelete: null, setPendingDelete: vi.fn(), removeForm: vi.fn(), t });
    const viewHook = vi.fn<typeof useFormsListView>(() => ({
      rows: [{ ...form, rowHandle: "fake-row", dates: [], menuLabel: "FAKE menu", menuItems: [] }], cancelDelete: vi.fn(), headerActions: <span>FAKE-HEADER</span>,
    }));
    wrap(<FormsList useFormsListHook={listHook} useFormsListViewHook={viewHook} />);
    expect(screen.getByText("FAKE-HEADER")).toBeTruthy();
    expect(screen.getByText("FAKE form")).toBeTruthy();
  });
});
