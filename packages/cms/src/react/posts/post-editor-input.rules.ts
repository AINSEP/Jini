

/**
 * @file Pure logic for the `posts` feature — everything that computes a value rather than rendering
 * one.
 *
 * Named `rules.ts` to match the convention `@jini-ai/chat` already uses for the same job
 * (`features/chat-pane/rules.ts`, `model picker rules`): the slice's decisions live in
 * one importable, directly testable module with no React in it.
 *
 * The bar for landing here is "does it compute something", not "is it rendered". A function that
 * builds a menu array is logic even though a menu is drawn from it — leaving it inside the
 * component only means the branch can be reached exclusively by rendering a table and opening a
 * popover, which is how a `post.status` conditional ends up permanently untested.
 */

/** Reads a browser `File` into a full `data:` URL (mirrors Media.tsx's upload helper, but keeps the
 *  prefix).
 *
 * Used by `use-post-editor.hooks.ts`'s `uploadDroppedFile` (2026-08-12, B1) as the read step before
 * uploading a dropped/pasted file — the prefix is stripped there to get the bare base64 payload
 * `api.uploadMedia` wants. No longer used by {@link handleImageDrop} below (which used to inline the
 * result straight into `bodyJson` as a `data:` URL — see that function's own doc for why that path
 * was replaced rather than kept as a fallback).
 *
 * @complexity Time: O(n) in file bytes; space: O(n) for the base64 result, which is ~1.33x the input.
 */
export function readFileAsDataUrl({ file, deps }: { file: File; deps: { createReader: () => {
  result: string | ArrayBuffer | null; error: unknown;
  onerror: ((event: ProgressEvent<FileReader>) => void) | null;
  onload: ((event: ProgressEvent<FileReader>) => void) | null;
  readAsDataURL: (file: Blob) => void;
} } }, _optional = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = deps.createReader();
    reader.onerror = () => reject(reader.error ?? new Error("failed to read file"));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });
}

/**
 * The dropped resource's own URI, read from whichever `DataTransfer` format carries it.
 *
 * `text/uri-list` wins over `text/plain` when a drag source offers both (e.g. dragging an image out
 * of another browser tab populates both formats with the same URL) — the list format is the
 * standard's intended carrier, plain text is the fallback for sources that only set that. Extracted
 * out of {@link handleImageDrop} so this precedence and the trim are independently testable and no
 * longer count toward that function's own branch count.
 */
export function droppedUri({ dataTransfer }: { dataTransfer: DataTransfer | null }, _options: Record<string, never> = {}): string {
  return (dataTransfer?.getData("text/uri-list") || dataTransfer?.getData("text/plain") || "").trim();
}

/**
 * Maps the slug-collision override `<select>`'s string value to the tri-state `overridesThemePage`
 * it represents — see `PostEditorController.overridesThemePage`'s own doc for the full tri-state
 * contract this mirrors. Split out as a pure function (2026-08-20, UI-subhook pass, `PostEditor.tsx`
 * complexity-ceiling work) so this mapping has exactly ONE implementation, shared by
 * `usePostEditorUi` (`hooks/use-post-editor-ui.hooks.ts`) and that hook's own test fixture, rather
 * than being hand-typed a second time wherever a test needs to drive the same control.
 */
export function overridesThemePageFromSelectValue({ value }: { value: string }, _options: Record<string, never> = {}): boolean | null {
  if (value === "default") return null;
  return value === "post";
}

/** The inverse of {@link overridesThemePageFromSelectValue}: the `<select>` value for a tri-state. */
export function overridesThemePageSelectValue({ overridesThemePage }: { overridesThemePage: boolean | null }, _options: Record<string, never> = {}): "default" | "post" | "theme" {
  if (overridesThemePage === null) return "default";
  return overridesThemePage ? "post" : "theme";
}

/** A toolbar button's className for its active/inactive state — the one thing repeated across every
 *  formatting button in `PostEditor.tsx`'s `Toolbar`. Extracted so the eleven
 *  `${active ? " on" : ""}` ternaries that used to live inline in `Toolbar`'s JSX (its entire branch
 *  count) collapse to eleven calls to this one single-branch function instead. */
export function toolbarBtnClass({ active }: { active: boolean }, _options: Record<string, never> = {}): string {
  return `tb-btn${active ? " on" : ""}`;
}

/** A 6-digit hex color if `value` is one, else `fallback` — display-only normalization for the
 *  color/background-color `<input type="color">` swatches in `Toolbar` (2026-08-11): a native color
 *  input can only ever SHOW a strict 6-digit hex, but the active mark's own `color` attr can be
 *  `null` (nothing picked yet) or a non-hex CSS value the editor inherited some other way (pasted
 *  `rgb(...)`/a keyword like `"red"`). Purely cosmetic — it decides what the swatch looks like, not
 *  what gets applied on change (`chain().setColor(e.target.value)` always reads straight off the
 *  native input, which itself can only ever emit a valid hex). */
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
export function hexOrDefault({ value, fallback }: { value: string | null; fallback: string }, _options: Record<string, never> = {}): string {
  return value !== null && HEX_COLOR_PATTERN.test(value) ? value : fallback;
}

// ---------------------------------------------------------------------------
// Font family/size, line height (2026-08-11) — closed preset lists for `Toolbar`'s three
// `<select>` controls. A fixed list rather than free text: it's easier to use than typing a raw
// CSS value, and every value it can produce already passes `render.ts`'s own
// `safeCssFontFamily`/`safeCssLength` allowlist by construction, so an author can never end up
// with a "valid in the editor, silently dropped on publish" surprise from a typo. `""` is the
// shared "unset the attr" sentinel across all three — `Toolbar`'s onChange treats it that way, not
// as "set it to an empty string".
//
// The leading `value: ""` entry's LABEL (toolbar polish, 2026-08-11, owner: "is it possible to set
// the defaults to actual numbers so people can quickly understand what that is?") states the real
// resolved value rather than the word "Default" — three selects that all read "Default" tell an
// operator nothing about which is font/size/line-height, or what any of them currently produce.
// Verified live against a running admin (`getComputedStyle` on `.editor-body .tiptap p` in an
// actual browser, not read off the stylesheet by eye — a plausible-looking number here would be
// worse than "Default", since it would be confidently wrong): the editor's own baseline body text
// (a paragraph with NO explicit textStyle mark, i.e. exactly what `value: ""` represents) computes
// to `font-family: "DM Sans"`, `font-size: 16px`, `line-height: 1.6` (`.editor-body .tiptap p`'s
// own declared ratio in this same file). That baseline is deliberately NOT the published site's own
// body defaults (`.post-detail-body` in `the basic theme stylesheet`: 17px/1.7,
// no family override so it also inherits `--font-ui`/DM Sans) — the editor was never meant to be
// pixel-parity WYSIWYG for size/line-height, only for the content itself, so this label states what
// the CONTROL currently shows on screen, not a promise about the published page.
//
// Suffixed `" (Default)"` rather than bare "16"/"1.6"/"DM Sans" — `FONT_SIZE_OPTIONS` already has a
// real preset at exactly `16px`, and a native `<select>` with two options both reading bare "16"
// (one `value=""`, one `value="16px"`) is indistinguishable to a sighted user and ambiguous to a
// screen reader, even though they mean different things (leave the attribute unset vs. bake in an
// explicit 16px). The suffix keeps the entry unique while still stating the real number.
// ---------------------------------------------------------------------------

/** One `<option>` for a `Toolbar` preset `<select>` — `value: ""` is always the leading entry
 *  (labeled with the real resolved default, see the block comment above), matching `PostEditor.tsx`'s
 *  own template-picker precedent (`availableTemplates.map`'s "No template chosen" as the deliberate
 *  final/first option, not a coerced `null`). */
export interface ToolbarSelectOption {
  label: string;
  value: string;
}

export const FONT_FAMILY_OPTIONS: readonly ToolbarSelectOption[] = [
  { label: "DM Sans (Default)", value: "" },
  { label: "Sans-serif", value: "ui-sans-serif, system-ui, sans-serif" },
  { label: "Serif", value: "ui-serif, Georgia, serif" },
  { label: "Monospace", value: "ui-monospace, 'SF Mono', monospace" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Arial", value: "Arial, sans-serif" },
  { label: "Courier New", value: "'Courier New', monospace" },
];

export const FONT_SIZE_OPTIONS: readonly ToolbarSelectOption[] = [
  { label: "16 (Default)", value: "" },
  { label: "12", value: "12px" },
  { label: "14", value: "14px" },
  { label: "16", value: "16px" },
  { label: "18", value: "18px" },
  { label: "20", value: "20px" },
  { label: "24", value: "24px" },
  { label: "32", value: "32px" },
  { label: "48", value: "48px" },
];

export const LINE_HEIGHT_OPTIONS: readonly ToolbarSelectOption[] = [
  { label: "1.6 (Default)", value: "" },
  { label: "1", value: "1" },
  { label: "1.15", value: "1.15" },
  { label: "1.5", value: "1.5" },
  { label: "1.75", value: "1.75" },
  { label: "2", value: "2" },
];

/**
 * Code block language picker (2026-08-11, coordinator MSG #1) — every `value` here is one of
 * lowlight's own `common` grammar set's registered keys (`use-post-editor.hooks.ts`'s
 * `createLowlight(common)`), so picking any option always produces REAL in-editor highlighting,
 * never a silent "unrecognized language, falls back to plain text" surprise. `"xml"` is the actual
 * registered `highlight.js` grammar key for HTML (aliases like `"html"` are resolved by
 * `highlight.js`'s own internal alias table, which lowlight's `registered()`/`listLanguages()`
 * checks do NOT consult — verified against the installed dist rather than assumed), so the option
 * is labeled "HTML" but stores the key lowlight actually has registered.
 */
export const CODE_LANGUAGE_OPTIONS: readonly ToolbarSelectOption[] = [
  { label: "Plain text", value: "plaintext" },
  { label: "JavaScript", value: "javascript" },
  { label: "TypeScript", value: "typescript" },
  { label: "Python", value: "python" },
  { label: "Bash", value: "bash" },
  { label: "JSON", value: "json" },
  { label: "HTML", value: "xml" },
  { label: "CSS", value: "css" },
  { label: "SQL", value: "sql" },
  { label: "Java", value: "java" },
  { label: "Go", value: "go" },
  { label: "Rust", value: "rust" },
  { label: "Ruby", value: "ruby" },
  { label: "PHP", value: "php" },
  { label: "YAML", value: "yaml" },
  { label: "Markdown", value: "markdown" },
];

/**
 * Drag-and-drop image support for a URL dragged in from elsewhere (e.g. an image dragged out of
 * another browser tab) — the dropped resource's own URI is inserted as a legacy `src`-only image
 * node, unchanged; `render.ts`'s `"image"` case still degrades an untrusted `src` to the public-safe
 * placeholder, same as it always has for this shape.
 *
 * A dropped LOCAL FILE is deliberately NOT handled here (2026-08-12, B1 — file-handler drag/paste
 * upload). It used to be inlined as a `data:` URL straight into `bodyJson` (a real memory cost —
 * `readFileAsDataUrl`'s own doc), which `@tiptap/extension-file-handler`'s `onDrop` now supersedes:
 * it uploads through the real media-library path and inserts the SAME ref-based
 * `{assetId, transformName}` node the Media picker produces (`use-post-editor.hooks.ts`'s
 * `handleFileDrop`). This function returning `false` for a file drop is load-bearing, not a gap —
 * `handleDrop` set directly on `useEditor`'s `editorProps` (this function) runs BEFORE any
 * extension-registered ProseMirror plugin's own `handleDrop` (confirmed against `prosemirror-view`'s
 * `EditorView.someProp`: direct view props are tried first, plugin props only if every direct prop
 * returns nothing), so this function returning `true` for a file drop would make FileHandler's own
 * `onDrop` permanently unreachable for local files — a silent regression of the exact "editor works,
 * public site doesn't" shape this whole file's own render-contract discipline exists to catch,
 * except this one would have broken in the OTHER direction (a feature that never fires at all).
 *
 * Returns `true` when it consumed the drop, which is what tells ProseMirror not to apply its own
 * default handling — the return value is the contract, and it is why this is worth having out here
 * where a test can drive it with a fake `EditorView` instead of a real editor and a real drag.
 *
 * @complexity Time/space: O(1) — a single `DataTransfer` read, no iteration.
 */
export function handleImageDrop({ view, event, moved, deps }: { view: unknown; event: DragEvent; moved: boolean; deps: { insertImageAtDrop: (required: { view: unknown; event: DragEvent; src: string }) => boolean } }, _options: Record<string, never> = {}): boolean {
  if (moved) return false; // internal content reorder, not an external drop

  const uri = droppedUri({ dataTransfer: event.dataTransfer ?? null });
  if (/^https?:\/\//i.test(uri)) {
    event.preventDefault();
    return deps.insertImageAtDrop({ view, event, src: uri });
  }

  return false;
}

// ---------------------------------------------------------------------------
// Post-title-in-document (2026-08-11) — see `lib/post-title-extension.ts`'s file header for the
// feature this pair of pure functions belongs to and why the title lives in `bodyJson` at all.
// ---------------------------------------------------------------------------

/** Loose TipTap JSON node shape — same "typed loosely, never TipTap's `JSONContent`" convention
 *  `PostFormState.bodyJson`'s own doc states, since these two functions only ever read/build a few
 *  known keys, never the full node vocabulary. */
type LooseNode = { type?: unknown; content?: unknown; attrs?: unknown; text?: unknown };

function isLooseNode(value: unknown): value is LooseNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A `title`-type node carrying `text` as its sole content — `[]` (no text child) when `text` is
 *  empty, matching how TipTap represents an empty node (an empty `content` array, never a text node
 *  with `text: ""`, which ProseMirror's own schema rejects). */
function titleNode({ text }: { text: string }, _options: Record<string, never> = {}): LooseNode {
  return { type: "title", content: text ? [{ type: "text", text }] : [] };
}

/**
 * Ensures `bodyJson` starts with a `title` node — the post-title-in-document feature's back-compat
 * seam. Every post saved before this feature has a `bodyJson` with no `title` node at all (the
 * editor's custom `doc` schema, `content: "title block+"`, would reject loading it as-is), so the
 * editor's load effect (`use-post-editor.hooks.ts`) runs every `bodyJson` through this FIRST:
 *
 *  - Already migrated (first content node is already `type: "title"`): passed through unchanged
 *    when its text already equals `title`; otherwise only the title node's text is replaced with
 *    `title` (the stored field is authoritative — see the 11-01 note in the body).
 *  - Anything else: a title node synthesized from the post's own (pre-existing) `title` field is
 *    prepended, with a single empty paragraph appended when the source had no block content at all
 *    (a brand-new post's empty `bodyJson`, or any other doc with no blocks) — `"title block+"`
 *    requires at least one block, and a post can otherwise be entirely blank.
 *
 * Idempotent and side-effect-free — safe to call on every load regardless of whether migration is
 * actually needed, so the caller never has to detect that itself.
 *
 * @complexity O(n) in `bodyJson`'s own top-level content length (one array copy/prepend, no
 * recursion into nested content).
 */
export function withTitleNode({ bodyJson, title }: { bodyJson: unknown; title: string }, _options: Record<string, never> = {}): LooseNode {
  const doc = isLooseNode(bodyJson) ? bodyJson : null;
  const content = doc && Array.isArray(doc.content) ? doc.content : [];
  const first = content[0];
  if (isLooseNode(first) && first.type === "title") {
    if (titleNodeText({ bodyJson: doc }) === title) return doc as LooseNode;
    // The stored title wins (owner bug 11-01): the assistant/API can rename a post without
    // rewriting its body's title node, and keeping the stale node let the editor's `onUpdate`
    // flip `title` back to it — dirty on open, "Leave site?" on exit, a Save reverting the rename.
    // Only the text changes; the node's attrs (alignment) and every other block are kept.
    return { ...(doc as LooseNode), content: [{ ...first, content: titleNode({ text: title }).content }, ...content.slice(1)] };
  }

  const blocks = content.length > 0 ? content : [{ type: "paragraph" }];
  return { type: "doc", content: [titleNode({ text: title }), ...blocks] };
}

/**
 * The current title node's plain text, read out of a live `editor.getJSON()` snapshot — the
 * in-canvas-edit half of the title's two-way sync with the standalone title `<input>` (see
 * `use-post-editor.hooks.ts`'s `onUpdate`). `""` when the doc's first child isn't a `title` node —
 * not expected once `withTitleNode` has run once, but kept total rather than throwing on a malformed
 * snapshot, same defensive posture every other reader in this module takes on `bodyJson`.
 *
 * @complexity O(t) in the title node's own inline content length.
 */
export function titleNodeText({ bodyJson }: { bodyJson: unknown }, _options: Record<string, never> = {}): string {
  const doc = isLooseNode(bodyJson) ? bodyJson : null;
  const content = doc && Array.isArray(doc.content) ? doc.content : [];
  const first = content[0];
  if (!isLooseNode(first) || first.type !== "title") return "";
  const inner = Array.isArray(first.content) ? first.content : [];
  return inner.map((n) => (isLooseNode(n) && typeof n.text === "string" ? n.text : "")).join("");
}

/** Whether the editor shows the cover-image slot above the title node: only for a TipTap body
 *  (`bodyFormat` "doc", the default when absent), never an html page. @complexity O(1). */
export function showsCoverImageSlot({ bodyFormat }: { bodyFormat: "doc" | "html" | undefined }, _options: Record<string, never> = {}): boolean {
  return (bodyFormat ?? "doc") === "doc";
}

/** Whether the cover slot carries the "Hide the cover image in the body" toggle (owner, 2026-10-11,
 *  moved there from the settings modal's Image tab): posts only, as it was in that tab.
 *  @complexity O(1). */
export function showsHideCoverInBodyToggle({ kind }: { kind: "post" | "page" }, _options: Record<string, never> = {}): boolean {
  return kind === "post";
}

