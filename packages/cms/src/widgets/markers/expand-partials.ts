import { PARTIAL_MARKER_TYPE, substituteMarkers, withElementKeptIfAttributed } from "./marker.js";
/** Structural theme slot configuration; defaults belong to the host. */
export interface PartialSlotDescriptor {
  source: string;
  variants?: Readonly<Record<string, string>>;
  honorsCurrentPage?: boolean;
}

/** `nav.html` → `nav`; the partial-id key `loadStaticTierAssets` stores root partials under. */
function partialIdFromSource({ source }: { source: string }, _options = {}): string {
  return source.endsWith(".html") ? source.slice(0, -".html".length) : source;
}

/**
 * Resolve one partial-slot marker to the partial's content: pick the source (the descriptor's
 * explicit `variants` map, else the `<source-stem>-<variant>.html` convention), then splice
 * `aria-current="page"` onto the partial's own `data-nav-id="<current>"` anchor.
 *
 * `descriptor.honorsCurrentPage` no longer names an attribute to read — the config key is always
 * `current`. It survives as the theme's declaration of WHETHER this slot honors a current-page hint
 * at all, which is still a per-slot fact (a footer has no current item).
 *
 * A marker whose resolved partial does not exist collapses to empty, matching the pre-2026-08-10
 * behavior for the same case.
 */
function resolveSlotMarker(
  { descriptor, partials, config }: { descriptor: PartialSlotDescriptor; partials: Record<string, string>; config: Readonly<Record<string, unknown>> },
  _options = {},
): string {
  const variant = typeof config.variant === "string" ? config.variant : undefined;
  const current = typeof config.current === "string" ? config.current : undefined;
  const source =
    variant === undefined
      ? descriptor.source
      : descriptor.variants?.[variant] ?? `${partialIdFromSource({ source: descriptor.source })}-${variant}.html`;
  const partial = partials[partialIdFromSource({ source: source })] ?? "";

  if (descriptor.honorsCurrentPage !== true || current === undefined) return partial;
  /** Escape a manifest-supplied string so it matches literally inside a constructed `RegExp`. */
  const linkRe = new RegExp(`(<a href="[^"]+" data-nav-id="${RegExp.escape(current)}")(>)`);
  return partial.replace(linkRe, '$1 aria-current="page"$2');
}

/**
 * Replace every `{"type":"partial"}` marker with the root partial the theme's `theme.json` `slots`
 * block maps that key to. A BARE marker's own element disappears entirely — it is scaffolding, and
 * the partial is a complete `<nav>`/`<footer>` of its own — but one carrying any authored attribute
 * besides `data-embed-config` keeps that element (minus the marker config) around the resolved
 * partial ({@link withElementKeptIfAttributed}, D3 of the 2026-09-23 collections/embeds plan): the
 * same keep-if-attributed rule the `widget` marker type already followed. A survey of every shipped
 * theme found no attributed partial marker in the wild, so this is additive — every existing bare
 * marker keeps disappearing exactly as before.
 *
 * Manifest-driven rather than the hardcoded `nav`/`footer` pair this carried before 2026-08-10; that
 * pair now comes from the host-provided `defaultSlots` and is used verbatim for a theme declaring no
 * `slots`. A marker naming a key the manifest does not declare is left untouched rather than blanked,
 * so a typo shows the authored fallback instead of a hole.
 *
 * @complexity O(n) over `html` for the single marker scan, plus one map lookup per marker — where the
 * pre-unification version ran one full regex pass per declared slot key, times two spellings.
 */
function resolveSlots(
  { html, partials, slots }: { html: string; partials: Record<string, string>; slots: Readonly<Record<string, PartialSlotDescriptor>> },
  _optional = {},
): string {
  return substituteMarkers({ html: html, resolve: (marker) => {
    if (marker.type !== PARTIAL_MARKER_TYPE || marker.id === undefined) return undefined;
    const descriptor = slots[marker.id];
    if (descriptor === undefined) return undefined;
    return withElementKeptIfAttributed({ marker: marker, inner: resolveSlotMarker({ descriptor: descriptor, partials: partials, config: marker.config }) });
  } });
}

/**
 * Partial-slot expansion as its OWN exported step (E2, 2026-09-23), so a caller can run it standalone
 * over already-assembled HTML rather than only as an inline rendering step. A host pipeline expands
 * partials first and only then scans the assembled result for widget/media/post/content/menu/
 * post-previews markers a partial itself might carry.
 *
 * Equivalent to {@link resolveSlots} called with the theme's own partials and declared (or default)
 * slots — no new behavior, just a named entry point for a caller that only has a `theme`, not the
 * two separate `partials`/`slots` arguments.
 *
 * @complexity Same as {@link resolveSlots}: O(n) over `html`'s length.
 */
export function expandPartials(
  { html, theme, defaultSlots }: {
    html: string;
    theme: { partials: Record<string, string>; manifest: { slots?: Readonly<Record<string, PartialSlotDescriptor>> } };
    defaultSlots: Readonly<Record<string, PartialSlotDescriptor>>;
  },
  _optional = {},
): string {
  return resolveSlots({ html, partials: theme.partials, slots: theme.manifest.slots ?? defaultSlots });
}
