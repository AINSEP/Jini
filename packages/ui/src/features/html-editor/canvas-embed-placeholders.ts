/**
 * @file Decorates every canvas element a host recognizes as an unresolved embed marker with an
 * explicit "this is a placeholder, not real content" card, so an operator editing a document in the
 * canvas sees something intentional where an embed will render instead of an empty, unlabeled element
 * that looks safe to delete by accident.
 *
 * Same seam as `canvas-content-wrapper.ts`, for the identical reason: this module has zero knowledge
 * of what an "embed marker" IS (that convention — `data-embed-config`, a `{"type":...}` JSON payload —
 * belongs to a host; see `@jini-ai/admin/react`'s `InteractiveHtmlEditor` for the one that supplies
 * it), and it runs on GrapesJS's `load` event against the live canvas DOM
 * (`editor.Canvas.getBody()`), never through the `components` string GrapesJS's exported
 * `getHtml()`/`getCss()` are built from. See that sibling file's header for the fuller argument; the
 * short version: GrapesJS's export walks its own component MODEL, which is fixed at
 * `grapesjs.init({ components: html })` and never re-reads the canvas iframe's live DOM afterward, so
 * anything this module adds to that DOM later is invisible to export by construction, not because of a
 * strip-on-save step that could be forgotten or miss a case.
 *
 * **The marker element is never given new children of its own — a NEW wrapper is built around it
 * instead, and the marker is MOVED inside that wrapper (never cloned), exactly the "move, never clone"
 * technique `canvas-content-wrapper.ts` uses to keep GrapesJS's component-view `.el` references
 * intact.** This is the one place this module's technique goes beyond a plain copy of that sibling's,
 * and the reason is a real, currently-open hazard specific to embed markers: a marker element is not
 * guaranteed to be excluded from GrapesJS's own RTE (rich-text-editing) machinery by a host's
 * `isProtectedElement` predicate — see `InteractiveHtmlEditor.tsx` (`@jini-ai/admin/react`)'s own doc
 * for that gap. If GrapesJS ever treats a marker element as an editable `text` component, an edit
 * gesture on it triggers `ComponentTextView.syncContent`, which re-parses that element's LIVE
 * `innerHTML` back into the component model. Putting the card's markup INSIDE the marker would hand
 * that re-parse something real to capture into a saved document; putting it in a wrapper AROUND the
 * (untouched, still literally empty) marker means there is nothing inside the marker for that re-parse
 * to ever pick up, regardless of whether that `isProtectedElement` gap is ever closed.
 *
 * **Safe to call again after every structural edit** (the hook does, on the tick after any component
 * add or remove): each pass first drops cards whose marker has gone (see `removeStaleCards`), then
 * wraps any marker not already inside a card.
 *
 * Re-entrancy (defensive, mirroring `canvas-content-wrapper.ts`'s own `WRAPPER_ROOT_MARKER` guard): a
 * marker already sitting inside a placeholder card (`el.closest('[' + CARD_ROOT_MARKER + ']')`) is
 * skipped, so a second call — or a caller's own `load` handler firing twice — cannot nest a second card
 * around an already-decorated marker.
 */

/** What to show on one embed's placeholder card — supplied per-element by the host's own `describe`
 *  callback, since only the host knows the marker convention (attribute name, JSON shape, and how to
 *  turn a parsed config into words a human recognizes). */
export interface CanvasEmbedPlaceholderDescriptor {
  /** Short name for the embed's kind, shown as the card's heading — e.g. `"Media"`, `"Widget"`. */
  kindLabel: string;
  /** Human-identifiable target, shown under the heading — e.g. a name, or a truncated id, or a note
   *  that none was set. Never fetched by this module; the host decides what's cheap enough to show. */
  identityLabel: string;
}

/** Marks a placeholder card's own root, so a later pass (this function called again, or a re-entrant
 *  `load`) can recognize an already-decorated marker via `el.closest` and skip it — see this file's
 *  header. */
const CARD_ROOT_MARKER = 'data-tovu-embed-placeholder-root';

/** Flags every child the card itself builds (icon, text), so the one unflagged child is always the
 *  marker. {@link OVERLAY_RULE} and the stale-card check in `removeStaleCards` both rely on it. */
const CARD_CHROME_MARKER = 'data-tovu-embed-placeholder-chrome';

/** Identifies the one `<style>` this module adds to the canvas document's `<head>`. */
const OVERLAY_STYLE_MARKER = 'data-tovu-embed-placeholder-style';

/**
 * Stretches the (empty) marker over its card as a transparent overlay, so a click anywhere on the card
 * lands on the marker element itself. GrapesJS resolves a click by walking up from the event target to
 * the nearest element it rendered; the card is not one of those, so without this a click on the card
 * selected whatever block wraps the embed, and Delete then removed that block together with the embed.
 * With it, the editor selects (and outlines) the embed. A stylesheet rule rather than an inline style,
 * so the marker's own attributes stay untouched. `!important` because the host's theme may style the
 * marker element.
 */
const OVERLAY_RULE =
  `[${CARD_ROOT_MARKER}] > :not([${CARD_CHROME_MARKER}])` +
  ' { position: absolute !important; inset: 0 !important; margin: 0 !important; width: auto !important;' +
  ' height: auto !important; min-width: 0 !important; max-width: none !important; min-height: 0 !important;' +
  ' display: block !important; background: transparent !important; }';

/** One CSS declaration list, as `property:value` pairs, for the card's own opaque chrome. Deliberately
 *  NOT derived from the host's theme in any way — themes are arbitrary and downloadable, and this card
 *  must stay legible whether the canvas underneath is a light theme, a dark theme, or (mid-edit) no
 *  theme at all. An opaque background plus a fixed, high-contrast foreground guarantees that
 *  regardless of what renders behind it, unlike a translucent or theme-token-based treatment would. */
const CARD_STYLE = [
  'position:relative',
  'display:flex',
  'align-items:flex-start',
  'gap:8px',
  'box-sizing:border-box',
  'border:2px dashed #f59e0b',
  'border-radius:8px',
  'background:#1f2937',
  'color:#f9fafb',
  'padding:10px 12px',
  "font:13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
].join(';');

/** Builds the small dashed-square-with-a-plus glyph that opens every card — assembled via
 *  `createElementNS`/`setAttribute` rather than an `innerHTML` template string, so its element nodes
 *  are unambiguously in the SVG namespace regardless of parser quirks around fragment-parsing SVG
 *  content on an element that itself was just created and not yet attached to a document. */
function buildPlaceholderIcon(doc: Document): SVGSVGElement {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const icon = doc.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  icon.setAttribute('width', '18');
  icon.setAttribute('height', '18');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', '#f59e0b');
  icon.setAttribute('stroke-width', '2');
  icon.setAttribute('style', 'flex-shrink:0;margin-top:1px;');

  const rect = doc.createElementNS(SVG_NS, 'rect');
  rect.setAttribute('x', '3');
  rect.setAttribute('y', '3');
  rect.setAttribute('width', '18');
  rect.setAttribute('height', '18');
  rect.setAttribute('rx', '3');
  rect.setAttribute('stroke-dasharray', '4 3');

  const plus = doc.createElementNS(SVG_NS, 'path');
  plus.setAttribute('d', 'M8 12h8M12 8v8');

  icon.append(rect, plus);
  return icon;
}

/** Builds one card's full DOM: icon, kind heading, identity line, and a short explanatory note so an
 *  operator unfamiliar with the convention still understands what they're looking at (REQ from the
 *  owner's own ask: "make it very explicit as a placeholder"). Every piece of text goes through
 *  `textContent`, never string-concatenated markup, so a marker's own config values (which flow into
 *  `descriptor.identityLabel`) can never be interpreted as HTML. */
function buildPlaceholderCard(doc: Document, descriptor: CanvasEmbedPlaceholderDescriptor): HTMLDivElement {
  const card = doc.createElement('div');
  card.setAttribute(CARD_ROOT_MARKER, '');
  card.setAttribute('style', CARD_STYLE);

  const text = doc.createElement('div');
  text.setAttribute(CARD_CHROME_MARKER, '');
  const heading = doc.createElement('div');
  heading.setAttribute('style', 'font-weight:600;');
  heading.textContent = `Placeholder — ${descriptor.kindLabel}`;
  const identity = doc.createElement('div');
  identity.setAttribute('style', 'opacity:.8;margin-top:2px;');
  identity.textContent = descriptor.identityLabel;
  const note = doc.createElement('div');
  note.setAttribute('style', 'opacity:.6;margin-top:4px;font-size:11px;');
  note.textContent = 'Shown here for editing only — the real content renders on the published page.';
  text.append(heading, identity, note);

  const icon = buildPlaceholderIcon(doc);
  icon.setAttribute(CARD_CHROME_MARKER, '');
  card.append(icon, text);
  return card;
}

/**
 * Carries the marker's own RESOLVED `max-width`, if it has one, onto the card — a second,
 * complementary mechanism to the literal `style` attribute copy in `applyCanvasEmbedPlaceholders`,
 * and the one that actually matters against a real GrapesJS canvas.
 *
 * **Why a second mechanism is needed at all.** Confirmed live against a real canvas (not discoverable
 * in a plain-DOM unit test — GrapesJS itself hangs under jsdom, see this file's own testing note):
 * GrapesJS's parser does NOT leave an authored `style="max-width:600px"` as a literal attribute on the
 * live element it renders. It converts it into a scoped CSS rule instead (`CssComposer`, keyed by the
 * component's own generated id — `#iow1b { max-width: 600px }` in a canvas `<style>` tag), so
 * `el.getAttribute('style')` finds nothing to copy for every REAL marker despite working correctly
 * against a bare, non-GrapesJS element. `getComputedStyle` reads the RESOLVED value regardless of
 * which of those two forms produced it, so it is what actually reaches a real canvas.
 *
 * Scoped to `max-width` alone (not a wholesale computed-style copy) on purpose: copying every resolved
 * property would fight this card's own deliberately theme-independent, opaque chrome (font, colors,
 * spacing) with whatever the surrounding page happens to compute — the one thing worth inheriting is
 * the box-width constraint the "respect the author's own wrapper" requirement is actually about, not
 * the marker's full computed style.
 *
 * A no-op wherever `getComputedStyle` cannot resolve anything meaningful — no global (a non-browser
 * test environment), or a marker with no width constraint at all (`'none'`, the property's initial
 * value, or an empty string for a detached node with no attached window) — which is also exactly the
 * behavior every existing caller of this module had before this function existed.
 */
function applyResolvedMaxWidth(marker: Element, card: HTMLElement): void {
  if (typeof getComputedStyle !== 'function') return;
  const maxWidth = getComputedStyle(marker).maxWidth;
  if (maxWidth && maxWidth !== 'none') card.style.setProperty('max-width', maxWidth);
}

/** Adds {@link OVERLAY_RULE} to `doc`'s `<head>` once. Idempotent. */
function ensureOverlayRule(doc: Document): void {
  if (doc.head.querySelector(`style[${OVERLAY_STYLE_MARKER}]`)) return;
  const style = doc.createElement('style');
  style.setAttribute(OVERLAY_STYLE_MARKER, '');
  style.textContent = OVERLAY_RULE;
  doc.head.appendChild(style);
}

/**
 * Removes every card whose marker is no longer inside it. The card lives only in the canvas DOM, so the
 * editor knows nothing about it: deleting the embed removes just the marker element (leaving a ghost
 * card that still reads "Placeholder"), and moving it takes the marker out (leaving an empty card
 * behind). The next pass of `applyCanvasEmbedPlaceholders` then wraps the moved marker again.
 */
function removeStaleCards(body: HTMLElement): void {
  for (const card of Array.from(body.querySelectorAll(`[${CARD_ROOT_MARKER}]`))) {
    const hasMarker = Array.from(card.children).some((child) => !child.hasAttribute(CARD_CHROME_MARKER));
    if (!hasMarker) card.remove();
  }
}

/**
 * Scans every element under `body` once and, for each one `describe` recognizes (returns a descriptor
 * for), replaces its visible slot with an explicit placeholder card — see this file's header for the
 * export-safety argument and for why the marker is wrapped rather than written into.
 *
 * @param body - The canvas iframe's `<body>` element (`editor.Canvas.getBody()`), already populated by
 *   GrapesJS's initial component render — same input `applyCanvasContentWrapper` takes, and safe to
 *   call after that function has already restructured `body`'s top level, since this walks the full
 *   subtree regardless of how deep any one marker now sits.
 * @param describe - Host-supplied recognizer/labeler. Returning `undefined` means "not a marker this
 *   host owns" — the element is left completely untouched, no wrapping, no traversal into its own
 *   children skipped either (a marker's own children, if any, are themselves ordinary elements this
 *   function still visits, since `Array.from(body.querySelectorAll('*'))` is a flat snapshot of every
 *   descendant, not a tree walk this function short-circuits).
 * @complexity O(n) over the number of elements under `body` for the scan, plus O(1) per matched marker
 *   for its card's fixed-size DOM (icon plus three text nodes) — independent of document size.
 */
export function applyCanvasEmbedPlaceholders(
  body: HTMLElement,
  describe: (el: Element) => CanvasEmbedPlaceholderDescriptor | undefined
): void {
  const doc = body.ownerDocument;
  removeStaleCards(body);
  // Snapshotted into an array before any mutation starts: this function inserts new ancestors as it
  // goes, and a live `querySelectorAll` result must never be iterated while the tree it was taken over
  // is being restructured underneath it — same discipline `applyCanvasContentWrapper` applies to
  // `body.childNodes` for the same reason.
  const candidates = Array.from(body.querySelectorAll('*'));

  for (const el of candidates) {
    // Already inside a placeholder card from an earlier pass over this same element — see this file's
    // header on re-entrancy. Checked via ancestor lookup rather than a marker attribute on `el` itself,
    // so a decorated marker's own attributes stay completely untouched by this function, not just its
    // children.
    if (el.closest(`[${CARD_ROOT_MARKER}]`)) continue;
    const descriptor = describe(el);
    if (!descriptor) continue;
    const parent = el.parentNode;
    if (!parent) continue; // Unreachable for a live `body` descendant; defensive only.

    const card = buildPlaceholderCard(doc, descriptor);
    // Respect the author's own box (e.g. `style="max-width:600px"` on the marker) by carrying its
    // inline style onto the card BEFORE the card's own chrome declarations, so same-named properties
    // in `CARD_STYLE` win on the cascade's normal "last declaration wins" rule while anything the
    // author set that `CARD_STYLE` doesn't touch (like `max-width`) still applies unopposed. Guarded
    // on presence so a marker with no `style` attribute at all is a no-op, not a leading `;`.
    const authoredStyle = el.getAttribute('style');
    if (authoredStyle) card.setAttribute('style', `${authoredStyle};${card.getAttribute('style')}`);
    applyResolvedMaxWidth(el, card);

    parent.insertBefore(card, el);
    card.appendChild(el); // Moves the SAME node (auto-detaches from `parent`) — never cloned.
    ensureOverlayRule(doc);
  }
}
