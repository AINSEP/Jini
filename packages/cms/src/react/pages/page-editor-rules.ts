/** The page editor's main-pane view toggle (structurally the host editor's own `PageEditorView`). */
export type PageEditorView = "preview" | "html" | "interactive";

/**
 * Which surface the editor's main pane shows, as a discriminated value rather than a chain of
 * nested ternaries inside `PageEditor.tsx`'s JSX (2026-09-06 complexity-ceiling pass — that chain
 * was 6 of `PageEditor`'s 10 cognitive-complexity points against a ceiling of 9, and tripped
 * `sonarjs/no-nested-conditional` twice on top of it).
 *
 * The `interactive` case CARRIES the resolved {@link CanvasStyling} rather than leaving the caller
 * to re-narrow `ThemeCanvasStylingState` itself. That is the whole reason this returns a union
 * instead of a bare `"preview" | "html" | ...` string: the narrowing happens once, here, where
 * TypeScript can see it, so the component never needs a cast to reach `styling` — and a stringly
 * result would have forced exactly that (or a duplicated `status === "pending"` check in the view,
 * which is the tangle this replaces).
 *
 * `interactive-pending` is a real state, not a loading placeholder that could be skipped:
 * `InteractiveHtmlEditor` reads its canvas styling ONCE at mount and never reacts to a later value,
 * so mounting it before the theme's token files settle produces a permanently unstyled canvas. See
 * `PageEditorController.canvasStyling`'s own doc.
 *
 * @complexity Time/space: O(1) — three ordered checks, no iteration.
 */
export type PageEditorSurface<Styling = unknown> =
  | { kind: "preview" }
  | { kind: "html" }
  | { kind: "interactive-pending" }
  | { kind: "interactive"; styling: Styling };

export function pageEditorSurface<Styling>({ view, canvasStyling }: { view: PageEditorView; canvasStyling: { status: "pending" } | { status: "ready"; styling: Styling } }, _optional: Record<string, never> = {}): PageEditorSurface<Styling> {
  if (view === "preview") return { kind: "preview" };
  if (view === "html") return { kind: "html" };
  if (canvasStyling.status === "pending") return { kind: "interactive-pending" };
  return { kind: "interactive", styling: canvasStyling.styling };
}
