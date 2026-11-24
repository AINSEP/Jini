/**
 * @file Whether a TipTap editor instance can still take commands.
 *
 * `@tiptap/react`'s `useEditor` can replace its instance after mount: the instance manager schedules
 * a 1 ms destroy when it is built, and if the component's effects run later than that, the first
 * instance is destroyed and a new one is created. Any closure that kept the first instance then hits
 * `editor.commands` on a destroyed editor, which throws "Cannot read properties of null (reading
 * 'commands')" (client report 2026-11-21: a post opened with that message and an empty body).
 */

/** Structural slice of the host's TipTap `Editor`: only the public `schema` this check reads. */
export interface LiveEditorCandidate {
  readonly schema: unknown;
}

/**
 * True when `args.editor` exists and has not been destroyed. TipTap 3's `destroy()` nulls the command
 * manager and the public `schema` together, so `schema` is the public signal. `isDestroyed` cannot be
 * used: it also reads `true` for an editor that is not attached to a view yet, which is every editor
 * before `EditorContent` mounts it.
 * The guard narrows the ARGUMENT OBJECT (`args.editor` becomes non-null), not a caller's variable —
 * keep the object in a local (`const target = { editor }`) and read `target.editor` after the check.
 * @param args.editor - The editor instance to check; `null`/`undefined` count as not live.
 * @complexity O(1).
 */
export function isLiveEditor<E extends LiveEditorCandidate>(
  args: { editor: E | null | undefined },
  _optional: Record<string, never> = {},
): args is { editor: E } {
  return args.editor != null && (args.editor.schema as unknown) !== null;
}
