/** Structural mirror of the html editor's placeholder card descriptor (the host's editor renders it). */
export interface CanvasEmbedPlaceholderDescriptor {
  kindLabel: string;
  identityLabel: string;
  presentation?: "embed" | "runtime";
  guidanceLabel?: string;
}
import { hasAttributeOnAnyNodeShape } from "@jini-ai/core/primitives";
import type { AdminPagePluginEmbed } from "../api/pages-api.types.js";

import { type Translate } from '@jini-ai/core/text';
/**
 * @file Bug A (2026-09-23 interactive-bugs plan, Slice A2): the host-specific adapter
 * `PageEditor.tsx` (Slice A3) hands to `@jini-ai/ui/html-editor`'s generic `InteractiveHtmlEditor` as
 * `isProtectedElement`/`describeEmbedPlaceholder` — the same two-function shape Jini's own
 * `InteractiveHtmlEditor.tsx` adapter used to supply from inside the Jini package. Moving it here lets
 * this describer read `@jini-ai/cms/widgets/markers`'s `parseEmbedMarkerConfig`/`embedMarkerTarget` (Slice A1)
 * (the host injects both through {@link EmbedMarkerReaders}, so this package never imports the CMS)
 * directly instead of Jini's adapter carrying its own second copy of "which key names the target" —
 * see the root-cause report (`ADS-memory/.local-artifacts/pages-redo-2026-09-23/interactive-bugs-plan.md`,
 * Bug A) for why that second copy is exactly what produced "Placeholder — Widget / no id set" for a
 * marker addressed by `slug`.
 */

/** Which key names a marker's target — structural mirror of `@jini-ai/cms/widgets/markers`'s `EmbedMarkerTarget`. */
export type EmbedMarkerTarget =
  | { readonly key: "id" | "slug" | "typeKey" | "plugin"; readonly value: string }
  | { readonly key: "none" };

/**
 * The two marker readers the host injects: `@jini-ai/cms/widgets/markers`'s `parseEmbedMarkerConfig`
 * and `embedMarkerTarget`, passed as-is. Injected (not imported) because `@jini-ai/admin` carries no
 * runtime dependency on `@jini-ai/cms`; see this folder's README `## Wiring`.
 */
export interface EmbedMarkerReaders {
  parseEmbedMarkerConfig: (required: { raw: string }) => { config: Record<string, unknown> } | { problem: unknown };
  embedMarkerTarget: (required: { type: string; config: Readonly<Record<string, unknown>> }) => EmbedMarkerTarget | undefined;
}

/** Every attribute that marks a Page HTML embed placeholder div: the current `data-embed-config`, and
 *  the legacy `data-embed-type`, `data-widget-embed` and `data-form-embed`. A matching element becomes
 *  the editor's protected type: one atomic block whose content can't be edited or dropped into, but
 *  which a click selects (rather than the block around it) and which can still be deliberately moved,
 *  copied or deleted. See `registerProtectedElementType` in `@jini-ai/ui/html-editor`. */
const EMBED_MARKER_ATTRIBUTES = ["data-embed-config", "data-embed-type", "data-widget-embed", "data-form-embed"] as const;

/** True when `el` carries any embed marker attribute this convention recognizes. Uses
 *  `hasAttributeOnAnyNodeShape` because this predicate is invoked from inside GrapesJS's
 *  `isComponent` callback, which is not always called with a real DOM `Element` — see that helper's
 *  own doc in `@jini-ai/ui/html-editor`. */
export function isProtectedEmbedElement(el: Element): boolean {
  return EMBED_MARKER_ATTRIBUTES.some((attr) => hasAttributeOnAnyNodeShape({ node: el, attribute: attr }));
}

/**
 * Friendly card heading, as a `t()` KEY, for every embed `type` value this codebase names. Reuses
 * "Content" — the one key `page-editor-i18n.ts` already routes to the Posts editor's own translator
 * (`postEditorKeys`) — rather than declaring a second, independently-translated copy of that exact
 * word. Every other key here is declared fresh in `page-editor-i18n.ts`'s markup dictionary.
 *
 * Covers the same set Jini's own adapter labeled (`media`/`widget`/`post`/`content`, the four types
 * `isPageEmbedType` accepts; `partial`/`menu`, theme-only but labeled defensively), plus the two types
 * that adapter could not know about because it never imported the shared marker-target rule:
 * `collection` and `post-previews`.
 */
const EMBED_KIND_LABEL_KEYS: Readonly<Record<string, string>> = {
  media: "Media",
  widget: "Widget",
  post: "Post",
  content: "Content",
  partial: "Partial",
  menu: "Menu",
  collection: "Collection",
  "post-previews": "Post previews",
};

/** Upper-cases just the first character — the fallback for a `type` {@link EMBED_KIND_LABEL_KEYS}
 *  doesn't (yet) name, so the card still reads as a word rather than a raw lower-case config value.
 *  Never routed through `t()`: an unrecognized type is a free string with no translation to look up,
 *  same as Jini's own adapter's identical `titleCase` fallback. */
function titleCase({ value }: { value: string }, _options = {}): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** How much of a target value (id/slug/typeKey) to show before truncating with an ellipsis — long
 *  enough that two real values are still visually distinct, short enough the card stays a small chip.
 *  32, not Jini's own adapter's 8-character `ID_PREVIEW_LENGTH`: that bound was sized for a raw id
 *  preview only; a slug is authored to be human-readable (`"contact-form"`), so truncating it as
 *  aggressively as an opaque id would defeat the point of showing it at all. */
const TARGET_VALUE_PREVIEW_LENGTH = 32;

/** `value`, unchanged if it fits {@link TARGET_VALUE_PREVIEW_LENGTH}, else cut to that length with a
 *  trailing "…". @complexity O(1). */
function truncateTargetValue({ value }: { value: string }, _options = {}): string {
  return value.length > TARGET_VALUE_PREVIEW_LENGTH ? `${value.slice(0, TARGET_VALUE_PREVIEW_LENGTH)}…` : value;
}

/**
 * The card's identity line for a marker with no authored `name` — the `embedMarkerTarget` outcome
 * turned into display text:
 *
 * - `{ key, value }` — `"<key> <truncated value>"`, e.g. `"slug contact-form"`. This is the exact
 *   line Bug A's root cause report says the admin could never produce before this slice, because
 *   `identityLabel` (Jini's adapter) only ever read `config.id`.
 * - `{ key: "none" }` (post-previews) — never "no id set": `t("Latest posts")`, with the marker's own
 *   `limit` appended when present, since a post-previews marker legitimately has no target to name.
 * - `undefined` (target missing) — `t("no id set")`, unchanged from Jini's own adapter's wording.
 *
 * @complexity O(1) — one `embedMarkerTarget` call (itself O(k) in a small fixed key list) plus one
 * bounded string truncation.
 */
function targetIdentityLabel({ type, config, t, embedMarkerTarget }: { type: string; config: Readonly<Record<string, unknown>>; t: Translate } & Pick<EmbedMarkerReaders, "embedMarkerTarget">, _options = {}): string {
  const target: EmbedMarkerTarget | undefined = embedMarkerTarget({ type, config });
  if (target === undefined) return t("no id set");
  if (target.key === "none") {
    const limit = config.limit;
    return typeof limit === "number" ? `${t("Latest posts")} (${limit})` : t("Latest posts");
  }
  return `${target.key} ${truncateTargetValue({ value: target.value })}`;
}

/**
 * Builds the `describeEmbedPlaceholder` callback `@jini-ai/ui/html-editor`'s `InteractiveHtmlEditor`
 * calls once per canvas marker element (via its `applyCanvasEmbedPlaceholders`) — bound once to `t`
 * by `PageEditor`'s hook (`use-page-editor.hooks.ts`, Slice A3) with `useMemo`, since the editor reads
 * this callback only at mount.
 *
 * A legacy or malformed marker gets a safe generic label while keeping its existing protection.
 * `scanEmbedMarkers` can still reject it at render time; this is an editor description, not a
 * second marker interpretation. This runs on every
 * keystroke-adjacent canvas re-render, not at a write chokepoint, so it never warns or logs.
 *
 * `name`, when the marker's own config carries one, wins over every target key — an author's explicit
 * label is always more informative than a resolved reference, matching Jini's own adapter's identical
 * precedence.
 *
 * @complexity O(rows) for plugin readiness, otherwise O(1) — one attribute read, one bounded JSON
 * parse, one small table lookup, one `targetIdentityLabel` call.
 */
export function createEmbedPlaceholderDescriber({ t, parseEmbedMarkerConfig, embedMarkerTarget }: { t: Translate } & EmbedMarkerReaders, options: { pluginEmbeds?: () => readonly AdminPagePluginEmbed[] } = {}): (el: Element) => CanvasEmbedPlaceholderDescriptor | undefined {
  return (el: Element): CanvasEmbedPlaceholderDescriptor | undefined => {
    const raw = el.getAttribute("data-embed-config");
    const fallback = (): CanvasEmbedPlaceholderDescriptor | undefined => isProtectedEmbedElement(el)
      ? { kindLabel: t("Content"), identityLabel: el.getAttribute("id") ? `#${el.getAttribute("id")}` : t("no id set") }
      : undefined;
    if (!raw) return fallback();
    const result = parseEmbedMarkerConfig({ raw });
    if ("problem" in result) return fallback();

    const { config } = result;
    const type = (config.type as string).toLowerCase();
    if (type === "plugin") return pluginPlaceholder({ config, t, rows: options.pluginEmbeds?.() ?? [] });
    return standardPlaceholder({ type, config, t, embedMarkerTarget });
  };
}

/** Preserve the existing name-first labels for non-plugin markers. O(1), no side effects. */
function standardPlaceholder({ type, config, t, embedMarkerTarget }: { type: string; config: Readonly<Record<string, unknown>>; t: Translate } & Pick<EmbedMarkerReaders, "embedMarkerTarget">, _options = {}): CanvasEmbedPlaceholderDescriptor {
  const kindLabelKey = EMBED_KIND_LABEL_KEYS[type];
  const kindLabel = kindLabelKey !== undefined ? t(kindLabelKey) : titleCase({ value: type });
  const name = typeof config.name === "string" && config.name.length > 0 ? config.name : undefined;
  return { kindLabel, identityLabel: name ?? targetIdentityLabel({ type, config, t, embedMarkerTarget }) };
}

/** Readiness is injected from T1, never inferred from authored stamps or props. Canvas cards
 * stay inert; Preview owns the real keyboard-operable button. O(rows), no I/O or HTML injection.
 */
function pluginPlaceholder(required: { config: Readonly<Record<string, unknown>>; t: Translate; rows: readonly AdminPagePluginEmbed[] }, _options = {}): CanvasEmbedPlaceholderDescriptor {
  const { config, t } = required;
  const plugin = typeof config.plugin === "string" ? config.plugin : t("Unknown plugin");
  const component = typeof config.component === "string" ? config.component : t("Unknown component");
  const row = required.rows.find(item => item.plugin === plugin && item.component === component);
  const label = truncateTargetValue({ value: row?.displayName || plugin });
  const status = pluginAvailabilityLabel({ availability: row?.availability, t });
  return { kindLabel: label, identityLabel: `${truncateTargetValue({ value: component })} — ${status}`,
    guidanceLabel: t("Preview shows the current button or your fallback. Static exports always use your fallback.") };
}

/** Fixed diagnostic copy; no raw host errors or marker values become executable markup. O(1). */
function pluginAvailabilityLabel(required: { availability: string | undefined; t: Translate }, _options = {}): string {
  const { availability, t } = required;
  if (availability === "PLUGIN_DISABLED") return t("plugin off: visitors see your fallback");
  if (availability === "host-unavailable") return t("sign-in not configured: visitors see your fallback");
  if (availability === "ready" || availability === "props-required") return t("configured: check Preview");
  if (availability === undefined) return t("check Preview for availability");
  return t("plugin unavailable: visitors see your fallback");
}
