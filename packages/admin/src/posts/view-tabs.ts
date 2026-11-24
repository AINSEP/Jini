/** The two things the editor's main pane can show — the rich-text editor, or a rendered preview
 *  of the post. Named for what an author sees, not the library underneath ("Tiptap" never appears
 *  in the UI) — mirrors the Page editor's `PageEditorView`, minus the HTML/Interactive tabs a
 *  `bodyJson`-based post has no equivalent of. */
export type PostEditorView = "edit" | "preview";

/** Product-facing labels, not library ones — "Tiptap" never appears in the UI; an author reads
 *  these as "the editor" and "how it looks on the site". */
export const VIEWS: ReadonlyArray<{ key: PostEditorView; label: string; handle: string; agentLabel: string }> = [
  // "Editor", not "Edit" (owner, 2026-08-11): the pair names two VIEWS of the same post, so both
  // labels should be nouns. "Edit" alongside "Preview" reads as a verb next to a noun, and collides
  // with the post-list row menu's own "Edit" ACTION (`rules.ts`), which does something different.
  //
  // `handle`/`agentLabel` (2026-09-15, preview-fullscreen dispatch) — these two tabs previously
  // carried no `agentHandle` at all, so `page.find_elements` never reported them and the assistant
  // could open a post's editor but never switch it to Preview. `agentLabel` names what each view
  // SHOWS (an agent reads it, never sees the tab), not the library ("Tiptap" never appears here
  // either) — same "product-facing, not implementation-facing" rule this file's own doc comment
  // states for `label`.
  { key: "edit", label: "Editor", handle: "post-view-edit", agentLabel: "Switch to the rich-text editor for this post" },
  { key: "preview", label: "Preview", handle: "post-view-preview", agentLabel: "Switch to a rendered preview of how this post looks on the site" },
];

/** {@link VIEWS} carrying the `id` that `TabBar.hooks.tsx`'s WAI-ARIA tabs helpers key on, so this
 *  hand-rolled `role="tablist"` row gets the same arrow/Home/End keys and roving tab stop `TabBar`
 *  and the Page editor's own view row have (a35ce9f12, 3da7686cc) without becoming a `<TabBar>`:
 *  the `.segmented` pill row is a different visual control, only the keyboard contract is shared.
 *  Spread, not rebuilt, so nothing in the JSX below has to change which field it reads. */
export const VIEW_TABS = VIEWS.map((entry) => ({ ...entry, id: entry.key }));
