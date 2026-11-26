import { useCallback as useQueryFetchCallback, useEffect, useId, useRef, useState } from "react";
import type { FetchQueryAdapter } from "@jini-ai/core/fetch";
import type { WidgetTypeKey as AdminWidgetType } from "../../../widgets/types.js";
import { type Translate, interpolate } from "@jini-ai/core/text";

type AdminWidget = { id: string; workspaceId: string; slug: string; title: string; status: "active" | "trash" | "purged"; widgetType: AdminWidgetType; config: Record<string, unknown>; updatedAt: string; version: number };
type WidgetPickerPort = {
  listWidgets: (required: { widgetType: AdminWidgetType }, optional?: Record<string, never>) => Promise<{ widgets: AdminWidget[] }>;
  createWidget: (required: { widgetType: AdminWidgetType; title: string; config: Record<string, unknown> }, optional?: Record<string, never>) => Promise<{ widget: AdminWidget }>;
};
type WidgetPickerDialogProps = { widgetType: AdminWidgetType; onUseExisting: (id: string) => void; onCreateNew: (title: string, config: Record<string, unknown>) => void; onCancel: () => void };
type WidgetAddControlProps = { triggerLabel: string; onResolved: (id: string) => void | Promise<void>; initialWidgetType?: AdminWidgetType };

/**
 * @file `WidgetPickerDialog`'s and `WidgetAddControl`'s state — the existing-instances fetch, the
 * dialog's own form/selection/deferred-autofocus state, and the two-step type-choice flow —
 * split out of the component file so each can be swapped for a fake via the `useDialog`/
 * `useAddControl` props on their respective prop types (see those props' doc comments in
 * `WidgetPickerDialog.tsx`), per the `@jini-ai/admin` `<Name>.tsx`/`<Name>.hooks.tsx` extraction
 * pattern (`ConfirmDialog.tsx`/`ConfirmDialog.hooks.tsx` in that package).
 *
 * `WidgetPickerDialogProps`/`WidgetAddControlProps` are imported here as types only (no runtime
 * import) from `./WidgetPickerDialog` — the hooks need the full props shape, but the component file
 * is still the one importing this file's runtime exports, not the other way around, so there is no
 * runtime circular dependency between the two.
 *
 * `port` is injected (see `widget-picker-port.hooks.ts`) rather than reaching `lib/api`'s `api`
 * directly — same shape `MediaPickerDialog.hooks.tsx` uses. `useWidgetPickerDialog`/
 * `useWidgetAddControl` take `deps: { port?; locale? }` as an OPTIONAL, defaulted parameter rather
 * than being strictly `useWiredX(props)`-only: `useWidgetAddControl` has a real out-of-slice
 * consumer — `EmbedInsertControl.hooks.tsx` calls `useWidgetAddControl(props)` with one argument,
 * twice, for its pinned Form/Menu controls (still locale-less until that file gets its own
 * `useAdminLocale()` — see `EmbedInsertControl.hooks.tsx`'s own header once that lands). An
 * optional, defaulted `deps` object keeps every existing call site (in-slice and out-of-slice
 * alike) compiling and behaving identically, while still giving tests a real seam:
 * `useWidgetAddControl(props, { port: createFakeWidgetPickerPort(...) })`.
 *
 * `useWiredWidgetPickerDialog`/`useWiredWidgetAddControl` (below) are the zero-argument-deps half
 * every component actually mounts — they resolve `locale` via `useAdminLocale()` and pass the real
 * `port`, mirroring `MediaEditDialog.hooks.tsx`'s established wired/unwired split. `locale` sits in
 * the SAME `deps` object as `port` rather than a separate parameter, so `useWidgetAddControl`'s
 * existing one-argument out-of-slice call sites keep compiling — adding a required third
 * positional parameter would have broken them.
 *
 * `t`/`locale` are computed once here (`t = (key) => sharedComponentsT(locale, key)`) and returned
 * on both hooks' controllers, rather than each call site importing `shared-components-i18n`
 * directly — `WidgetPickerDialog.tsx`/`WidgetAddControl` read `t`/`locale` off the hook's return
 * the same way they already read every other piece of controller state.
 */

/**
 * Fetches the widget type's existing instances for the "use existing" section, once per
 * `widgetType`.
 *
 * @param required.widgetType - The widget type to list instances for.
 * @param optional.port - Injected {@link WidgetPickerPort} — see this file's own header for why it's an
 *   optional, defaulted parameter rather than a separate `useWiredX()` export.
 * @param optional.locale - Translates the `describeApiError` fallback via `shared-components-i18n.ts`'s `t`.
 *   Defaults to `DEFAULT_LOCALE` ("en"), which renders the same English fallback as before this
 *   parameter existed (the dictionary carries no "en" block — see that file's own header).
 * @returns `instances` (`null` while the fetch is in flight, otherwise the loaded list) and
 *   `error` (a describable failure message, or `null`).
 * @example
 * const { instances, error } = useExistingInstances({ widgetType: "text" });
 */
export function useExistingInstances(
  { widgetType, deps }: { widgetType: AdminWidgetType; deps: Pick<Parameters<typeof useWidgetPickerDialog>[0]["deps"], "port" | "useFetchQuery" | "describeApiError" | "sharedComponentsT"> & { locale: string } },
  _optional = {},
) {
  const { port, locale, useFetchQuery, describeApiError, sharedComponentsT } = deps;
  const queryFetch = useQueryFetchCallback(async () => {
    try { return (await port.listWidgets({ widgetType })).widgets; }
    catch (error) { throw new Error(describeApiError({ e: error, fallback: sharedComponentsT({ locale, key: "failed to load existing widgets" }) })); }
  }, [port, widgetType, locale]);
  // Widget type keys isolate the picker instances; a slow prior-type response cannot populate
  // the current picker. Port/locale dependencies refresh the fetch callback without resetting
  // the cache's ownership or the operator's selection.
  const query = useFetchQuery({ key: ["widgets", "instances", widgetType], fetch: queryFetch }, { staleTime: 0 });
  const instances = query.data ?? null;
  const error = query.error?.message ?? null;
  return { instances, error };
}

export function useWidgetPickerDraft({ props, instances, deps }: {
  props: WidgetPickerDialogProps;
  instances: AdminWidget[] | null;
  deps: Pick<Parameters<typeof useWidgetPickerDialog>[0]["deps"], "defaultWidgetConfig" | "widgetTypeLabel" | "WIDGET_TYPE_OPTIONS" | "translateWidgets"> & { locale: string };
}, _optional = {}) {
  const { locale, defaultWidgetConfig, widgetTypeLabel, WIDGET_TYPE_OPTIONS, translateWidgets } = deps;
  const [selectedExistingId, setSelectedExistingId] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newConfig, setNewConfig] = useState<Record<string, unknown>>(() => defaultWidgetConfig({ widgetType: props.widgetType }));
  const [error, setError] = useState<string | null>(null);
  // `useId()`, not string literals — this component is conditionally mounted per caller
  // (`WidgetAddControl`'s `{pickerType ? <WidgetPickerDialog .../> : null}`), and only one
  // `WidgetAddControl` exists per screen today, so two instances can't currently coexist in the
  // DOM to collide. Fixed anyway (same `ConfirmDialog.tsx` id-collision class of bug, found live
  // there via `Roles.tsx`'s two always-mounted dialogs) because the cost is a three-line diff and
  // the alternative is a landmine for whoever adds a second widget control to one screen later —
  // `aria-labelledby`/`htmlFor` both resolve via `getElementById`, which silently returns the
  // first DOM match rather than erroring on a duplicate id.
  const existingSelectId = useId();
  const newTitleInputId = useId();
  const newTitleInputRef = useRef<HTMLInputElement | null>(null);

  const typeLabel = widgetTypeLabel({ widgetType: props.widgetType, types: WIDGET_TYPE_OPTIONS }, { t: key => translateWidgets({ locale, key }) });
  const hasExisting = (instances?.length ?? 0) > 0;

  // Found live in a real browser, not in this file's own jsdom suite: `instances` starts `null`
  // (the `listWidgets` fetch is still in flight) on the Title input's very first paint, so
  // `hasExisting` always reads `false` at that instant regardless of the real answer — a plain
  // `autoFocus={!hasExisting}` on the `<input>` below therefore focused Title unconditionally on
  // EVERY open, including widget types that already have existing instances (verified: "Live test
  // footer note" already existed for `text`, yet Title still carried the visible focus ring).
  // `autoFocus` only ever fires once, at that initial DOM insertion — by the time the fetch
  // resolves and `hasExisting` flips to its real value a moment later, the element is not
  // remounted, so nothing re-evaluates the decision. This effect defers the decision until
  // `instances` has actually resolved, matching what `ui.spec.md` §5 (quoted in this file's own
  // header) asks for: no pre-selected default when existing instances are real options.
  // Derive the focus decision from the resolved instances, so it cannot run before they load.
  useEffect(() => {
    if (instances === null) return;
    if (instances.length === 0) newTitleInputRef.current?.focus();
  }, [instances]);

  return { selectedExistingId, setSelectedExistingId, newTitle, setNewTitle, newConfig, setNewConfig, error, setError,
    existingSelectId, newTitleInputId, newTitleInputRef, typeLabel, hasExisting };
}

/**
 * Owns `WidgetPickerDialog`'s own state on top of `useExistingInstances`: the existing-instance
 * selection, the new-widget draft fields, the shared submit error,
 * and the defer-until-resolved new-title autofocus.
 *
 * @param props - The dialog's own props (`widgetType`, `onUseExisting`, `onCreateNew`, `onCancel`)
 *   — the hook reads and forwards these exactly as the component previously did inline.
 * @returns Everything the dialog's JSX renders from: loaded instances/`loadError`, the "use
 *   existing" and "create new" form state plus their submit handlers, the three `useId()` values,
 *   the new-title input ref, the resolved type label, `hasExisting`, and the bound `t`/`locale`.
 * @param deps - Injected `{ port?; locale? }` — see this file's own header for why it's
 *   optional/defaulted rather than two required positional parameters.
 * @example
 * const { instances, hasExisting, submitCreateNew } = useWidgetPickerDialog(props);
 */
export function useWidgetPickerDialog(
  { props, deps }: { props: WidgetPickerDialogProps; deps: {
    port: WidgetPickerPort; useAdminLocaleHook: () => string; useFetchQuery: FetchQueryAdapter["useFetchQuery"];
    defaultWidgetConfig: (required: { widgetType: AdminWidgetType }) => Record<string, unknown>;
    WIDGET_TYPE_OPTIONS: readonly { value: AdminWidgetType; label: string }[];
    widgetTypeLabel: (required: { widgetType: AdminWidgetType; types: readonly { value: AdminWidgetType; label: string }[] }, optional: { t: Translate }) => string;
    translateWidgets: (required: { locale: string; key: string }) => string;
    sharedComponentsT: (required: { locale: string; key: string }) => string;
    describeApiError: (required: { e: unknown; fallback: string }) => string;
  } },
  _optional = {},
) {
  const locale = deps.useAdminLocaleHook();
  const { sharedComponentsT } = deps;
  const t: Translate = (key) => sharedComponentsT({ locale: locale, key: key });
  const { instances, error: loadError } = useExistingInstances({ widgetType: props.widgetType, deps: { ...deps, locale } });
  const { selectedExistingId, setSelectedExistingId, newTitle, setNewTitle, newConfig, setNewConfig, error, setError,
    existingSelectId, newTitleInputId, newTitleInputRef, typeLabel, hasExisting } = useWidgetPickerDraft({ props, instances, deps: { ...deps, locale } });

  function submitUseExisting(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedExistingId) {
      setError(t("Choose an existing widget to use."));
      return;
    }
    props.onUseExisting(selectedExistingId);
  }

  function submitCreateNew(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) {
      setError(t("Title is required."));
      return;
    }
    props.onCreateNew(newTitle.trim(), newConfig);
  }

  return {
    instances,
    loadError,
    selectedExistingId,
    setSelectedExistingId,
    newTitle,
    setNewTitle,
    newConfig,
    setNewConfig,
    error,
    existingSelectId,
    newTitleInputId,
    newTitleInputRef,
    typeLabel,
    hasExisting,
    submitUseExisting,
    submitCreateNew,
    t,
    locale,
  };
}

/**
 * Owns `WidgetAddControl`'s two-step flow: the pending type choice (`selectedType`), whether the
 * picker dialog is open (`pickerType`, `null` when closed), and the two resolution handlers that
 * create-or-reuse a widget and then call back into `props.onResolved`.
 *
 * @param props - `triggerLabel` (unused by the hook itself, kept for parity with the component's
 *   props) and `onResolved`, invoked once a widget instance id is settled.
 * @returns `pickerType`/`setPickerType`, `selectedType`/`setSelectedType`, the create/use-existing
 *   `error` message (or `null`), the `handleCreateNew`/`handleUseExisting` submit handlers, and the
 *   bound `t`/`locale`.
 * @param deps - Injected `{ port?; locale? }` — see this file's own header for why it's
 *   optional/defaulted rather than two required positional parameters.
 *   `EmbedInsertControl.hooks.tsx`'s two pinned instances call this with one argument, so this
 *   parameter must stay optional — see this file's own header.
 * @example
 * const { pickerType, handleCreateNew } = useWidgetAddControl({ triggerLabel: "+ Add widget", onResolved });
 */
export function useWidgetAddControl(
  { props, deps }: { props: WidgetAddControlProps; deps: Pick<Parameters<typeof useWidgetPickerDialog>[0]["deps"], "port" | "useAdminLocaleHook" | "sharedComponentsT" | "describeApiError"> },
  _optional = {},
) {
  const locale = deps.useAdminLocaleHook();
  const { port, sharedComponentsT, describeApiError } = deps;
  const t: Translate = (key) => sharedComponentsT({ locale: locale, key: key });
  const [pickerType, setPickerTypeRaw] = useState<AdminWidgetType | null>(props.initialWidgetType ?? null);
  const [selectedType, setSelectedType] = useState<AdminWidgetType>(props.initialWidgetType ?? "text");
  const [error, setError] = useState<string | null>(null);

  // Bug found live 2026-09-03: `error` was previously only ever SET (by `handleCreateNew`'s
  // catch below), never cleared — not on Cancel, not on a later successful create/use-existing.
  // `WidgetShortcutPicker` (`EmbedInsertControl.tsx`) renders `error` as a SIBLING of the
  // `pickerType`-gated dialog, not nested inside it, so a stale "failed to create widget" message
  // stayed on screen indefinitely after the very first failure, long after the dialog that
  // produced it was closed. Every call site that opens OR closes the dialog goes through
  // `setPickerType` (`WidgetPickerDialog.tsx`'s "Widget…"/Cancel, `EmbedInsertControl.tsx`'s
  // Form/Menu shortcuts and their own Cancel), so clearing `error` here — rather than hunting down
  // every call site individually — covers all of them, including any future one.
  function setPickerType({ next }: { next: AdminWidgetType | null }, _options: Record<string, never> = {}) {
    setError(null);
    setPickerTypeRaw(next);
  }

  // Creating and placing are two separate writes with nothing binding them, so each gets its own
  // catch: a placement failure after a successful create must not be reported as "failed to create"
  // (the widget exists), and must name the way back to it — "Use existing" re-fetches on open, so
  // the created widget is listed there. `error` renders beside the dialog, not inside it
  // (`WidgetAddControl`), so it stays visible after the close. Never rejects: the dialog's submit
  // handlers discard these promises.
  async function handleCreateNew({ title, config }: { title: string; config: Record<string, unknown> }, _options: Record<string, never> = {}) {
    // A parent dialog stays mounted after a placement error; its type remains selectable
    // even though the inline control's close-on-create path has cleared pickerType.
    const widgetType = pickerType ?? (props.initialWidgetType ? selectedType : null);
    if (!widgetType) return;
    let widgetId: string;
    try {
      const { widget } = await port.createWidget({ widgetType, title, config });
      widgetId = widget.id;
    } catch (e) {
      setError(describeApiError({ e, fallback: t("failed to create widget") }));
      return;
    }
    setPickerType({ next: null });
    try {
      await props.onResolved(widgetId);
    } catch (e) {
      const detail = describeApiError({ e, fallback: t("failed to place widget") });
      setError(
        interpolate({ template: t('Widget "{title}" was created but not placed ({detail}). Choose it under Use existing to try again.'), vars: { title, detail } }
        )
      );
    }
  }

  async function handleUseExisting({ widgetInstanceId }: { widgetInstanceId: string }, _options: Record<string, never> = {}) {
    setPickerType({ next: null });
    try {
      await props.onResolved(widgetInstanceId);
    } catch (e) {
      setError(describeApiError({ e, fallback: t("failed to place widget") }));
    }
  }

  return { pickerType, setPickerType, selectedType, setSelectedType, error, handleCreateNew, handleUseExisting, t, locale };
}

