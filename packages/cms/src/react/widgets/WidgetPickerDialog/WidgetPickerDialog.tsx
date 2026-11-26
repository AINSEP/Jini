import type { ComponentType, ReactNode } from "react";
import { agentHandle, type AgentElementRole } from "@jini-ai/core/agent-handles";
import type { WidgetTypeKey as AdminWidgetType } from "../../../widgets/types.js";
import type { useWidgetAddControl, useWidgetPickerDialog } from "./WidgetPickerDialog.hooks.js";
import { interpolate, type Translate } from "@jini-ai/core/text";

type AdminWidget = NonNullable<ReturnType<typeof useWidgetPickerDialog>["instances"]>[number];
type SelectOption = { value: string; label: string };

/**
 * @file `WidgetPickerDialog` (`ui.spec.md` §2/§3.9/§4.8) — REQ-33's explicit reuse-vs-duplicate
 * modal. Two call sites: `RegionPlacementList.onAddWidgetRequest` and `WidgetEmbedNode`'s toolbar
 * insertion trigger (`widget-embed-extension.tsx`) — no third call site is authorized by the spec.
 *
 * Reuses Jini's native dialog owner, like `Collections.tsx`; no second focus trap, global
 * Escape listener or backdrop lifecycle is needed.
 *
 * `ui.spec.md` §5's rendering rule (followed literally per its own §8 disclosure against ADR-047
 * Amendment 5's "default to reuse" prose): when `existingInstances.length > 0`, BOTH "use existing"
 * and "create new" render as explicit, equally-weighted options with no pre-selected default —
 * implemented here as two always-visible sections, not tabs defaulting to one or the other.
 *
 * Split into this file (props + JSX for both `WidgetPickerDialog` and `WidgetAddControl`) and
 * `WidgetPickerDialog.hooks.tsx` (their state, effects, and the `useExistingInstances` fetch both
 * lean on), per the `@jini-ai/admin` `<Name>.tsx`/`<Name>.hooks.tsx` extraction pattern
 * (`ConfirmDialog.tsx`/`ConfirmDialog.hooks.tsx` in that package). Both components below carry the
 * same kind of injectable seam `ConfirmDialog`'s `useDialog` prop is (`useDialog` here, and
 * `useAddControl` on `WidgetAddControl`) — each does real IO (`useExistingInstances`'s fetch,
 * `useWidgetAddControl`'s `api.createWidget`) or DOM work (the deferred autofocus
 * effect), so a test can swap either for a fake without touching the network.
 *
 * ## Agent handles
 *
 * Given `agentHandle="place-widget"` this publishes:
 *
 * | element | handle | role |
 * |---|---|---|
 * | the "use existing" select (when shown) | `place-widget-existing-select` | via `Select`'s own scheme |
 * | the "Use this widget" submit | `place-widget-existing-submit` | `button` |
 * | the new-title field | `place-widget-new-title` | `field` |
 * | the config sub-form | `place-widget-new-config` | via `WidgetConfigFields`'s own scheme |
 * | the "Create and place" submit | `place-widget-new-submit` | `button` |
 * | the Cancel button | `place-widget-cancel` | `button` |
 *
 * Omit `agentHandle` and host controls receive no handles; shared Select and dialog controls
 * retain their own automatic handles.
 */

/** `{...(base ? agentHandle(\`${base}-<suffix>\`, opts) : {})}` as a named helper — same
 *  complexity-budget rationale as `Select.tsx`'s `resolveSelectTriggerHandleProps`: this dialog
 *  spreads a conditional agent-handle six times, and each was its own branch in
 *  `WidgetPickerDialog`'s own cyclomatic count. `{}` (no markup) when `base` is unset, same as
 *  every inline occurrence it replaces. */
function handleSpread({ base, suffix, opts }: { base: string | undefined; suffix: string; opts: { role: AgentElementRole; label: string } }, _options: Record<string, never> = {}): Record<string, unknown> {
  return base ? agentHandle({ handle: `${base}-${suffix}` }, opts) : {};
}

/** `base ? \`${base}-<suffix>\` : undefined` as a named helper — the sub-handle string handed to a
 *  composed component (`Select`/`WidgetConfigFields`) rather than spread as `data-agent-*`
 *  attributes directly. Same rationale as {@link handleSpread}. */
function subHandle({ base, suffix }: { base: string | undefined; suffix: string }, _options: Record<string, never> = {}): string | undefined {
  return base ? `${base}-${suffix}` : undefined;
}

/** The existing-instance `Select`'s options as a named helper — the map's shape conversion, out
 *  of `WidgetPickerDialog`'s own scope: one `SelectOption` per loaded instance. It used to take
 *  `instances ?? []`; its only caller renders after `hasExisting`, so it now takes the loaded list. */
function toExistingOptions(instances: readonly AdminWidget[]): SelectOption[] {
  return instances.map((instance) => ({ value: instance.id, label: instance.title }));
}

export interface WidgetPickerDialogProps {
  widgetType: AdminWidgetType;
  onUseExisting: (widgetInstanceId: string) => void;
  onCreateNew: (title: string, config: Record<string, unknown>) => void;
  onCancel: () => void;
  /** Injectable seam for the dialog's fetch/form/Escape-listener/autofocus state. Defaults to the
   *  real {@link useWiredWidgetPickerDialog}; a test can pass a fake here to exercise this
   *  component's rendering without the real `listWidgets` fetch or `document`-level Escape
   *  listener. */
  useDialog: (props: Pick<WidgetPickerDialogProps, "widgetType" | "onUseExisting" | "onCreateNew" | "onCancel">) => ReturnType<typeof useWidgetPickerDialog>;
  kit: {
    Dialog: ComponentType<{ open: boolean; title: string; onClose: () => void; className: string; children?: ReactNode }>;
    Select: ComponentType<{ id?: string; value: string; onChange: (value: string) => void; options: readonly SelectOption[]; placeholder?: string; "aria-label"?: string; agentHandle?: string | undefined; t: Translate }>;
    WidgetConfigFields: ComponentType<{ widgetType: AdminWidgetType; config: Record<string, unknown>; onChange: (config: Record<string, unknown>) => void; agentHandle?: string | undefined; t: Translate }>;
  };
  deps: Pick<Parameters<typeof useWidgetPickerDialog>[0]["deps"], "WIDGET_TYPE_OPTIONS" | "widgetTypeLabel" | "translateWidgets">;
  /** This dialog's own base handle — see this file's "Agent handles" doc for the full scheme. Omit
   *  to leave it untagged. */
  agentHandle?: string | undefined;
  /** Embed the same forms in a parent native dialog, without a nested modal lifecycle. */
  presentation?: "dialog" | "inline";
}

export function WidgetPickerDialog({ useDialog, agentHandle: base, ...props }: WidgetPickerDialogProps, _optional = {}) {
  const { Dialog } = props.kit;
  const {
    instances, loadError, selectedExistingId, setSelectedExistingId, newTitle, setNewTitle, newConfig, setNewConfig, error, existingSelectId, newTitleInputId,
    newTitleInputRef, typeLabel, hasExisting, submitUseExisting, submitCreateNew, t,
  } = useDialog(props);
  // Native modality keeps Tab inside; Jini also restores the opener when this dialog unmounts.
  if (hasExisting && !instances) throw new Error("widget picker has existing widgets but no instances");

  const content = (
    <>
        <div className="widget-picker-body">
          {loadError ? <div className="notice error">{loadError}</div> : null}
          {error ? (
            <span className="save-error" role="alert">
              {error}
            </span>
          ) : null}

          {hasExisting && instances ? renderExistingWidgetForm({ submitUseExisting, t, existingSelectId, typeLabel, selectedExistingId, setSelectedExistingId, instances, base, kit: props.kit }) : null}

          {renderNewWidgetForm({ submitCreateNew, t, newTitleInputId, newTitleInputRef, newTitle, setNewTitle, base, props, newConfig, setNewConfig })}
        </div>

        {renderWidgetPickerFooter({ props, base, t })}
    </>
  );
  if (props.presentation === "inline") return content;
  return (
    <Dialog open title={interpolate({ template: t("Place a {typeLabel} widget"), vars: { typeLabel } })}
      onClose={() => props.onCancel()} className="settings-dialog jini-domain-dialog widget-picker-dialog">
      {content}
    </Dialog>
  );
}

function renderWidgetPickerFooter(
  { props, base, t }:
    Pick<ReturnType<NonNullable<WidgetPickerDialogProps["useDialog"]>>, "t"> &
    { props: Omit<WidgetPickerDialogProps, "useDialog" | "agentHandle">; base: WidgetPickerDialogProps["agentHandle"] }
) {
  return (
    <div className="widget-picker-footer">
      <span className="editor-actions">
        <button
          type="button"
          className="btn-secondary"
          data-jini-autofocus=""
          onClick={props.onCancel}
          {...handleSpread({ base, suffix: "cancel", opts: { role: "button", label: "Close without placing a widget" } })}
        >
          {t("Cancel")}
        </button>
      </span>
    </div>
  );
}

function renderNewWidgetForm(
  { submitCreateNew, t, newTitleInputId, newTitleInputRef, newTitle, setNewTitle, base, props, newConfig, setNewConfig }:
    Pick<ReturnType<NonNullable<WidgetPickerDialogProps["useDialog"]>>, "submitCreateNew" | "t" | "newTitleInputId" | "newTitleInputRef" | "newTitle"
    | "setNewTitle" | "newConfig" | "setNewConfig"> &
    { base: WidgetPickerDialogProps["agentHandle"]; props: Omit<WidgetPickerDialogProps, "useDialog" | "agentHandle"> }
) {
  const { WidgetConfigFields } = props.kit;
  return (
    <form onSubmit={submitCreateNew} className="widget-picker-section">
      <h3>{t("Create new")}</h3>
      <div className="field">
        <label className="field-label" htmlFor={newTitleInputId}>
          {t("Title")}
        </label>
        <input
          id={newTitleInputId}
          ref={newTitleInputRef}
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          {...handleSpread({ base, suffix: "new-title", opts: { role: "field", label: "The new widget's title" } })}
        />
      </div>
      <WidgetConfigFields
        widgetType={props.widgetType}
        config={newConfig}
        onChange={setNewConfig}
        agentHandle={subHandle({ base, suffix: "new-config" })}
        t={t}
      />
      <button type="submit" {...handleSpread({ base, suffix: "new-submit", opts: { role: "button", label: "Create and place this widget" } })}>
        {t("Create and place")}
      </button>
    </form>
  );
}

function renderExistingWidgetForm(
  { submitUseExisting, t, existingSelectId, typeLabel, selectedExistingId, setSelectedExistingId, instances, base, kit }:
    Pick<ReturnType<NonNullable<WidgetPickerDialogProps["useDialog"]>>, "submitUseExisting" | "t" | "existingSelectId" | "typeLabel" | "selectedExistingId"
    | "setSelectedExistingId"> &
    { instances: NonNullable<ReturnType<NonNullable<WidgetPickerDialogProps["useDialog"]>>["instances"]>; base: WidgetPickerDialogProps["agentHandle"]; kit: WidgetPickerDialogProps["kit"] }
) {
  const { Select } = kit;
  return (
    <form onSubmit={submitUseExisting} className="widget-picker-section">
      <h3>{t("Use existing")}</h3>
      <div className="field">
        <label className="field-label" htmlFor={existingSelectId}>
          {interpolate({ template: t("Existing {typeLabel} widgets"), vars: { typeLabel } })}
        </label>
        <Select
          id={existingSelectId}
          value={selectedExistingId}
          onChange={setSelectedExistingId}
          // `hasExisting` is `(instances?.length ?? 0) > 0` (the hook), so this section only
          // renders once `instances` is a loaded, non-empty list; the old `?? []` here could not fire.
          options={toExistingOptions(instances)}
          placeholder={t("Choose a widget…")}
          agentHandle={subHandle({ base, suffix: "existing-select" })}
          t={t}
        />
      </div>
      <button type="submit" {...handleSpread({ base, suffix: "existing-submit", opts: { role: "button", label: "Use this widget" } })}>
        {t("Use this widget")}
      </button>
    </form>
  );
}

/**
 * The shared "choose a type, then open `WidgetPickerDialog`" two-step trigger (`ui.spec.md` §4.7's
 * `RegionPlacementList.onAddWidgetRequest` and §4.9's `WidgetEmbedNode.onInsertRequest` both name
 * this exact flow). One small control, reused by `WidgetRegionEditor.tsx`'s "+ Add widget" and the
 * TipTap toolbar's "Insert widget" button — avoids two independent implementations of the same
 * type-choice step.
 *
 * ## Agent handles
 *
 * Given `agentHandle="add-widget"` this publishes `<base>-type` (the type `Select`, via its own
 * scheme) and `<base>-open` (the trigger button); the nested `WidgetPickerDialog`, once opened,
 * gets `<base>-picker` as ITS OWN base — see that component's "Agent handles" doc for what that
 * expands to. Without `agentHandle`, only shared controls retain their automatic handles.
 */
export interface WidgetAddControlProps {
  triggerLabel: string;
  onResolved: (widgetInstanceId: string) => void | Promise<void>;
  /** Injectable seam for the two-step type-choice/create-or-reuse state. Defaults to the real
   *  {@link useWiredWidgetAddControl}; a test can pass a fake here to exercise this component's
   *  rendering without the real `api.createWidget` call. */
  useAddControl: (props: Pick<WidgetAddControlProps, "triggerLabel" | "onResolved" | "initialWidgetType">) => ReturnType<typeof useWidgetAddControl>;
  useDialog: WidgetPickerDialogProps["useDialog"];
  kit: WidgetPickerDialogProps["kit"];
  deps: WidgetPickerDialogProps["deps"];
  /** This control's own base handle — see this file's "Agent handles" doc above. Omit to leave it
   *  (and the dialog it opens) untagged. */
  agentHandle?: string | undefined;
  /** Open directly at this type when the control is mounted inside a picker dialog. */
  initialWidgetType?: AdminWidgetType;
}

/** The retained host catalog owns type labels for both inline controls and the native picker. */
function widgetTypeOptions({ locale, deps }: { locale: string; deps: WidgetPickerDialogProps["deps"] }, _optional: Record<string, never> = {}): SelectOption[] {
  const { WIDGET_TYPE_OPTIONS, widgetTypeLabel, translateWidgets } = deps;
  return WIDGET_TYPE_OPTIONS.map((o) => ({ value: o.value, label: widgetTypeLabel({ widgetType: o.value, types: WIDGET_TYPE_OPTIONS }, { t: key => translateWidgets({ locale, key }) }) }));
}

export function WidgetAddControl({ useAddControl, agentHandle: base, ...props }: WidgetAddControlProps, _optional = {}) {
  const { Select } = props.kit;
  const { pickerType, setPickerType, selectedType, setSelectedType, error, handleCreateNew, handleUseExisting, t, locale } =
    useAddControl(props);
  // `WIDGET_TYPE_OPTIONS`'s own labels are the English source strings; translate them through the
  // same `widgetTypeLabel` lookup `WidgetPickerDialog.hooks.tsx`'s `typeLabel` uses, so this type
  // picker and the dialog it opens agree on one widget type's display name per locale.
  const typeOptions = widgetTypeOptions({ locale, deps: props.deps });

  return (
    <span className="widget-add-control">
      <Select
        value={selectedType}
        onChange={(v) => setSelectedType(v as AdminWidgetType)}
        options={typeOptions}
        aria-label={t("Widget type")}
        agentHandle={base ? `${base}-type` : undefined}
        t={t}
      />
      <button
        type="button"
        onClick={() => setPickerType({ next: selectedType })}
        {...(base ? agentHandle({ handle: `${base}-open` }, { role: "button", label: props.triggerLabel }) : {})}
      >
        {props.triggerLabel}
      </button>
      {error ? (
        <span className="save-error" role="alert">
          {error}
        </span>
      ) : null}
      {pickerType ? (
        <WidgetPickerDialog
          kit={props.kit} deps={props.deps} useDialog={props.useDialog}
          widgetType={pickerType}
          onUseExisting={(widgetInstanceId) => handleUseExisting({ widgetInstanceId })}
          onCreateNew={(title, config) => handleCreateNew({ title, config })}
          onCancel={() => setPickerType({ next: null })}
          agentHandle={base ? `${base}-picker` : undefined}
        />
      ) : null}
    </span>
  );
}


/** Full widget flow for Embed: one native dialog owns dismissal and focus, while
 * type changes remount only the forms so drafts and late fetches cannot cross types.
 * A settled create also refreshes the forms, exposing its new widget under Use existing
 * if placement fails, as the add-control owner's recovery message promises.
 * Creation and placement still go through the existing add-control owner. */
export function WidgetSelectionDialog({ useAddControl, agentHandle: base, onCancel, ...props }: {
  onResolved: WidgetAddControlProps["onResolved"];
  onCancel: () => void;
  agentHandle?: string | undefined;
  useAddControl: WidgetAddControlProps["useAddControl"];
  useDialog: WidgetPickerDialogProps["useDialog"];
  kit: WidgetPickerDialogProps["kit"];
  deps: WidgetPickerDialogProps["deps"];
}, _optional = {}) {
  const { Dialog, Select } = props.kit;
  const vm = useAddControl({ triggerLabel: "Insert widget", onResolved: props.onResolved, initialWidgetType: "text" });
  return (
    <Dialog open title={vm.t("Insert widget")} onClose={() => onCancel()}
      className="settings-dialog jini-domain-dialog widget-picker-dialog">
      <Select value={vm.selectedType}
        onChange={(value) => { vm.setSelectedType(value as AdminWidgetType); vm.setPickerType({ next: value as AdminWidgetType }); }}
        options={widgetTypeOptions({ locale: vm.locale, deps: props.deps })} aria-label={vm.t("Widget type")}
        agentHandle={subHandle({ base, suffix: "type" })} t={vm.t} />
      {vm.error ? <span className="save-error" role="alert">{vm.error}</span> : null}
      <WidgetPickerDialog key={`${vm.selectedType}:${vm.pickerType === null ? "settled" : "draft"}`}
        kit={props.kit} deps={props.deps}
        widgetType={vm.selectedType} presentation="inline"
        onUseExisting={(widgetInstanceId) => vm.handleUseExisting({ widgetInstanceId })} onCreateNew={(title, config) => vm.handleCreateNew({ title, config })} onCancel={onCancel}
        useDialog={props.useDialog}
        agentHandle={subHandle({ base, suffix: "picker" })} />
    </Dialog>
  );
}
