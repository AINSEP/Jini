import { useRef, type ComponentType, type Dispatch, type SetStateAction } from "react";
import type { AgentElementRole, AgentHandleOptions, AgentHandleProps } from "@jini-ai/core/agent-handles";
import { createEmbedInsertControlTranslator, type EmbedEditor, type WidgetAddControlState } from "./EmbedInsertControl.hooks.js";

/**
 * @file `EmbedInsertControl` — quick-and-dirty per the owner's explicit instruction (2026-08-05,
 * "skip formal spec/ADR process, just get it working"): one "Embed" trigger on the post editor's
 * toolbar, replacing the previously-separate "Media" and "Insert widget" buttons.
 *
 * Key insight this control is built around: "Form" and "Menu" are not separate embedding
 * mechanisms — they are just the `contact-form` and `menu` widget TYPES
 * (`WidgetConfigFields.tsx`'s `WIDGET_TYPE_OPTIONS`). Before this control, reaching either one
 * meant opening "Insert widget" and then changing a type `<select>` — two clicks buried behind an
 * unrelated label. This control surfaces four top-level choices instead:
 *   - Media   — `MediaPickerDialog` + `editor.commands.insertMediaEmbed` (2026-09-11: switched from
 *               the legacy `image`-only `insertMediaRef` to the generic `media` node — see
 *               `lib/media-embed-extension.tsx`'s own file header for why).
 *   - Form    — shortcut straight to `WidgetPickerDialog` pinned to `widgetType: "contact-form"`.
 *   - Menu    — same shortcut pattern, pinned to `widgetType: "menu"`.
 *   - Widget… — the original full flow (type `<select>` then the same dialog) for the other three
 *               types, via the existing `WidgetAddControl` unchanged — kept because narrowing its
 *               hardcoded `WIDGET_TYPE_OPTIONS` would mean forking it, which is more code and more
 *               risk than just keeping all five types reachable there too.
 *
 * Deliberately composes `MediaPickerDialog`, `WidgetPickerDialog`, `WidgetAddControl`, and the
 * `useWidgetAddControl` hook exactly as exported — none of their internals change. Those are
 * shared with `RegionPlacementList`, `CollectionEntryEditor.tsx`, and `WidgetRegionEditor.tsx` (see
 * `widget-embed-extension.tsx` and `WidgetPickerDialog.tsx`'s own file headers), so their existing
 * exported shape has to stay intact for those other call sites.
 *
 * Desktop 0.1.13: Widget… now opens `WidgetSelectionDialog`, which reuses the
 * same picker forms inline inside one native modal. Type selection leaves the
 * toolbar entirely; the retained inline AddControl still serves region editors.
 *
 * No new design system: plain buttons, matches `PostEditor.tsx`'s `Toolbar` `.tb-btn` idiom.
 *
 * Moved here from `lib/` (was `lib/embed-insert-control.tsx`) per the owner's ruling on that
 * directory split: the file extension isn't the test, addressability is. A TipTap `Node` schema and
 * its node view stay in `lib/` because a node view is React only `ReactNodeViewRenderer` can mount,
 * 1:1 with its schema (see `media-image-extension.tsx`'s header) — this is an ordinary toolbar
 * component any screen can render, ordinary `components/` territory. State — the menu/dialog
 * visibility flags and the two pinned `useWidgetAddControl` instances — now lives in
 * `EmbedInsertControl.hooks.tsx`, split out the same way `ConfirmDialog`/`ConfirmDialog.hooks.tsx`
 * does in `@jini-ai/admin`; the `useEmbed` prop below lets a test render this JSX against a fake
 * without driving the real menu/dialog state machine or the real `useWidgetAddControl` fetches.
 */

/** What the injected `useEmbed` hook returns (the host binds `useEmbedInsertControl`). */
export interface EmbedInsertControlState<Type extends string = string> {
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  widgetMode: boolean;
  setWidgetMode: Dispatch<SetStateAction<boolean>>;
  mediaPicking: boolean;
  setMediaPicking: Dispatch<SetStateAction<boolean>>;
  formControl: WidgetAddControlState<Type>;
  menuControl: WidgetAddControlState<Type>;
  galleryControl: WidgetAddControlState<Type>;
  insertWidget: (required: { widgetEntryId: string }) => void;
}

type AgentHandleAttributes = (required: { handle: string }, optional?: AgentHandleOptions) => AgentHandleProps;

export interface EmbedInsertControlProps<Type extends string = string> {
  editor: EmbedEditor | null;
  /** The menu/dialog visibility state and the pinned Form/Menu/Gallery add-control instances; a
   *  test can pass a fake here to exercise this component's rendering without the real state machine. */
  useEmbed: (required: { editor: EmbedEditor | null }) => EmbedInsertControlState<Type>;
  /** This control's own base handle — see the "Agent handles" doc below for the full scheme.
   *  Omit to leave every element below (including the dialogs this control opens) untagged. */
  agentHandle?: string;
  useAdminLocaleHook: () => string;
  /** The host's shared-components dictionary lookup. */
  translate: (required: { locale: string; key: string }) => string;
  agentHandleAttributes: AgentHandleAttributes;
  /** The host's mounted dialogs, each already bound to its own data hooks. */
  MediaPickerDialog: ComponentType<{
    onSelect: (item: { id: string; alt: string; title: string }) => void;
    onCancel: () => void;
    agentHandle?: string | undefined;
  }>;
  WidgetPickerDialog: ComponentType<{
    widgetType: Type;
    onUseExisting: (widgetInstanceId: string) => void;
    onCreateNew: (title: string, config: Record<string, unknown>) => void;
    onCancel: () => void;
    agentHandle?: string | undefined;
  }>;
  WidgetSelectionDialog: ComponentType<{
    onResolved: (widgetInstanceId: string) => void;
    onCancel: () => void;
    agentHandle?: string | undefined;
  }>;
}

/** The inline popover behind the "Embed" trigger: the four-choice menu (Media/Form/Menu/Widget…),
 * or the "Widget…" full flow once picked. Split out of `EmbedInsertControl` because this menu's
 * own two-state switch (`open`, then `widgetMode` once inside it) was one of the two independent
 * "wide branch set" halves of the original function — this half owns menu navigation, the other
 * (`WidgetShortcutPicker` below) owns the Form/Menu shortcut dialogs.
 *
 * `agentHandle` here is `EmbedInsertControl`'s own base, unmodified — the four menu-item actions
 * are literal choices this menu makes (never caller data), so they're appended directly as
 * `<base>-media`/`-form`/`-menu`/`-widget`, and `WidgetAddControl` gets `<base>-widget-control` as
 * ITS OWN base once "Widget…" is picked. */

/** `{...(base ? agentHandle(\`${base}-<suffix>\`, opts) : {})}` as a named helper — same
 *  complexity-budget rationale as `WidgetPickerDialog.tsx`'s identical helper: each of this menu's
 *  four conditional agent-handle spreads was its own nested branch in `EmbedMenu`'s own cognitive
 *  complexity count. `{}` (no markup) when `base` is unset, same as every inline occurrence it
 *  replaces. */
function handleSpread({ base, suffix, opts, agentHandle }: { base: string | undefined; suffix: string; opts: { role: AgentElementRole; label: string }; agentHandle: AgentHandleAttributes }, _options: Record<string, never> = {}): Record<string, unknown> {
  return base ? agentHandle({ handle: `${base}-${suffix}` }, opts) : {};
}

/** `base ? \`${base}-<suffix>\` : undefined` as a named helper — same rationale as
 *  {@link handleSpread}, for the sub-handle string handed to `WidgetAddControl` as its own base. */
function subHandle({ base, suffix }: { base: string | undefined; suffix: string }, _options: Record<string, never> = {}): string | undefined {
  return base ? `${base}-${suffix}` : undefined;
}

function EmbedMenu(props: {
  open: boolean;
  onPickMedia: () => void;
  onPickForm: () => void;
  onPickMenu: () => void;
  onPickGallery: () => void;
  onEnterWidgetMode: () => void;
  agentHandle?: string | undefined;
  agentHandleAttributes: AgentHandleAttributes;
  t: (input: { key: string }, options?: Record<string, never>) => string;
}) {
  const { open, onPickMedia, onPickForm, onPickMenu, onPickGallery, onEnterWidgetMode, agentHandle: base, agentHandleAttributes, t } = props;
  if (!open) return null;

  return (
    <span className="embed-insert-menu" role="menu" aria-label={t({ key: "Insert" })}>
          <button
            type="button"
            role="menuitem"
            className="tb-btn"
            onClick={onPickMedia}
            {...handleSpread({ base, agentHandle: agentHandleAttributes, suffix: "media", opts: { role: "button", label: "Insert an existing media asset" } })}
          >
            {t({ key: "Media" })}
          </button>
          <button
            type="button"
            role="menuitem"
            className="tb-btn"
            onClick={onPickForm}
            {...handleSpread({ base, agentHandle: agentHandleAttributes, suffix: "form", opts: { role: "button", label: "Insert a contact form" } })}
          >
            {t({ key: "Form" })}
          </button>
          <button
            type="button"
            role="menuitem"
            className="tb-btn"
            onClick={onPickMenu}
            {...handleSpread({ base, agentHandle: agentHandleAttributes, suffix: "menu", opts: { role: "button", label: "Insert a menu" } })}
          >
            {t({ key: "Menu" })}
          </button>
          <button
            type="button"
            role="menuitem"
            className="tb-btn"
            onClick={onPickGallery}
            {...handleSpread({ base, agentHandle: agentHandleAttributes, suffix: "gallery", opts: { role: "button", label: "Insert a gallery" } })}
          >
            {t({ key: "Gallery" })}
          </button>
          <button type="button" role="menuitem" className="tb-btn"
            onClick={onEnterWidgetMode}
            {...handleSpread({ base, agentHandle: agentHandleAttributes, suffix: "widget", opts: { role: "button", label: "Insert any other widget type" } })}
          >
            {t({ key: "Widget…" })}
          </button>
    </span>
  );
}

/** The Form/Menu "shortcut" flow: the pinned-type `WidgetPickerDialog` plus its own error slot.
 * Identical shape for both `formControl` and `menuControl` (each a separate `useWidgetAddControl`
 * instance pinned to a `widgetType`, per `EmbedInsertControl.hooks.tsx`'s own header) — one
 * component used twice, rather than the same four-ternary pair written out inline twice.
 * `agentHandle` here is passed straight through as the opened `WidgetPickerDialog`'s own base. */
function WidgetShortcutPicker<Type extends string>(props: {
  WidgetPickerDialog: EmbedInsertControlProps<Type>["WidgetPickerDialog"];
  pickerType: Type | null;
  error: string | null;
  onUseExisting: (widgetInstanceId: string) => void;
  onCreateNew: (title: string, config: Record<string, unknown>) => void;
  onCancel: () => void;
  agentHandle?: string | undefined;
}) {
  const { WidgetPickerDialog, pickerType, error, onUseExisting, onCreateNew, onCancel, agentHandle: base } = props;
  return (
    <>
      {pickerType ? (
        <WidgetPickerDialog
          widgetType={pickerType}
          onUseExisting={onUseExisting}
          onCreateNew={onCreateNew}
          onCancel={onCancel}
          agentHandle={base}
        />
      ) : null}
      {error ? (
        <span className="save-error" role="alert">
          {error}
        </span>
      ) : null}
    </>
  );
}

/**
 * The toolbar's single "Embed" trigger — opens a small inline menu of four choices (Media, Form,
 * Menu, Widget…) in place of the old separate Media/Insert-widget buttons.
 *
 * ## Agent handles
 *
 * Given `agentHandle="post-embed"` this publishes the trigger button directly under `<base>`
 * (single root action, no suffix — the "action omitted, element IS base" case), then forwards the
 * SAME base down to {@link EmbedMenu} for its four menu-item handles, `<base>-media-dialog` to the
 * media picker, and `<base>-form-dialog`/`<base>-menu-dialog` to the two
 * {@link WidgetShortcutPicker} instances as THEIR dialogs' own base. Omit `agentHandle` and none of
 * this control's own elements, or any dialog it opens, are tagged.
 */
export function EmbedInsertControl<Type extends string>({ useEmbed, agentHandle: base,
  useAdminLocaleHook, translate, agentHandleAttributes, MediaPickerDialog, WidgetPickerDialog, WidgetSelectionDialog, ...props }: EmbedInsertControlProps<Type>) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const locale = useAdminLocaleHook();
  const t = createEmbedInsertControlTranslator({ locale, translate });
  const { open, setOpen, widgetMode, setWidgetMode, mediaPicking, setMediaPicking, formControl, menuControl, galleryControl, insertWidget } =
    useEmbed({ editor: props.editor });

  if (!props.editor) return null;
  const editor = props.editor;

  return (
    <span className="embed-insert-control">
      <button
        ref={triggerRef}
        type="button"
        className="tb-btn"
        title={t({ key: "Insert media, a form, a menu, or a widget" })}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
          setWidgetMode(false);
        }}
        {...(base ? agentHandleAttributes({ handle: base }, { role: "button", label: "Insert media, a form, a menu, or a widget" }) : {})}
      >
        {t({ key: "Embed" })}
      </button>
      <EmbedMenu
        open={open}
        onPickMedia={() => {
          setMediaPicking(true);
          setOpen(false);
        }}
        onPickForm={() => {
          formControl.setPickerType({ next: "contact-form" });
          setOpen(false);
        }}
        onPickMenu={() => {
          menuControl.setPickerType({ next: "menu" });
          setOpen(false);
        }}
        onPickGallery={() => { galleryControl.setPickerType({ next: "gallery" }); setOpen(false); }}
        onEnterWidgetMode={() => {
          // The menu item unmounts on open; give the native dialog a persistent
          // opener to restore instead of capturing the removed item's body fallback.
          triggerRef.current?.focus();
          setWidgetMode(true);
          setOpen(false);
        }}
        agentHandle={base}
        agentHandleAttributes={agentHandleAttributes}
        t={t}
      />

      {widgetMode ? (
        <WidgetSelectionDialog
          onResolved={(widgetInstanceId) => { insertWidget({ widgetEntryId: widgetInstanceId }); setWidgetMode(false); }}
          onCancel={() => setWidgetMode(false)}
          agentHandle={subHandle({ base, suffix: "widget-control" })}
        />
      ) : null}

      <EmbedMediaPicker MediaPickerDialog={MediaPickerDialog} open={mediaPicking} editor={editor} base={base} onClose={() => setMediaPicking(false)} />

      <WidgetShortcutPicker
        WidgetPickerDialog={WidgetPickerDialog}
        pickerType={formControl.pickerType}
        error={formControl.error}
        onUseExisting={(widgetInstanceId) => formControl.handleUseExisting({ widgetInstanceId })}
        onCreateNew={(title, config) => formControl.handleCreateNew({ title, config })}
        onCancel={() => formControl.setPickerType({ next: null })}
        agentHandle={base ? `${base}-form-dialog` : undefined}
      />
      <WidgetShortcutPicker WidgetPickerDialog={WidgetPickerDialog} pickerType={galleryControl.pickerType} error={galleryControl.error} onUseExisting={(widgetInstanceId) => galleryControl.handleUseExisting({ widgetInstanceId })} onCreateNew={(title, config) => galleryControl.handleCreateNew({ title, config })} onCancel={() => galleryControl.setPickerType({ next: null })} agentHandle={subHandle({ base, suffix: "gallery-dialog" })} />
      <WidgetShortcutPicker
        WidgetPickerDialog={WidgetPickerDialog}
        pickerType={menuControl.pickerType}
        error={menuControl.error}
        onUseExisting={(widgetInstanceId) => menuControl.handleUseExisting({ widgetInstanceId })}
        onCreateNew={(title, config) => menuControl.handleCreateNew({ title, config })}
        onCancel={() => menuControl.setPickerType({ next: null })}
        agentHandle={base ? `${base}-menu-dialog` : undefined}
      />
    </span>
  );
}

function EmbedMediaPicker({ MediaPickerDialog, open, editor, base, onClose }: {
  MediaPickerDialog: EmbedInsertControlProps["MediaPickerDialog"];
  open: boolean; editor: NonNullable<EmbedInsertControlProps['editor']>; base: string | undefined; onClose: () => void;
}) {
  return (open ? (
        <MediaPickerDialog
          onSelect={(item) => {
            // 2026-09-11: inserts the generic `media` node (`insertMediaEmbed`), not the legacy
            // `image`-only ref (`insertMediaRef`) — see the host's media-embed node's own file
            // header. A picked video asset now actually plays once saved.
            editor.commands.insertMediaEmbed({ assetId: item.id, transformName: "public", alt: item.alt || item.title });
            onClose();
          }}
          onCancel={() => onClose()}
          agentHandle={base ? `${base}-media-dialog` : undefined}
        />
      ) : null);
}
