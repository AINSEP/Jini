import type { JsonObject, JsonValue } from "@jini-ai/core/primitives";

/**
 * @file Template-tree renderer for the public site (SPEC-004 spike slice).
 *
 * Purpose:
 * Turns a discovered declarative theme + page context into HTML. Resolves the
 * route to a template id, walks the template's JSON block tree, and renders
 * three node kinds: content doc nodes (TipTap/ProseMirror vocab), `slot` nodes
 * (context-filled), and `component` nodes (resolved against a core component
 * registry). No theme code executes — the theme is data.
 *
 * How it relates to the project:
 * - Used by the host's public site page routes.
 * - Theme look switches with the presentation feature's `activeThemeId`; the
 *   route resolves that id to a `DiscoveredTheme` and passes it here.
 *
 * Spike scope (VibeCoder): the four v1 core components + three slots, no theme
 * settings, no per-block sanitization. The blessed React renderer (ADR-002) can
 * replace this implementation without touching themes.
 */

export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// --- Prop readers (templates are untrusted-ish data — read defensively) ---

export function str({ value }: { value: JsonValue | undefined }, { fallback = "" }: { fallback?: string } = {}): string {
  return typeof value === "string" ? value : fallback;
}

export function arr({ value }: { value: JsonValue | undefined }, _optional = {}): JsonValue[] {
  return Array.isArray(value) ? value : [];
}

export function obj({ value }: { value: JsonValue | undefined }, _optional = {}): JsonObject | undefined {
  return isObject(value) ? value : undefined;
}
