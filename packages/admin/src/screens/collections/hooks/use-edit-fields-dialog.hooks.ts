import { useRef, useState } from "react";

import type { AdminContentType } from "../api/collections-api.types.js";
import { useFetchMutation } from "../../../react/kit.js";
import { addDraftField, describeEditFieldsError, draftFieldsFromContentType, KEYS, removeDraftField, stripDraftFieldRowIds, updateDraftField, validateEditFieldsDraft, type DraftField } from "../rules.js";
import type { CollectionsHostKit } from "../collections-host-kit.js";
import type { EditFieldsDialogPort } from "./edit-fields-dialog-port.hooks.js";

import { type Translate } from '@jini-ai/core/text';
/**
 * @file `EditFieldsDialog`'s own state and submit action (SPEC-037 REQ-05 — post-creation
 * field-schema editing), so the dialog in `Collections.tsx` is only markup.
 *
 * Extracted verbatim — same state, same validation, same `409`-vs-generic error split (now
 * `describeEditFieldsError` in `rules.ts`). Draft-field list editing shares `rules.ts` helpers
 * with `use-new-content-type-dialog.hooks.ts`, including the row-id counter — see that module's
 * header for why it has to stay one shared instance.
 *
 * Naming follows `hooks/use-settings-slice.hooks.ts`: `use-<thing>.hooks.ts`. Feature-local because
 * nothing outside `features/collections` needs it.
 *
 * `port` is injected — see `edit-fields-dialog-port.hooks.ts` — rather than importing `lib/api`
 * directly, so a test can describe the submit outcome against `createFakeEditFieldsDialogPort`
 * instead of stubbing global `fetch`. The host's `useWiredEditFieldsDialog` is the pair `Collections.tsx`
 * actually mounts. No `locale`/`useAdminLocale` here — `describeEditFieldsError` never resolves a
 * translated string (unlike `use-new-content-type-dialog.hooks.ts`'s `t(locale, ...)` fallback).
 *
 * `@jini-ai/ui/fetch-query` migration (2026-08-12): `updateContentTypeFields` is a `useFetchMutation` that
 * `invalidates: [KEYS.list]` — a field-schema change affects the content-type list AND every entries
 * list/entry editor nested under it (`rules.ts`'s `KEYS` doc), matching what `props.onSaved`'s caller
 * (`Collections.tsx`, via `load`) used to refresh by hand.
 */

export interface EditFieldsDialogController {
  fields: DraftField[];
  updateField: (required: { rowId: number; patch: Partial<DraftField> }, optional?: Record<string, never>) => void;
  removeField: (required: { rowId: number }, optional?: Record<string, never>) => void;
  addField: () => void;
  error: string | null;
  saving: boolean;
  submit: (e: React.FormEvent) => void;
  /** Backdrop/Cancel/Escape all route here instead of `props.onCancel` directly — a no-op while
   * `updateContentTypeFields` is in flight, so those dismiss paths can't unmount the dialog out
   * from under its own pending write (H4). */
  cancel: () => void;
}

export function useEditFieldsDialog(
  { props, port, kit }: {
    props: { contentType: AdminContentType; onSaved: () => void; onCancel: () => void };
    port: EditFieldsDialogPort;
    /** The host's collections dictionary and request-error copy — see `collections-host-kit.ts`. */
    kit: CollectionsHostKit;
  },
  options: { t?: Translate } = {},
): EditFieldsDialogController {
  const t = options.t ?? ((key: string) => key);
  const [fields, setFields] = useState<DraftField[]>(() => draftFieldsFromContentType({ fields: props.contentType.fields, kit }));
  const [validationError, setValidationError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  function cancel() {
    if (inFlightRef.current) return;
    props.onCancel();
  }

  const updateFieldsMutation = useFetchMutation({
    run: ({ input }: { input: { key: string; fields: ReturnType<typeof stripDraftFieldRowIds>; expectedVersion: number } }) =>
      port.updateContentTypeFields(input),
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

    const draftError = validateEditFieldsDraft({ fields, kit }, { localeOrTranslate: t });
    if (draftError) {
      setValidationError(draftError);
      return;
    }

    inFlightRef.current = true;
    try {
      await updateFieldsMutation.mutate({ input: {
        key: props.contentType.key,
        fields: stripDraftFieldRowIds({ fields }),
        expectedVersion: props.contentType.version,
      } });
      props.onSaved();
    } catch {
      // already surfaced through updateFieldsMutation.error -> error below
    } finally {
      inFlightRef.current = false;
    }
  }

  const saving = updateFieldsMutation.status === "pending";
  const error = validationError ?? (updateFieldsMutation.error ? describeEditFieldsError({ e: updateFieldsMutation.error, kit }, { localeOrTranslate: t }) : null);

  return { fields, updateField, removeField, addField, error, saving, submit, cancel };
}

