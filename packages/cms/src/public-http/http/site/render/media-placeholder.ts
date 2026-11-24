import type { JsonObject } from "@jini-ai/core/primitives";
import { escapeHtml } from "@jini-ai/core/text";
import { str } from "./value-readers.js";
import { safeAspectRatio } from "../../../../html/style-values.js";

/** The class names a placeholder box and its label carry. A host input (not hard-coded): the host
 *  binds the names its own stylesheet targets, Jini only emits what it is handed. */
export interface PlaceholderClasses {
  readonly box: string;
  readonly label: string;
}

/**
 * A labelled aspect-ratio box standing in for an image (no asset pipeline yet).
 *
 * `ratio` goes through {@link safeAspectRatio}'s numeric-shape allowlist rather than `escapeHtml`:
 * `escapeHtml` only stops the value from breaking out of the `style="…"` attribute, not from
 * smuggling a second declaration while staying inside it (`"1;background:url(//evil.example)"`).
 * An unrecognized shape falls back to the same `"16 / 9"` default an absent `ratio` already used.
 * `architecture-p2-plan-2026-09-24.md` §D3.
 */
export function mediaPlaceholder({ props, classes }: { props: JsonObject; classes: PlaceholderClasses }, _optional = {}): string {
  const label = escapeHtml({ text: str({ value: props.label }, { fallback: "Image" }) });
  const ratio = safeAspectRatio({ value: str({ value: props.ratio }, { fallback: "" }) }) ?? "16 / 9";
  return `<figure class="${escapeHtml({ text: classes.box })}" style="aspect-ratio:${ratio}"><span class="${escapeHtml({ text: classes.label })}">${label}</span></figure>`;
}
