import { expect, expectTypeOf, it } from "vitest";
import { pageEditorSurface, type PageEditorSurface } from "../page-editor-rules.js";

it("preserves host styling identity while selecting each editor surface", () => {
  const styling = { hostToken: Symbol("styling") };
  const ready = { status: "ready" as const, styling };
  const interactive = pageEditorSurface({ view: "interactive", canvasStyling: ready });
  expectTypeOf(interactive).toEqualTypeOf<PageEditorSurface<typeof styling>>();
  expectTypeOf<PageEditorSurface>().toEqualTypeOf<PageEditorSurface<unknown>>();
  expect(interactive).toEqual({ kind: "interactive", styling });
  if (interactive.kind !== "interactive") throw new Error("Expected interactive surface");
  expect(interactive.styling).toBe(styling);
  expect(pageEditorSurface({ view: "preview", canvasStyling: ready })).toEqual({ kind: "preview" });
  expect(pageEditorSurface({ view: "html", canvasStyling: ready })).toEqual({ kind: "html" });
  expect(pageEditorSurface({ view: "interactive", canvasStyling: { status: "pending" } })).toEqual({ kind: "interactive-pending" });
});
