import { useEffect, useState } from "react";

/**
 * @file State/behavior for `JsonFieldControl` (`CollectionEntryEditor.tsx`) — a `json`-kind
 * dynamic field's own textarea buffer and parse gate, pulled out per this admin's "no functions or
 * derived logic in a .tsx file" rule.
 *
 * The textarea keeps its own local text buffer, independent of the parsed value the parent holds:
 * `onChange` only fires — and only ever fires with a value that parsed — when the current buffer
 * is valid JSON. An in-progress edit that is momentarily invalid JSON (a half-typed bracket, a
 * trailing comma) never reaches the parent's `extFields` state, so the last *valid* value stays
 * there untouched until the buffer parses again. This is what keeps a save mid-edit from silently
 * replacing the field's stored value with `undefined` or a parse failure.
 *
 * M2 fix: that "last valid value stays untouched" behavior used to be invisible to `save()` — a
 * mid-edit invalid buffer still let Save report "Saved · version N", writing the last-valid value
 * for text the operator can see is broken. `setFieldValidity` (`useCollectionEntryEditor`'s own
 * new field, keyed by `fieldName`) reports this buffer's parse validity up to the entry editor,
 * which now refuses to save at all while any field reports invalid — see that hook's own header.
 */

/** Renders `value` as the textarea's initial buffer. `undefined` (no stored value yet) prints as
 *  `"null"` — the same way a `json`-kind field with nothing stored round-trips through the server. */
function stringifyFieldValue({ value }: { value: unknown }, _optional = {}): string {
  return JSON.stringify(value === undefined ? null : value, null, 2);
}

export interface JsonFieldControlState {
  /** The textarea's current buffer — may be invalid JSON mid-edit. */
  text: string;
  /** True while `text` does not currently parse as JSON. Reflects the BUFFER, not the last value
   *  handed to `onChange` — the stored value is never in an invalid state. */
  parseError: boolean;
  /** The textarea's `onChange` handler: always updates the buffer, and forwards the parsed value
   *  to `onChange` only when the buffer parses. */
  handleTextChange: (required: { nextText: string }, optional?: Record<string, never>) => void;
}

/**
 * @complexity O(n) in the edited text's length once per call (`JSON.parse`); state is a single
 * string buffer plus a boolean flag, not a growing history.
 */
export function useJsonFieldControl(props: {
  value: unknown;
  onChange: (value: unknown) => void;
  /** This field's own schema name — the key `setFieldValidity` reports under. */
  fieldName: string;
  /** Reports this buffer's current parse validity up to `useCollectionEntryEditor`, keyed by
   *  `fieldName` — see that hook's own header for how it gates `save()`/Publish. */
  setFieldValidity: (fieldName: string, valid: boolean) => void;
}): JsonFieldControlState {
  const { fieldName, setFieldValidity } = props;
  const [text, setText] = useState(() => stringifyFieldValue({ value: props.value }));
  const [parseError, setParseError] = useState(false);

  // A field that unmounts (e.g. the content type's schema changed under an open editor, dropping
  // this field) must not leave a stale "invalid" flag behind forever — nothing will ever call
  // `setFieldValidity(fieldName, true)` again for it once it's gone, which would permanently block
  // Save on a field that no longer even renders.
  useEffect(() => () => setFieldValidity(fieldName, true), [fieldName, setFieldValidity]);

  function handleTextChange({ nextText }: { nextText: string }, _optional = {}) {
    setText(nextText);
    let parsed: unknown;
    try {
      parsed = JSON.parse(nextText);
    } catch {
      setParseError(true);
      setFieldValidity(fieldName, false);
      return;
    }
    setParseError(false);
    setFieldValidity(fieldName, true);
    props.onChange(parsed);
  }

  return { text, parseError, handleTextChange };
}
