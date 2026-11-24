import { useRef, useState } from "react";

import { useFetchMutation } from "../../../react/kit.js";
import { addDraftField, emptyField, KEYS, removeDraftField, stripDraftFieldRowIds, updateDraftField, validateNewContentTypeDraft, type DraftField } from "../rules.js";
import type { CollectionsHostKit } from "../collections-host-kit.js";
import type { NewContentTypeDialogPort } from "./new-content-type-dialog-port.hooks.js";

/**
 * @file `NewContentTypeDialog`'s own state and submit action (design-spec.md §1.3), so the dialog
 * in `Collections.tsx` is only markup.
 *
 * Extracted verbatim — same state, same validation order, same error strings. Draft-field list
 * editing (`updateField`/`removeField`/`addField`) and the row-id counter it depends on now live in
 * `rules.ts`, shared with `use-edit-fields-dialog.hooks.ts` — see that file's header for why the
 * counter has to stay a single shared instance rather than one per hook.
 *
 * Naming follows `hooks/use-settings-slice.hooks.ts`: `use-<thing>.hooks.ts`. Feature-local because
 * nothing outside `features/collections` needs it.
 *
 * `port`/`locale` are injected — see `new-content-type-dialog-port.hooks.ts` — rather than reaching
 * `lib/api`/`useAdminLocale()` directly, so a test can describe the submit outcome against
 * `createFakeNewContentTypeDialogPort` instead of stubbing global `fetch`.
 * The host's `useWiredNewContentTypeDialog` is the pair `Collections.tsx` actually mounts.
 *
 * `@jini-ai/ui/fetch-query` migration (2026-08-12): `createContentType` is a `useFetchMutation` that
 * `invalidates: [KEYS.list]` instead of `props.onCreated`'s caller (`Collections.tsx`) reloading by
 * hand.
 */

export interface NewContentTypeDialogController {
  label: string;
  setLabel: (value: string) => void;
  key: string;
  setKey: (value: string) => void;
  fields: DraftField[];
  updateField: (required: { rowId: number; patch: Partial<DraftField> }, optional?: Record<string, never>) => void;
  removeField: (required: { rowId: number }, optional?: Record<string, never>) => void;
  addField: () => void;
  error: string | null;
  saving: boolean;
  submit: (e: React.FormEvent) => void;
  /** Backdrop/Cancel/Escape all route here instead of `props.onCancel` directly — a no-op while
   * `createContentType` is in flight, so those dismiss paths can't unmount the dialog out from
   * under its own pending write (H4). */
  cancel: () => void;
}

export interface NewContentTypeDialogDependencies {
  port: NewContentTypeDialogPort;
  locale: string;
  /** The host's collections dictionary and request-error copy — see `collections-host-kit.ts`. */
  kit: CollectionsHostKit;
}

export function useNewContentTypeDialog(
  { props, port, locale, kit }: {
    props: {
      onCreated: () => void;
      onCancel: () => void;
    };
  } & NewContentTypeDialogDependencies,
  _optional: Record<string, never> = {},
): NewContentTypeDialogController {
  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [fields, setFields] = useState<DraftField[]>(() => [emptyField({ kit })]);
  const [validationError, setValidationError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  function cancel() {
    if (inFlightRef.current) return;
    props.onCancel();
  }

  const createMutation = useFetchMutation({
    run: ({ input }: { input: { key: string; label: string; fields: ReturnType<typeof stripDraftFieldRowIds> } }) =>
      port.createContentType(input),
  }, {
    invalidates: [KEYS.list],
  });

  function updateField({ rowId, patch }: { rowId: number; patch: Partial<DraftField> }, _optional = {}) {
    setFields((current) => updateDraftField({ fields: current, rowId, patch }));
  }

  function removeField({ rowId }: { rowId: number }, _optional = {}) {
    setFields((current) => removeDraftField({ fields: current, rowId }));
  }

  function addField() {
    setFields((current) => addDraftField({ fields: current, kit }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setValidationError(null);

    const draftError = validateNewContentTypeDraft({ draft: { key, label, fields }, kit }, { locale });
    if (draftError) {
      setValidationError(draftError);
      return;
    }

    inFlightRef.current = true;
    try {
      await createMutation.mutate({ input: {
        key: key.trim(),
        label: label.trim(),
        fields: stripDraftFieldRowIds({ fields }),
      } });
      props.onCreated();
    } catch {
      // already surfaced through createMutation.error -> error below
    } finally {
      inFlightRef.current = false;
    }
  }

  const saving = createMutation.status === "pending";
  const error = validationError ?? (createMutation.error ? kit.describeApiError({ e: createMutation.error, fallback: kit.translate({ locale: locale, key: "Failed to create content type" }) }) : null);

  return { label, setLabel, key, setKey, fields, updateField, removeField, addField, error, saving, submit, cancel };
}

