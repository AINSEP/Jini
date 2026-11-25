import { useState } from "react";

/**
 * @file `EmbedInsertControl`'s own state — the menu open/closed flag, the Media-picker-open flag,
 * the Widget…-mode flag, and the pinned `useWidgetAddControl` instances (Form/Menu/Gallery) — split
 * out of the component so it can be swapped for a fake via the `useEmbed` prop on
 * `EmbedInsertControlProps`. The widget add-control hook and the placement-id minting are the
 * host's, injected; no editor library is imported here, only the structural editor below.
 */

/** The three widget types the menu offers as one-click shortcuts. */
export type WidgetShortcutType = "contact-form" | "menu" | "gallery";

export interface EmbedEditor {
  commands: {
    // 2026-09-11: the "Media" menu item inserts the generic `media` node (`insertMediaEmbed`)
    // instead of the legacy `image`-only ref node. That node's own `insertMediaRef` command is gone —
    // deleted as dead code once this control stopped calling it; the legacy image node still RENDERS
    // backward-compat ref content, it just has no insert command of its own any more. One
    // dispatching node replaces a per-kind one.
    insertMediaEmbed: (attrs: { assetId: string; transformName: string; alt?: string }) => boolean;
    insertWidgetEmbed: (attrs: { placementId: string; widgetEntryId: string }) => boolean;
  };
}

/** The members of the host's widget add-control this screen reads (matched structurally). */
export interface WidgetAddControlState<Type extends string = string> {
  pickerType: Type | null;
  error: string | null;
  setPickerType: (required: { next: WidgetShortcutType | null }) => void;
  handleUseExisting: (required: { widgetInstanceId: string }) => unknown;
  handleCreateNew: (required: { title: string; config: Record<string, unknown> }) => unknown;
}

/** The host's `useWidgetAddControl`: one instance per pinned shortcut. */
export type UseWidgetAddControlHook<Type extends string, Port> = (
  required: { triggerLabel: string; onResolved: (widgetEntryId: string) => void },
  optional: { port?: Port | undefined },
) => WidgetAddControlState<Type>;

/**
 * Owns `EmbedInsertControl`'s menu/dialog visibility state and the pinned "shortcut"
 * add-control instances the Form/Menu/Gallery menu items drive directly via `setPickerType`
 * (never through the add control's own type-select step — that path is only exercised by the
 * "Widget…" full flow).
 *
 * @param input.editor - The live editor, or `null` before it's ready. Read only through
 *   `insertWidget` here — the component's own `if (!editor) return null` early-return still guards
 *   the JSX.
 */
export function useEmbedInsertControl<Type extends string, Port>(
  { editor, useWidgetAddControlHook, mintPlacementId }: {
    editor: EmbedEditor | null;
    useWidgetAddControlHook: UseWidgetAddControlHook<Type, Port>;
    mintPlacementId: () => string;
  },
  { widgetPort }: { widgetPort?: Port } = {},
) {
  const [open, setOpen] = useState(false);
  const [widgetMode, setWidgetMode] = useState(false);
  const [mediaPicking, setMediaPicking] = useState(false);

  // A command returns false when it cannot apply (the schema refuses the node at the current
  // selection). Ignoring that reported a placement that never happened as a success: the picker
  // closed and nothing appeared. Throwing hands it to the add control's existing onResolved
  // catch, which shows "failed to place widget" / "created but not placed" in the control's error
  // slot. A null editor stays a no-op: the component renders nothing until the editor exists.
  const insertWidget = ({ widgetEntryId }: { widgetEntryId: string }, _options: Record<string, never> = {}) => {
    if (!editor) return;
    const placed = editor.commands.insertWidgetEmbed({ placementId: mintPlacementId(), widgetEntryId });
    if (!placed) throw new Error("the editor could not place the widget at the cursor");
  };

  const onResolved = (widgetEntryId: string) => insertWidget({ widgetEntryId });
  const formControl = useWidgetAddControlHook({ triggerLabel: "Form", onResolved }, { port: widgetPort });
  const menuControl = useWidgetAddControlHook({ triggerLabel: "Menu", onResolved }, { port: widgetPort });
  const galleryControl = useWidgetAddControlHook({ triggerLabel: "Gallery", onResolved }, { port: widgetPort });

  // `insertWidget` is returned too, not just consumed by the pinned controls above — the
  // "Widget…" full-flow path in the component's JSX calls it directly from its own `onResolved`.
  return { open, setOpen, widgetMode, setWidgetMode, mediaPicking, setMediaPicking, formControl, menuControl, galleryControl, insertWidget };
}

/** Bind this screen's copy to the current locale through the host's dictionary translator. */
export function createEmbedInsertControlTranslator(
  { locale, translate }: { locale: string; translate: (required: { locale: string; key: string }) => string },
  _options: Record<string, never> = {},
) {
  return ({ key }: { key: string }, _options: Record<string, never> = {}): string => translate({ locale, key });
}
