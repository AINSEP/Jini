/** Shared partial-slot vocabulary. */

/** One entry of {@link ThemeManifest.slots}. */
export interface ThemeSlotDescriptor {
  /** Root partial filename this slot renders, e.g. `nav.html`. */
  source: string;
  /**
   * Whether this slot's marker can carry a `current` key (e.g.
   * `{"type":"partial","id":"nav","current":"pricing"}`) that marks the matching `data-nav-id`
   * anchor inside the resolved partial with `aria-current="page"`. A boolean opt-in, not an
   * attribute name — `data-nav-id` is the only half of this convention themes ever varied, so
   * there was never a second attribute name to configure; only `nav`-shaped slots set this, a
   * `footer` has no current item.
   *
   * Legacy: `theme.json` may instead carry `"activeAttr": "<any string>"` — the pre-2026-08-10
   * spelling, from when this really did name an attribute on the marker element
   * (`data-nav-current`, since retired). {@link parseSlots} treats ANY string value there as
   * `honorsCurrentPage: true`; the string's own content was already dead weight by the time this
   * field was renamed; only its presence ever mattered. Drop that fallback once no in-repo
   * `theme.json` still writes `activeAttr` and the marker drift check
   * (`development/docs/architecture/embed-marker-migration.md` item 4) is extended to gate on it.
   */
  honorsCurrentPage?: boolean;
  /**
   * Alternate sources selected by a marker's `variant` config key, e.g.
   * `{ "minimal": "footer-minimal.html" }`. A variant with no entry here falls back to the
   * `<source-stem>-<variant>.html` filename convention, which is what `resolveSlots` did for every
   * variant before this field was parsed.
   */
  variants?: Record<string, string>;
}
