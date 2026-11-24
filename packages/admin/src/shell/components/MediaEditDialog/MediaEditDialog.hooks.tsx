import { useState } from "react";

import type { EmbedPolicyPort } from "../../../core/ports/embed-policy.js";
import { parseMediaHtmlAttributes, type MediaHtmlAttributeError } from "../../../media/html-attributes.js";

/**
 * @file `MediaEditDialog`'s draft/validation state, split out of the component so it can be
 * swapped for a fake via the `useDialog` prop on `MediaEditDialogProps` — same split
 * `MediaPickerDialog`/`MediaPickerDialog.hooks.tsx` uses.
 *
 * Per-post media editing (2026-09-11, owner-directed per-post styling, then a same-day UI revision
 * widening it: the `media` node's node-view action is `Edit`, not `Style…` — see
 * `media-embed-extension.tsx`'s own header for the node-attrs half of this — and it edits THREE
 * fields, not two: `alt` joins `cssClass`/`htmlAttributes`. `alt` was previously only ever set at
 * insert time (`MediaPickerDialog`'s `item.alt || item.title`); this is the first way to change it
 * per-instance afterward.
 *
 * `cssClass`/`htmlAttributes` reuse the EXACT same validators the host's asset-level media panel
 * already drives its asset-level fields through (`parseMediaHtmlAttributes`, plus the host's
 * `describeMediaHtmlAttributeError`, injected as `deps.describeHtmlAttributeError`), per this task's "reuse the
 * existing validation, do not write a new parser" directive. `alt` carries NO allowlist/validation
 * of any kind — free accessibility text, same as the asset-level field's own `alt`.
 *
 * `save()` never gates on `htmlAttributesError` — same "the hint is a UX convenience only, the
 * server/render-time allowlist is the real boundary" contract the host's asset-level media panel hook
 * documents for the asset-level field (incident `a7cce060`: an earlier version of THAT field
 * blocked saving on this exact hint, silently reverting unrelated edits too). The equivalent
 * boundary here is `render.ts`'s `resolveMediaHtmlAttributes`, which independently re-parses and
 * fails closed at render time regardless of what this dialog let through.
 */

/** The `media` node's current per-instance attrs this dialog edits — `null` means "not set".
 *  `cssClass`/`htmlAttributes` inherit the asset's own same-named value when unset (see `render.ts`'s
 *  `mediaNodeStyleOverride` for that render-time precedence); `alt` has no such asset-level fallback
 *  — it is purely per-node, same as before this dialog existed. */
export interface MediaEditDialogValue {
  alt: string | null;
  cssClass: string | null;
  htmlAttributes: string | null;
}

/** What {@link useMediaEditDialog} (and the host's `useWiredMediaEditDialog`) hands back to
 *  `MediaEditDialog.tsx` — the dialog's full render-time contract. */
export interface MediaEditDialogController {
  /** Current draft text — `null` seeds as `""`, never a literal "null" string in the input. */
  alt: string;
  cssClass: string;
  htmlAttributes: string;
  setAlt: (value: string) => void;
  setCssClass: (value: string) => void;
  setHtmlAttributes: (value: string) => void;
  /** The specific, visible allowlist-rejection message for the current `htmlAttributes` draft, or
   *  `null` when it parses clean (including empty/unset) — a live hint only, see this file's own
   *  header for why it must never gate {@link save}. `alt` has no equivalent field: it is never
   *  validated. */
  htmlAttributesError: string | null;
  /** Trims each field and reports blank as `null` (clearing a previously-set value), then calls
   *  the `onSave` this hook was given — unconditionally, regardless of {@link htmlAttributesError}. */
  save: () => void;
  /** Translates the dialog's own copy (`media-i18n.ts`, keyed by the English string) for the same
   *  locale the validation hint uses, so the component never reads the locale itself. */
  t: (input: { key: string }, options?: Record<string, never>) => string;
}

/**
 * Owns `MediaEditDialog`'s draft state on top of the node's current attrs: three controlled text
 * fields and the live `htmlAttributes` validation hint. Jini owns native cancellation.
 *
 * @param input.initial - The `media` node's current `alt`/`cssClass`/`htmlAttributes` attrs.
 * @param input.onSave - Called with the new `{alt, cssClass, htmlAttributes}` triple on Save — the
 *   caller (`MediaEmbedNodeView`) forwards this straight into `props.updateAttributes`.
 * @param input._onCancel - Retained for the existing hook ABI; the component forwards cancellation to Jini.
 * @param input.deps - Injected dependencies; `deps.locale` drives `deps.describeHtmlAttributeError`
 *   and the returned `t`; `deps.translate` is the host's media dictionary lookup (keyed by the English
 *   string); `deps.htmlAttributePolicy` is the host's embed policy the live hint parses against.
 * @returns The dialog's full render-time contract — see {@link MediaEditDialogController}.
 * @complexity Time/space O(n) in the `htmlAttributes` draft's length (one validation parse per
 *   keystroke, same cost {@link parseMediaHtmlAttributes} itself documents).
 * @sideeffects Jini captures whatever had focus (the node view's `Edit` button) and moves
 *   focus onto the Alt input; on unmount, restores focus to what was captured — same technique
 *   Jini's media picker uses for its own stable Cancel target. Without
 *   this, opening the dialog left focus on the trigger button underneath it (nothing moved into
 *   the now-modal dialog), and closing it left focus on `<body>`.
 */
export function useMediaEditDialog(
  { initial, onSave, _onCancel, deps }: {
    initial: MediaEditDialogValue; onSave: (value: MediaEditDialogValue) => void;
    _onCancel: () => void; deps: {
      locale: string;
      translate: (input: { locale: string; key: string }) => string;
      describeHtmlAttributeError: (input: { error: MediaHtmlAttributeError; locale: string }) => string;
      htmlAttributePolicy: EmbedPolicyPort;
    };
  },
  _options: Record<string, never> = {},
): MediaEditDialogController {
  const [alt, setAlt] = useState(initial.alt ?? "");
  const [cssClass, setCssClass] = useState(initial.cssClass ?? "");
  const [htmlAttributes, setHtmlAttributes] = useState(initial.htmlAttributes ?? "");
  // Jini captures at mount, before focus moves onto Alt — the element that had focus then is, by
  // construction, whatever opened this dialog (the node view's `Edit` button). Restored on
  // unmount. This component is only ever rendered while the dialog is open (the caller
  // conditionally mounts it, per `MediaEditDialog.tsx`'s own doc comment), so mount/unmount IS the
  // open/close transition. The component marks Alt (or CSS class when Alt is hidden) with Jini's
  // autofocus attribute so the native owner can focus it and restore the opener on unmount.

  const parsed = parseMediaHtmlAttributes({ text: htmlAttributes, policy: deps.htmlAttributePolicy });
  const htmlAttributesError = parsed.error ? deps.describeHtmlAttributeError({ error: parsed.error, locale: deps.locale }) : null;

  function save() {
    onSave({
      alt: alt.trim() === "" ? null : alt,
      cssClass: cssClass.trim() === "" ? null : cssClass,
      htmlAttributes: htmlAttributes.trim() === "" ? null : htmlAttributes,
    });
  }

  const t = ({ key }: { key: string }, _options: Record<string, never> = {}) => deps.translate({ locale: deps.locale, key });

  return { alt, cssClass, htmlAttributes, setAlt, setCssClass, setHtmlAttributes, htmlAttributesError, save, t };
}
