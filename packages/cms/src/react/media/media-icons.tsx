/** Generic "file" glyph for an asset that fails both the image and video probe — stroke-based,
 *  matching `nav.ts`'s icon convention elsewhere in this app (viewBox 0 0 18 18, currentColor). */
export function PlaceholderIcon() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <path d="M5 2h6l3 3v11H5V2z" strokeLinejoin="round" />
      <path d="M11 2v3h3" strokeLinejoin="round" />
    </svg>
  );
}

/** "Edit metadata" glyph for the card's own eye-icon trigger (owner's chosen affordance for
 *  reaching `EditMediaModal` — see this file's header) — an open-eye shape, same stroke style as
 *  this file's other icons. */
export function EyeIcon() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <path d="M1.5 9S4.5 3.5 9 3.5 16.5 9 16.5 9 13.5 14.5 9 14.5 1.5 9 1.5 9Z" strokeLinejoin="round" />
      <circle cx="9" cy="9" r="2.25" />
    </svg>
  );
}

/** "View larger" glyph for the lightbox trigger overlaid on a card's preview (four open corners —
 *  the conventional expand/fullscreen affordance), same stroke style as this file's other icons. */
export function ExpandIcon() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <path d="M6 2H2v4M12 2h4v4M6 16H2v-4M12 16h4v-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Upload glyph for the toolbar's icon button (tray with an up arrow), same stroke style as the others. */
export function UploadIcon() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <path d="M9 12V3M5.5 6.5 9 3l3.5 3.5M3 12v2.5h12V12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** "Play" cue on a video card's still frame — the card no longer carries the player itself. */
export function PlayIcon() {
  return (
    <svg className="media-card-play" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true">
      <path d="M6 3.5v11l9-5.5-9-5.5z" />
    </svg>
  );
}
