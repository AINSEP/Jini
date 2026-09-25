export const CHAT_PANE_STYLES = `
.jini-chat-pane {
  --jini-chat-bg: #faf9f7;
  --jini-chat-panel: #fdfcfa;
  --jini-chat-text: #1a1916;
  --jini-chat-text-strong: #0d0c0a;
  --jini-chat-muted: #74716b;
  --jini-chat-faint: #b3b0a8;
  --jini-chat-border: #e1e5eb;
  --jini-chat-border-strong: #c9d0da;
  --jini-chat-border-soft: #edf0f4;
  --jini-chat-subtle: #f4f5f7;
  --jini-chat-accent: #c96442;
  --jini-chat-accent-soft: #fbeee5;
  --jini-chat-danger: #e5484d;
  --jini-chat-radius: 8px;
  --jini-chat-radius-lg: 12px;
  --bg-panel: var(--jini-chat-panel);
  --bg-subtle: var(--jini-chat-subtle);
  --border: var(--jini-chat-border);
  --border-strong: var(--jini-chat-border-strong);
  --text: var(--jini-chat-text);
  --text-strong: var(--jini-chat-text-strong);
  --text-muted: var(--jini-chat-muted);
  --danger: var(--jini-chat-danger);
  --radius: var(--jini-chat-radius);
  --radius-lg: var(--jini-chat-radius-lg);
  position: relative;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  color: var(--jini-chat-text);
  background: var(--jini-chat-bg);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei UI", "Noto Sans", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 13.5px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
.jini-chat-pane button,
.jini-runtime-popover button,
.jini-runtime-popover select {
  font: inherit;
}
.jini-chat-pane__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 74px;
  padding: 18px 22px 14px;
  border-bottom: 1px solid var(--jini-chat-border-soft);
}
.jini-chat-pane__heading { min-width: 0; }
.jini-chat-pane__eyebrow {
  display: block;
  margin-bottom: 4px;
  color: var(--jini-chat-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  letter-spacing: .1em;
  text-transform: uppercase;
}
.jini-chat-pane__title {
  overflow: hidden;
  margin: 0;
  font-size: 21px;
  font-weight: 650;
  letter-spacing: -.025em;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.jini-chat-pane__new-thread {
  padding: 8px 12px;
  color: var(--jini-chat-muted);
  background: var(--jini-chat-panel);
  border: 1px solid var(--jini-chat-border);
  border-radius: 8px;
  cursor: pointer;
}
.jini-chat-pane__body {
  position: relative;
  min-height: 0;
  overflow: hidden;
}
.jini-chat-pane .jini-message-list {
  height: 100%;
  overflow-y: auto;
  /*
   * .jini-chat-pane__controls is an absolutely-positioned overlay (not a flex/grid sibling that
   * pushes this list up), so its real height has to be reserved here instead. This used to be a
   * flat 240px guess -- and had already gone stale once before that: it started at 170px, a live
   * render outgrew it (composer + footer + working-directory row alone measured 179.75px, clipping
   * the last message's tail under the overlay), and 240px was chosen as a margin above THAT
   * measurement, not a value anything keeps in sync. useChatPaneControlsHeight now measures the
   * overlay's real height live via ResizeObserver and publishes it as
   * --jini-chat-controls-height on the pane root, so this reservation tracks the composer's
   * actual content (an attachment tray, a wrapped multi-line draft, a taller runtime-picker
   * popover) instead of a number that is only ever correct until the next thing that grows it.
   * 240px survives as the fallback for the rare environment without ResizeObserver (SSR; a test
   * harness that never polyfills it) -- everywhere else, the calc() wins.
   */
  padding: 20px 22px calc(var(--jini-chat-controls-height, 240px) + 24px);
  scrollbar-width: thin;
}
.jini-chat-pane .jini-message {
  margin-bottom: 20px;
  color: var(--jini-chat-text);
  font-size: 14px;
  line-height: 1.62;
}
/*
 * Bubble on the content, not the row: MessageRow.tsx renders attachments as siblings of
 * .jini-message-content inside .jini-message-user, each with their own chip styling -- bubbling
 * the whole row would nest one background box inside another. This replaces a dead rule this file
 * shipped with (.jini-message-row[data-role="user"] / .jini-message-row.user): MessageRow.tsx
 * has never rendered a jini-message-row class or a data-role attribute, and a user message's
 * root class is jini-message-user, not bare "user" -- the selector never matched anything real.
 */
.jini-chat-pane .jini-message-user .jini-message-content {
  margin-left: auto;
  padding: 10px 13px;
  width: fit-content;
  max-width: 88%;
  background: var(--jini-chat-subtle);
  border-radius: 12px 12px 3px 12px;
}
.jini-chat-pane .jini-message-user .jini-message-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
  margin-bottom: 4px;
}
.jini-chat-pane .jini-message-user .jini-message-attachment-chip {
  font: inherit;
  font-size: 11px;
  line-height: 1.4;
  color: var(--jini-chat-muted);
  background: var(--jini-chat-subtle);
  border: 1px solid var(--jini-chat-border);
  border-radius: 999px;
  padding: 3px 10px;
  cursor: pointer;
}
.jini-chat-pane .jini-message-user .jini-message-attachment-chip:hover {
  color: var(--jini-chat-text);
  border-color: var(--jini-chat-border-strong);
}
.jini-chat-pane .jini-message-agent {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .02em;
  text-transform: uppercase;
  color: var(--jini-chat-faint);
  margin-bottom: 4px;
}
.jini-chat-pane .jini-message-error { color: var(--danger); font-size: 13px; }
.jini-chat-pane .jini-message-pending { color: var(--jini-chat-muted); font-size: 13px; font-style: italic; }
/*
 * The pending-turn strip: a composer-driven turn typed while a run is already streaming, rendered
 * as the newest entry in the transcript (MessageList.tsx's pendingPrompt prop) rather than a
 * banner bolted above the composer — matching Claude Code/ChatGPT's own pending-message UX
 * (previously ChatPane.tsx's ChatPaneQueuedPrompt, which rendered between the drop-target's drag
 * announcement and the composer; that component is gone).
 *
 * Owner's own framing was "why isn't the queue message just put in the chat" — so
 * .jini-chat-pane__queued-text below is deliberately NOT a variant banner shape; it copies
 * .jini-message-user .jini-message-content's bubble geometry line for line (width: fit-content,
 * max-width: 88%, same padding/border-radius) so it reads as the operator's own message, not a
 * system notice. What marks it as NOT YET SENT is two properties a real sent bubble never carries:
 * a dashed border (a sent bubble has none at all) and reduced opacity — chosen over the old boxed
 * strip-plus-label treatment because those two are legible at a glance without adding a second
 * visual language next to the transcript's own. The former "QUEUED" chip label is gone for the same
 * reason: once the bubble itself reads as pending, a label restates it. role="status" plus the
 * aria-label on the row (MessageList.tsx) still carry that meaning to assistive tech that can't see
 * the dashed border. The cancel action is a separate, smaller line below the bubble (mirroring
 * .jini-message-actions--user's own placement under a real message) rather than inline inside it,
 * so it reads as secondary to the bubble, not competing with it.
 *
 * Reuses this theme's own tokens rather than the currentColor/color-mix approach reference.css uses
 * for the same rules — that file is deliberately token-free because it ships unstyled and undocked
 * from any root that defines custom properties, but this stylesheet's .jini-chat-pane root already
 * defines concrete --jini-chat-* values for every other rule here, so matching that (not
 * reference.css's host-agnostic fallback) is the actual local convention.
 * NOTE: this comment avoids backtick quoting on purpose, same as the cancel-button comment below —
 * the whole stylesheet lives inside a JS template literal, so a literal backtick here would
 * terminate the string, not just this comment.
 */
.jini-chat-pane__queued {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  margin: 4px 0 0;
}
.jini-chat-pane__queued-text {
  width: fit-content;
  max-width: 88%;
  padding: 10px 13px;
  color: var(--jini-chat-text);
  background: var(--jini-chat-subtle);
  border: 1px dashed var(--jini-chat-border);
  border-radius: 12px 12px 3px 12px;
  opacity: .68;
  overflow-wrap: break-word;
}
.jini-chat-pane__queued-actions {
  display: flex;
  justify-content: flex-end;
}
/*
 * A plain-text cancel affordance below the pending bubble, not a primary action — without this
 * reset a host's own global 'button' styling (background, border, padding, border-radius, bold
 * text) paints it as a full pill-shaped button that visually competes with (and can overlap) the
 * transcript around it — the exact failure an operator hit live in one host. '.jini-chat-pane
 * button { font: inherit }' near the top of this file already resets font-family/line-height/etc
 * to this pane's own ambient values; font-size/font-weight are redeclared here (not just left at
 * that inherited ambient size) to size this specific control down to a caption scale, well under
 * the bubble's own 14px text.
 * NOTE: this comment avoids backtick quoting on purpose (see this file's own precedent further
 * down) — the whole stylesheet lives inside a JS template literal, so a literal backtick here
 * would terminate the string, not just this comment.
 */
.jini-chat-pane__queued-cancel {
  padding: 2px 6px;
  color: var(--jini-chat-muted);
  background: none;
  border: 0;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 400;
  cursor: pointer;
}
.jini-chat-pane__queued-cancel:hover {
  color: var(--jini-chat-text-strong);
  background: var(--jini-chat-border);
}
/*
 * Per-message action row (MessageRow.tsx's 'CopyMessageButton', Icon.tsx's 'copy' glyph): quiet,
 * icon-only, always present rather than a hover-only reveal, so keyboard and touch users get the
 * same access a mouse hover would give. The assistant variant carries a thin left rail (its own
 * left border) to read as attached to the turn above it without repeating that message's own
 * chrome; the user variant skips the rail and instead mirrors its bubble's own right alignment.
 * Copy is the only live button today — 'jini-message-actions--assistant' is an intentional
 * extension seam, not the finished row; see that row's own call-site comment in MessageRow.tsx.
 */
.jini-chat-pane .jini-message-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-top: 6px;
}
.jini-chat-pane .jini-message-actions--assistant {
  padding-left: 8px;
  border-left: 2px solid var(--jini-chat-border-soft);
}
.jini-chat-pane .jini-message-actions--user { justify-content: flex-end; }
.jini-chat-pane .jini-message-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  color: var(--jini-chat-faint);
  background: none;
  border: 0;
  border-radius: 6px;
  cursor: pointer;
}
.jini-chat-pane .jini-message-action-btn:hover { color: var(--jini-chat-muted); background: var(--jini-chat-subtle); }
.jini-chat-pane .jini-message-action-btn:focus-visible { outline: 2px solid var(--jini-chat-accent); outline-offset: 1px; }
/* Visually hidden but present in the DOM (never display:none) so the polite live region beside
   each copy button still gets announced — same clip-rect technique this package already uses for
   its other visually-hidden-but-functional controls. */
.jini-chat-pane .jini-message-copy-status {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
}
.jini-chat-pane__controls {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 4;
  padding: 0 16px 14px;
  background: linear-gradient(to bottom, transparent, var(--jini-chat-bg) 22px);
}
.jini-chat-pane__suggestions {
  display: flex;
  gap: 8px;
  margin: 0 2px 8px;
  overflow-x: auto;
}
.jini-chat-pane__suggestion {
  flex: 0 0 auto;
  max-width: 290px;
  overflow: hidden;
  padding: 7px 11px;
  color: var(--jini-chat-muted);
  background: color-mix(in srgb, var(--jini-chat-panel) 92%, transparent);
  border: 1px solid var(--jini-chat-border);
  border-radius: 999px;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.jini-chat-pane__error {
  margin: 0 2px 8px;
  padding: 8px 10px;
  color: #8c2f20;
  background: #fff1ed;
  border: 1px solid #f2c8bb;
  border-radius: 8px;
  font-size: 12px;
}
.jini-chat-pane__error-action {
  padding: 0;
  color: inherit;
  background: none;
  border: 0;
  font: inherit;
  font-weight: 650;
  text-decoration: underline;
  cursor: pointer;
}
.jini-chat-pane__error-action:hover { opacity: .82; }
.jini-chat-pane__status {
  margin: 0 2px 8px;
  padding: 8px 10px;
  color: var(--jini-chat-muted);
  background: var(--jini-chat-subtle);
  border: 1px solid var(--jini-chat-border);
  border-radius: 8px;
  font-size: 12px;
}
.jini-chat-pane__drop-target {
  position: relative;
  margin: -8px -8px -8px;
  padding: 6px;
  border: 2px dashed transparent;
  border-radius: 16px;
  transition:
    background-color .14s ease,
    border-color .14s ease,
    box-shadow .14s ease;
}
.jini-chat-pane__drop-target.is-dragging-files {
  background: color-mix(in srgb, var(--jini-chat-accent-soft) 72%, transparent);
  border-color: var(--jini-chat-accent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--jini-chat-accent) 15%, transparent);
}
.jini-chat-pane__drop-target.is-dragging-files .jini-composer {
  background: color-mix(in srgb, var(--jini-chat-accent-soft) 58%, var(--jini-chat-panel));
  border-color: color-mix(in srgb, var(--jini-chat-accent) 68%, var(--jini-chat-border));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--jini-chat-accent) 10%, transparent);
}
.jini-chat-pane__drop-announcement {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  clip-path: inset(50%);
}
.jini-chat-pane .jini-composer {
  position: relative;
  overflow: visible;
  padding: 0;
  background: var(--jini-chat-subtle);
  border: 1px solid var(--jini-chat-border);
  border-radius: 12px;
  box-shadow: none;
  transition: border-color .16s ease, box-shadow .16s ease;
}
.jini-chat-pane .jini-composer:focus-within {
  background: var(--jini-chat-panel);
  border-color: color-mix(in srgb, var(--jini-chat-accent) 22%, var(--jini-chat-border-strong));
  box-shadow: 0 1px 2px rgba(26, 25, 22, .06), 0 0 0 1px rgba(201, 100, 66, .06);
}
/*
 * Pinned-context zone: whatever a host pins above the composer input (selected plugins, MCP
 * servers, or anything a future host adds -- see 'leadingAccessories''s own doc in 'slots.ts').
 * 'Composer.tsx' only mounts this element when 'slots.leadingAccessories' is a truthy prop value,
 * but a host that always supplies a TRAY COMPONENT rather than conditionally supplying the prop
 * itself (one that internally renders 'null' when nothing is pinned) still leaves an empty node
 * behind -- ':empty' below is what actually collapses THAT case to zero height and zero seam,
 * mirroring '.jini-attachment-tray:empty' a few rules down, which solves the identical problem for
 * the real file-attachment tray.
 *
 * Collapsed (nothing pinned): zero height, zero padding, invisible (0-width) seam -- no reserved
 * space, matching the owner's "if nil, it doesn't animate" requirement exactly, since there is
 * nothing here to animate.
 *
 * Populated: grows to a single fixed-height row via 'max-height' (not 'height: auto', which can't
 * transition) and gains a hairline seam using the SAME border/token '.jini-composer-footer' below
 * already uses one zone down -- reads as one more zone of the same control, not a new floating
 * box. The transition runs both directions, so removing the last pinned item gets a matching exit,
 * not an instant cut.
 *
 * 'overflow-x: auto' turns this into a single scrollable row instead of the wrap-and-grow a naive
 * flex row would do with six or more items; '> *' keeps any direct host child (a single tray
 * wrapper, a bare row of buttons, anything) from shrinking to fit, so overflow -- not internal
 * wrapping -- is what kicks in once content is wider than the zone.
 *
 * The "more content" cue is a real shadow/vignette, not a plain alpha fade -- an alpha fade toward
 * this zone's own background was tried first and rejected on review: the chip and the zone
 * background are already close in luminance, so fading a chip's OWN pixels toward transparent read
 * as "something is clipped/broken", not "swipe for more", at a glance with no hover. The four-layer
 * 'background' below is the standard scroll-shadow technique instead: a real 'color-mix'-tinted
 * vignette (darkens in a light theme, lightens in a dark one, since it's mixed from the theme's OWN
 * text color rather than a fixed hex) drawn at each edge -- but each 'scroll'-attached shadow layer
 * is covered by a same-edge 'local'-attached solid-to-transparent layer that scrolls WITH the
 * content, so the shadow is only ever visible on the edges that still have more to reveal: at rest
 * (scrolled to the start) the left shadow is hidden and the right one shows; scroll all the way to
 * the true end and the right shadow hides too. Verified live (not just by reading the technique):
 * scrolling this element from 0 to its max scrollLeft measurably fades the right cover's computed
 * background-position across the full track and the shadow disappears exactly at the end.
 */
.jini-chat-pane .jini-composer-leading {
  display: flex;
  align-items: center;
  overflow-x: auto;
  overflow-y: hidden;
  max-height: 0;
  padding: 0 12px;
  border-bottom: 0 solid var(--jini-chat-border-soft);
  opacity: 0;
  scrollbar-width: thin;
  transition:
    max-height .22s cubic-bezier(.3, .1, .25, 1),
    padding .22s cubic-bezier(.3, .1, .25, 1),
    border-bottom-width .22s ease,
    opacity .16s ease;
  background-color: var(--jini-chat-subtle);
  background-repeat: no-repeat;
  background-attachment: local, local, scroll, scroll;
  background-position: 0 0, 100% 0, 0 0, 100% 0;
  background-size: 26px 100%, 26px 100%, 20px 100%, 20px 100%;
  background-image:
    linear-gradient(to right, var(--jini-chat-subtle), transparent),
    linear-gradient(to left, var(--jini-chat-subtle), transparent),
    linear-gradient(to right, color-mix(in srgb, var(--jini-chat-text) 30%, transparent), transparent),
    linear-gradient(to left, color-mix(in srgb, var(--jini-chat-text) 30%, transparent), transparent);
}
.jini-chat-pane .jini-composer-leading:not(:empty) {
  max-height: 64px;
  padding: 10px 12px;
  border-bottom-width: 1px;
  opacity: 1;
}
.jini-chat-pane .jini-composer-leading > * {
  flex: none;
  min-width: max-content;
}
@media (prefers-reduced-motion: reduce) {
  .jini-chat-pane .jini-composer-leading { transition: none; }
}
.jini-chat-pane .jini-attachment-tray {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 88px;
  overflow-y: auto;
  padding: 8px 10px 0;
  scrollbar-width: thin;
}
.jini-chat-pane .jini-attachment-tray:empty { display: none; }
/*
 * The sanctioned reuse path (see '.jini-composer-leading''s own doc above and 'AttachmentTray''s
 * module doc): a host nesting Jini's own tray/chip classes inside the pinned-context zone to match
 * the real attachment tray's look. Un-does the wrap-and-grow rule directly above -- meant for that
 * tray's OWN use one zone down, where wrapping onto a second line is fine -- so the OUTER zone's
 * single scroll axis is the one that wins here instead. The real file-attachment tray is
 * unaffected: it always renders as this zone's sibling ('Composer.tsx'), never its descendant.
 */
.jini-chat-pane .jini-composer-leading .jini-attachment-tray {
  flex-wrap: nowrap;
  max-height: none;
  overflow: visible;
  padding: 0;
}
.jini-chat-pane .jini-attachment-chip {
  display: inline-flex;
  align-items: center;
  box-sizing: border-box;
  min-width: 0;
  max-width: min(100%, 290px);
  height: 36px;
  padding: 3px 4px 3px 5px;
  color: var(--jini-chat-text);
  background: color-mix(in srgb, var(--jini-chat-panel) 88%, var(--jini-chat-subtle));
  border: 1px solid var(--jini-chat-border);
  border-radius: 9px;
  box-shadow: 0 1px 1px rgba(13, 12, 10, .025);
  animation: jini-chat-chip-in .16s ease both;
}
@keyframes jini-chat-chip-in {
  from { opacity: 0; transform: translateY(3px) scale(.94); }
  to { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  .jini-chat-pane .jini-attachment-chip { animation: none; }
}
.jini-chat-pane .jini-attachment-chip-body {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 7px;
}
.jini-chat-pane .jini-attachment-chip-icon {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 26px;
  height: 26px;
  color: var(--jini-chat-muted);
  background: var(--jini-chat-subtle);
  border-radius: 7px;
}
.jini-chat-pane .jini-attachment-chip-icon.is-image {
  color: var(--jini-chat-accent);
  background: var(--jini-chat-accent-soft);
}
.jini-chat-pane .jini-attachment-chip-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  line-height: 1.15;
}
.jini-chat-pane .jini-attachment-chip-name {
  overflow: hidden;
  font-size: 11.5px;
  font-weight: 550;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.jini-chat-pane .jini-attachment-chip-size {
  color: var(--jini-chat-muted);
  font-size: 9.5px;
}
.jini-chat-pane .jini-attachment-remove {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 25px;
  height: 25px;
  margin-left: 4px;
  padding: 0;
  color: var(--jini-chat-muted);
  background: transparent;
  border: 0;
  border-radius: 7px;
  cursor: pointer;
}
.jini-chat-pane .jini-attachment-remove:hover,
.jini-chat-pane .jini-attachment-remove:focus-visible {
  color: var(--jini-chat-text-strong);
  background: var(--jini-chat-subtle);
  outline: none;
}
.jini-chat-pane .jini-composer-input {
  display: block;
  box-sizing: border-box;
  width: 100%;
  min-height: 92px;
  resize: none;
  padding: 12px 14px 8px;
  color: var(--jini-chat-text);
  background: transparent;
  border: 0;
  outline: 0;
  font-size: 13.5px;
  line-height: 1.6;
}
.jini-chat-pane .jini-composer-input::placeholder { color: var(--jini-chat-faint); }
.jini-chat-pane .jini-composer-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 42px;
  gap: 6px;
  padding: 6px 8px 8px;
  border-top: 1px solid var(--jini-chat-border-soft);
}
.jini-chat-pane .jini-composer-attachment-picker { display: inline-flex; }
/* Host controls slotted at the start of the footer row, right after the attach/discovery "+"
   trigger above -- see ComposerSlots.footerLeadingAccessory's own doc (slots.ts) for why this
   exists as a third footer slot alongside footerAccessories/plusMenuItems. */
.jini-chat-pane .jini-composer-footer-leading { display: inline-flex; align-items: center; }
/* NOT 'position: relative' — the discovery popover (below) anchors off '.jini-composer' itself
   (the nearest positioned ancestor once this wrapper opts out), not off this small trigger-button
   wrapper. Anchoring to the wrapper put the popover's bottom edge at the wrapper's own top edge —
   inside the footer, just below the textarea — so any popover taller than a couple of rows grew
   upward straight over the textarea and blocked clicks into it (reproduced live: Playwright's own
   click on the textarea failed with "intercepts pointer events" while the popover was open). */
.jini-chat-pane .jini-composer-discovery { display: inline-flex; }
.jini-chat-pane .jini-composer-discovery-menu,
.jini-chat-pane .jini-composer-slash-menu {
  position: absolute;
  z-index: 8;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 280px;
  overflow-y: auto;
  padding: 8px;
  color: var(--jini-chat-text);
  background: var(--jini-chat-panel);
  border: 1px solid var(--jini-chat-border);
  border-radius: 10px;
  box-shadow: 0 12px 30px rgb(0 0 0 / 14%);
}
/* Both anchor off '.jini-composer' ('bottom: calc(100% + 6px)' = fully above the textarea AND the
   footer, not just above the trigger button) so the popover floats as a clean detached card instead
   of overlapping the input it sits next to. */
.jini-chat-pane .jini-composer-discovery-menu {
  inset-inline-start: 8px;
  bottom: calc(100% + 6px);
  width: min(280px, calc(100vw - 32px));
}
.jini-chat-pane .jini-composer-slash-menu {
  inset-inline: 8px;
  bottom: calc(100% + 6px);
}
.jini-chat-pane .jini-composer-discovery-group { display: flex; flex-direction: column; gap: 2px; }
.jini-chat-pane .jini-composer-discovery-group-label {
  padding: 6px 8px 2px;
  color: var(--jini-chat-faint);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
}
.jini-chat-pane .jini-composer-discovery-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  padding: 7px 8px;
  color: inherit;
  text-align: start;
  background: transparent;
  border: 0;
  border-radius: 7px;
  cursor: pointer;
}
.jini-chat-pane .jini-composer-discovery-item:hover {
  background: var(--jini-chat-panel);
}
.jini-chat-pane .jini-composer-discovery-item.is-active {
  color: var(--jini-chat-text-strong);
  background: var(--jini-chat-accent-soft);
  outline: 1px solid var(--jini-chat-accent);
  outline-offset: -1px;
  box-shadow: inset 3px 0 0 var(--jini-chat-accent);
}
.jini-chat-pane .jini-composer-discovery-item small { color: var(--jini-chat-muted); }
/* The full description used to print under every row unconditionally, which is why the palette
   grew to dozens of multi-line rows on a bare "/" — kept in the accessibility tree at rest (never
   'display: none', which most screen readers drop from that tree) so 'aria-describedby' keeps
   resolving whether or not anything is hovering.
   FIXED (was: opacity-only toggle, THEN an absolutely-positioned overlay) — two owner-reported
   bugs in sequence on the same element:
   1. 'opacity: 0' alone hides a box visually but does not remove it from layout, so an
      absolutely-positioned tooltip sized to its full natural content height (routinely 50-260px
      for a real description) still counted toward its scrolling ancestor's scrollable overflow
      region while invisible ('scrollHeight' measured 501px against a 242px 'clientHeight' for a
      6-row list), leaving a blank scrollable gap after the last real row. Fixed by collapsing the
      box itself at rest ('max-height: 0; overflow: hidden;'), not just hiding it — carried
      forward below.
   2. That fix still left this 'position: absolute; top: 100%' of its own row (formerly anchored
      via 'position: relative' on '.jini-composer-discovery-item' above, now removed — nothing
      anchors off it anymore): 'z-index' only controls paint order, not which box a box is
      confined to, so on hover/focus the expanded tooltip painted directly over whichever row
      happened to sit below it in the SAME scrollable list (owner report: hovering "UI/UX Design
      (Skill)" covered the "/mcp" entry beneath it — not a stacking-order problem, a containment
      one). Fixed by dropping 'position: absolute' entirely: this is now a normal in-flow child of
      the row's own 'flex-direction: column' box, still collapsed to negligible size at rest via
      'max-height: 0; overflow: hidden;', but on hover/focus it grows the ROW's own height instead
      of floating a detached box over the next row — the popover's flex column (and every row
      below) gets pushed down to make room, so it can never occlude a sibling item. This also
      retires the panel-styled "floating card" look (background/border/shadow): an in-flow caption
      reads correctly with the row's own muted small-text convention above, and dropping it removes
      the last reason this needed its own stacking context. 'pointer-events: none' is kept for
      parity even though nothing sits under it to protect anymore. */
.jini-chat-pane .jini-composer-discovery-description {
  width: 100%;
  max-height: 0;
  padding: 0;
  overflow: hidden;
  color: var(--jini-chat-muted);
  font-size: 12px;
  font-weight: 400;
  line-height: 1.4;
  white-space: normal;
  opacity: 0;
  pointer-events: none;
  transition: opacity .12s ease;
}
.jini-chat-pane .jini-composer-discovery-item:hover .jini-composer-discovery-description,
.jini-chat-pane .jini-composer-discovery-item:focus-visible .jini-composer-discovery-description {
  max-height: none;
  padding-top: 2px;
  overflow: visible;
  opacity: 1;
}
/* '<code>'/'<small>' both default to the browser's UA styling (monospace at an unrelated size)
   with nothing here overriding it — computed font-SIZE happened to already match the row label
   (13.5px), so the visible mismatch is font-FAMILY: raw monospace next to the label's sans-serif
   stack reads as a different, larger type scale even at equal size. Inheriting the row's own font
   puts both on one consistent scale. */
.jini-chat-pane .jini-composer-slash-argument,
.jini-chat-pane .jini-composer-slash-confirm-badge {
  font-family: inherit;
  font-size: inherit;
  font-weight: 400;
  color: var(--jini-chat-muted);
}
.jini-chat-pane .jini-composer-file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  clip-path: inset(50%);
}
.jini-chat-pane .jini-composer-attach {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  color: var(--jini-chat-muted);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 8px;
  cursor: pointer;
}
.jini-chat-pane .jini-composer-attach:hover:not(:disabled) {
  color: var(--jini-chat-text);
  background: var(--jini-chat-panel);
  border-color: var(--jini-chat-border);
}
.jini-chat-pane .jini-composer-attach:disabled { opacity: .45; cursor: default; }
/* The working-directory trigger button reuses '.jini-composer-attach' itself (Composer.tsx) rather
   than a class duplicated here, so it is byte-identical in size/hit-area/hover/focus to its
   neighbour rather than an approximation that could drift out of sync. Only the wrapper and its
   popover are new. NOT 'position: relative' on the wrapper, for the same reason noted above
   '.jini-composer-discovery': the popover's un-measured first paint (before the layout effect sets
   its 'position: fixed' inline style) falls back to this rule's 'position: absolute', which needs
   '.jini-composer' itself — the nearest positioned ancestor — not this wrapper, to anchor against. */
.jini-chat-pane .jini-composer-workdir { display: inline-flex; }
.jini-chat-pane .jini-composer-workdir-panel {
  position: absolute;
  z-index: 8;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px;
  background: var(--jini-chat-panel);
  border: 1px solid var(--jini-chat-border);
  border-radius: 10px;
  box-shadow: 0 12px 30px rgb(0 0 0 / 14%);
}
.jini-chat-pane .jini-composer-workdir-input {
  flex: 1;
  min-width: 160px;
  padding: 6px 8px;
  color: var(--jini-chat-text);
  font: inherit;
  background: var(--jini-chat-subtle);
  border: 1px solid var(--jini-chat-border);
  border-radius: 6px;
}
.jini-chat-pane .jini-composer-workdir-confirm {
  padding: 6px 10px;
  color: white;
  white-space: nowrap;
  background: var(--jini-chat-text-strong);
  border: 0;
  border-radius: 6px;
  cursor: pointer;
}
.jini-composer-spinner,
.jini-runtime-spinner { animation: jini-chat-spin .8s linear infinite; }
@keyframes jini-chat-spin { to { transform: rotate(360deg); } }
.jini-chat-pane .jini-composer-footer-accessories {
  display: flex;
  margin-left: auto;
  min-width: 0;
}
.jini-chat-pane .jini-composer-send {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  padding: 0;
  color: white;
  background: var(--jini-chat-text-strong);
  border: 0;
  border-radius: 8px;
  cursor: pointer;
}
.jini-chat-pane .jini-composer-send:disabled {
  color: #aaa59e;
  background: #ece8e2;
  cursor: default;
}
.jini-chat-pane__workdir {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  padding: 5px 4px 0;
  color: var(--jini-chat-muted);
  font-size: 13px;
}
.jini-chat-pane__workdir code {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.jini-chat-pane .jini-working-dir-picker {
  position: relative;
  display: inline-flex;
  align-items: flex-start;
}
.jini-chat-pane .jini-working-dir-trigger-row {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.jini-chat-pane .jini-working-dir-trigger {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  color: var(--jini-chat-muted);
  background: transparent;
  border: 0;
  border-radius: 8px;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.jini-chat-pane .jini-working-dir-trigger:hover,
.jini-chat-pane .jini-working-dir-trigger:focus-visible {
  color: var(--jini-chat-text-strong);
  background: var(--jini-chat-subtle);
  outline: none;
}
.jini-chat-pane .jini-working-dir-trigger.invalid { color: var(--danger); }
.jini-chat-pane .jini-working-dir-trigger-icon { flex: 0 0 auto; opacity: .75; }
.jini-chat-pane .jini-working-dir-trigger.invalid .jini-working-dir-trigger-icon {
  color: var(--danger);
  opacity: 1;
}
.jini-chat-pane .jini-working-dir-trigger-label {
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.jini-chat-pane .jini-working-dir-trigger-chevron { flex: 0 0 auto; opacity: .55; }
.jini-chat-pane .jini-working-dir-panel,
.jini-chat-pane .jini-working-dir-flyout {
  position: absolute;
  z-index: 90;
  display: flex;
  flex-direction: column;
  min-width: 210px;
  padding: 5px;
  background: var(--jini-chat-panel);
  border: 1px solid var(--jini-chat-border-strong);
  border-radius: 12px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, .04), 0 10px 28px -10px rgba(0, 0, 0, .18);
}
.jini-chat-pane .jini-working-dir-panel {
  top: calc(100% + 6px);
  left: 0;
}
.jini-chat-pane .jini-working-dir-panel.up {
  top: auto;
  bottom: calc(100% + 6px);
}
.jini-chat-pane .jini-working-dir-item {
  appearance: none;
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  min-height: 32px;
  padding: 0 9px;
  color: var(--jini-chat-text-strong);
  background: transparent;
  border: 0;
  border-radius: 8px;
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.jini-chat-pane .jini-working-dir-item:hover,
.jini-chat-pane .jini-working-dir-item:focus-visible,
.jini-chat-pane .jini-working-dir-recent-item:hover,
.jini-chat-pane .jini-working-dir-recent-item:focus-visible {
  background: var(--jini-chat-subtle);
  outline: none;
}
.jini-chat-pane .jini-working-dir-item-icon { flex: 0 0 auto; opacity: .8; }
.jini-chat-pane .jini-working-dir-item > span {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.jini-chat-pane .jini-working-dir-item-chevron { margin-left: auto; opacity: .55; }
.jini-chat-pane .jini-working-dir-submenu-row { position: relative; }
.jini-chat-pane .jini-working-dir-flyout {
  top: -5px;
  left: 100%;
  z-index: 91;
  min-width: 220px;
  max-width: 320px;
  margin-left: 4px;
}
.jini-chat-pane .jini-working-dir-flyout.up { top: auto; bottom: -5px; }
.jini-chat-pane .jini-working-dir-flyout::before {
  position: absolute;
  top: 0;
  left: -8px;
  width: 8px;
  height: 100%;
  content: "";
}
.jini-chat-pane .jini-working-dir-recent-item {
  appearance: none;
  display: grid;
  grid-template-rows: auto auto;
  grid-template-columns: auto 1fr;
  align-items: center;
  width: 100%;
  min-height: 36px;
  padding: 4px 9px;
  color: var(--jini-chat-text-strong);
  background: transparent;
  border: 0;
  border-radius: 8px;
  font: inherit;
  text-align: left;
  cursor: pointer;
  column-gap: 9px;
}
.jini-chat-pane .jini-working-dir-recent-item .jini-working-dir-item-icon {
  grid-row: 1 / span 2;
}
.jini-chat-pane .jini-working-dir-recent-name,
.jini-chat-pane .jini-working-dir-recent-path {
  grid-column: 2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.jini-chat-pane .jini-working-dir-recent-name { font-size: 13px; }
.jini-chat-pane .jini-working-dir-recent-path {
  color: var(--jini-chat-muted);
  font-size: 11px;
  opacity: .7;
}
.jini-chat-pane .jini-working-dir-empty {
  padding: 8px 10px;
  color: var(--jini-chat-muted);
  font-size: 12px;
  white-space: nowrap;
  opacity: .7;
}
.jini-runtime-picker { position: relative; }
.jini-runtime-trigger {
  display: inline-grid;
  grid-template-columns: 24px 14px;
  align-items: center;
  gap: 7px;
  height: 32px;
  min-width: 0;
  padding: 3px 7px 3px 5px;
  color: var(--jini-chat-text);
  background: transparent;
  border: 0;
  border-radius: 8px;
  cursor: pointer;
}
.jini-runtime-trigger:hover { background: var(--jini-chat-subtle); }
.jini-runtime-trigger__copy { display: none; }
.jini-runtime-trigger__copy strong {
  overflow: hidden;
  max-width: 122px;
  font-size: 11px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.jini-runtime-trigger__copy small {
  overflow: hidden;
  max-width: 122px;
  color: var(--jini-chat-muted);
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.jini-runtime-trigger__chevron { color: var(--jini-chat-muted); font-size: 12px; }
.jini-runtime-agent-icon.agent-icon { flex: 0 0 auto; object-fit: contain; }
.jini-runtime-agent-icon.agent-icon-mono {
  display: inline-block;
  background-color: currentColor;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
}
.jini-runtime-agent-icon.agent-icon-fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #74716b;
  background: #f4f5f7;
  border: 1px solid #e1e5eb;
  border-radius: 6px;
  font-weight: 700;
}
.jini-runtime-popover {
  --jini-chat-panel: #fdfcfa;
  --jini-chat-text: #1a1916;
  --jini-chat-text-strong: #0d0c0a;
  --jini-chat-muted: #74716b;
  --jini-chat-faint: #b3b0a8;
  --jini-chat-border: #e1e5eb;
  --jini-chat-border-soft: #edf0f4;
  --jini-chat-subtle: #f4f5f7;
  box-sizing: border-box;
  padding: 8px;
  color: var(--jini-chat-text);
  background: var(--jini-chat-panel);
  border: 1px solid var(--jini-chat-border);
  border-radius: 12px;
  box-shadow: 0 18px 46px rgba(13, 12, 10, .15), 0 2px 8px rgba(13, 12, 10, .06);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei UI", "Noto Sans", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 13.5px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
.jini-runtime-popover__head {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 10px 12px 12px;
  border-bottom: 1px solid var(--jini-chat-border-soft);
}
.jini-runtime-popover__head strong { color: var(--jini-chat-text-strong); font-size: 14px; font-weight: 650; }
.jini-runtime-popover__head span { color: var(--jini-chat-muted); font-size: 12px; }
.jini-runtime-mode,
.jini-runtime-agent,
.jini-runtime-rescan {
  display: flex;
  align-items: center;
  gap: 11px;
  box-sizing: border-box;
  width: 100%;
  min-height: 40px;
  padding: 8px 11px;
  color: var(--jini-chat-text);
  background: transparent;
  border: 0;
  border-radius: 8px;
  text-align: left;
  cursor: pointer;
}
.jini-runtime-mode:hover,
.jini-runtime-agent:hover:not(:disabled),
.jini-runtime-rescan:hover:not(:disabled) { background: var(--jini-chat-subtle); }
.jini-runtime-mode.is-active { font-weight: 650; }
.jini-runtime-mode:disabled,
.jini-runtime-agent:disabled,
.jini-runtime-rescan:disabled { color: var(--jini-chat-faint); cursor: default; }
.jini-runtime-mode__meta,
.jini-runtime-agent__status {
  margin-left: auto;
  color: var(--jini-chat-muted);
  font-size: 12px;
  white-space: nowrap;
}
.jini-runtime-check { flex: 0 0 auto; color: var(--jini-chat-text); }
/* Matches .jini-message-attachment-chip/.jini-md-table-expand's pill chrome (same
   background/border/radius formula) so this reads as the same badge language already used
   elsewhere in the pane, not a new one. Sits between the agent name and its status column —
   flex: 0 0 auto keeps it from stretching or shrinking when the row is tight. */
.jini-runtime-agent__badge {
  flex: 0 0 auto;
  padding: 2px 8px;
  color: var(--jini-chat-muted);
  background: var(--jini-chat-subtle);
  border: 1px solid var(--jini-chat-border);
  border-radius: 999px;
  font-size: 10px;
  font-weight: 500;
  white-space: nowrap;
}
.jini-runtime-section-label {
  padding: 12px 11px 5px;
  color: var(--jini-chat-faint);
  font-size: 11px;
  font-weight: 650;
  letter-spacing: .08em;
  text-transform: uppercase;
}
.jini-runtime-agent.is-active { background: transparent; }
.jini-runtime-agent__copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.jini-runtime-agent__copy strong { font-size: 13.5px; font-weight: 500; }
.jini-runtime-agent__copy small {
  overflow: hidden;
  color: #8b857e;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.jini-runtime-empty { padding: 10px 11px; color: var(--jini-chat-muted); font-size: 12px; }
.jini-runtime-models {
  display: flex;
  flex-direction: column;
  gap: 9px;
  margin-top: 5px;
  padding: 10px 11px 8px;
  border-top: 1px dashed var(--jini-chat-border);
}
.jini-runtime-select {
  display: flex;
  flex-direction: column;
  gap: 5px;
  color: var(--jini-chat-muted);
  font-size: 13px;
}
.jini-runtime-select select {
  box-sizing: border-box;
  width: 100%;
  min-height: 40px;
  padding: 7px 10px;
  color: var(--jini-chat-text);
  background: var(--jini-chat-panel);
  border: 1px solid var(--jini-chat-border);
  border-radius: 8px;
}
/*
 * The BYOK model, rendered as a value rather than a control — see RuntimeByokDetails for why it
 * is not a disabled select. It occupies the same box the sibling selects do so the row still
 * reads as part of the same list, but carries no border: a bordered box with no affordance is
 * exactly the "looks editable, isn't" shape the plain text exists to avoid.
 */
/*
 * The BYOK model list, which CustomSelect portals to document.body. runtimePopoverPosition puts
 * the runtime popover at z-index 1000; the shared .jini-select-menu default is 60, which is right
 * everywhere else and puts this menu behind the very popover that opened it. One above the
 * popover, not far above: it must clear its own surface and nothing else.
 */
.jini-select-menu.jini-runtime-model-menu {
  z-index: 1001;
}
.jini-runtime-byok-model strong {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  min-height: 40px;
  padding: 7px 10px;
  color: var(--jini-chat-text);
  font-weight: 600;
  word-break: break-all;
}
/*
 * Tool-call cards (ToolCard.tsx) and the per-turn usage summary (MessageRow.tsx) ship no CSS of
 * their own — see this file's own header note on why the package supplies a default theme at all.
 * Collapsed by default (.op-card-head is the only always-visible part), so a run with a dozen tool
 * calls reads as a dozen one-line rows, not a page of raw JSON.
 */
.jini-chat-pane .jini-message-tools {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}
.jini-chat-pane .op-card {
  border: 1px solid var(--jini-chat-border);
  border-radius: var(--radius);
  background: var(--jini-chat-subtle);
  overflow: hidden;
  font-size: 13px;
}
.jini-chat-pane .op-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  background: none;
  border: 0;
  font: inherit;
  text-align: left;
  cursor: pointer;
  color: inherit;
}
.jini-chat-pane .op-status { display: inline-flex; flex-shrink: 0; }
.jini-chat-pane .op-status-ok { color: #4e875f; }
.jini-chat-pane .op-status-error { color: var(--danger); }
.jini-chat-pane .op-status-running { color: var(--jini-chat-accent); }
.jini-chat-pane .op-title { font-weight: 600; flex-shrink: 0; }
.jini-chat-pane .shimmer-text { opacity: .6; }
.jini-chat-pane .op-meta {
  color: var(--jini-chat-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}
.jini-chat-pane .op-expand-chev { flex-shrink: 0; color: var(--jini-chat-faint); }
/* Collapsed by default: 0 max-height clips the inner content, no display:none — keeps the height
   transition instead of an instant jump cut. */
.jini-chat-pane .accordion-collapsible { max-height: 0; overflow: hidden; transition: max-height .15s ease; }
.jini-chat-pane .accordion-collapsible.open { max-height: 480px; overflow-y: auto; }
.jini-chat-pane .accordion-collapsible-inner { padding: 0 10px 10px; }
.jini-chat-pane .op-card-detail { display: flex; flex-direction: column; gap: 6px; }
.jini-chat-pane .op-path,
.jini-chat-pane .op-command,
.jini-chat-pane .op-output {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  background: var(--jini-chat-panel);
  border: 1px solid var(--jini-chat-border);
  border-radius: 6px;
  padding: 6px 8px;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}
.jini-chat-pane .op-open {
  border: 1px solid var(--jini-chat-border-strong);
  border-radius: 6px;
  background: var(--jini-chat-panel);
  padding: 2px 8px;
  font-size: 11px;
  cursor: pointer;
}
/* The "Done · 6m 29s · 2612 out · $0.4028" line — real numbers from the run's own kind:'usage' event. */
.jini-chat-pane .jini-message-usage {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--jini-chat-muted);
  margin-top: 2px;
}
.jini-chat-pane .jini-message-usage-dot { font-size: 8px; color: #4e875f; }
/*
 * Fenced code block ('Markdown.tsx''s 'renderBlock' case 'code') and inline 'code' span visual
 * treatment — previously entirely unstyled (bare UA-default '<pre><code>', no background, border,
 * or padding; a downstream admin host's own stylesheet already flagged this gap in a note next to
 * its unrelated horizontal-scroll fix for the same element). Lives HERE, in the package's own
 * injected default theme, rather than in a host's stylesheet: a host CAN already remap the exact
 * '--jini-chat-*' custom properties this rule reads (one such host's '.admin-chat-dock .jini-chat-
 * pane' block already does, for every other rule in this file), so putting the fix here makes every
 * Jini host look correct by default AND lets a host match its own palette for free, with no new
 * host-side override rule needed at all — the reverse (host-only CSS) would leave every other
 * embedder of '@jini-ai/chat' with the same unstyled '<pre>' this fix exists to correct.
 * 'max-width'/'overflow-x' here duplicate (harmlessly) a narrower fix that same host's own
 * '.jini-message-content pre' rule already carries for its own fixed-width dock specifically — this
 * package cannot assume every host has that rule, so a real host-agnostic default belongs here too.
 * NOTE: this comment avoids backtick quoting on purpose — this whole stylesheet lives inside a JS
 * template literal, so a literal backtick here would terminate the string, not just this comment.
 */
.jini-chat-pane .jini-message-content pre {
  margin: 6px 0;
  max-width: 100%;
  overflow-x: auto;
  padding: 10px 12px;
  background: var(--jini-chat-subtle);
  border: 1px solid var(--jini-chat-border);
  border-radius: 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12.5px;
  line-height: 1.5;
}
.jini-chat-pane .jini-message-content pre code {
  padding: 0;
  background: none;
  border: 0;
  color: inherit;
  font: inherit;
}
.jini-chat-pane .jini-message-content :not(pre) > code {
  padding: .15em .4em;
  background: var(--jini-chat-subtle);
  border: 1px solid var(--jini-chat-border);
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: .9em;
}
/*
 * Copy affordance for a fenced code block ('Markdown.tsx''s 'CodeBlock'/'CopyCodeButton'). The
 * button lives in its own toolbar row fused to the TOP of the '<pre>' below, not overlaid on top
 * of the code itself — an overlay would sit over whatever text happens to render at that corner,
 * and '<pre>' already carries its own horizontal scrollbar along its own bottom edge, so a row
 * above it can never collide with that scrollbar either. '.jini-md-code-block' takes over the
 * '<pre>' rule's own top/bottom margin above so the two don't stack, and the toolbar/pre pair
 * share one rounded box (toolbar keeps the top corners, '<pre>' below loses them) instead of two
 * separately-bordered boxes stacked on each other.
 */
.jini-chat-pane .jini-message-content .jini-md-code-block {
  margin: 6px 0;
}
.jini-chat-pane .jini-message-content .jini-md-code-block pre {
  margin: 0;
  border-top: 0;
  border-top-left-radius: 0;
  border-top-right-radius: 0;
}
.jini-chat-pane .jini-md-code-toolbar {
  display: flex;
  justify-content: flex-end;
  padding: 3px;
  background: var(--jini-chat-subtle);
  border: 1px solid var(--jini-chat-border);
  border-bottom: 0;
  border-radius: 8px 8px 0 0;
}
.jini-chat-pane .jini-md-code-copy {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  color: var(--jini-chat-faint);
  background: none;
  border: 0;
  border-radius: 6px;
  cursor: pointer;
}
.jini-chat-pane .jini-md-code-copy:hover { color: var(--jini-chat-muted); background: var(--jini-chat-border); }
.jini-chat-pane .jini-md-code-copy:focus-visible { outline: 2px solid var(--jini-chat-accent); outline-offset: 1px; }
/* Visually hidden but present in the DOM (never display:none) so this polite live region still
   gets announced — same clip-rect technique 'jini-message-copy-status' above already uses. */
.jini-chat-pane .jini-md-code-copy-status {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
}
/*
 * GFM pipe tables ('Markdown.tsx''s 'TableBlock') — same reasoning as the code-block rules directly
 * above for living in the package's own default theme rather than a host stylesheet. '.jini-md-
 * table-wrap' gets its own horizontal scrollbar so a wide table scrolls internally instead of
 * dragging '.jini-message-list' sideways with it (the exact failure mode that same downstream host's
 * stylesheet documents for the code-block case — the same fix shape applies here). The "Expand
 * table" button only renders ('TableBlock''s own logic) once the table has genuinely overflowed
 * that wrap.
 */
.jini-md-table-wrap {
  max-width: 100%;
  overflow-x: auto;
}
.jini-md-table {
  border-collapse: collapse;
  font-size: 12.5px;
}
/*
 * 'min-width' here, not on '.jini-md-table' itself, and picked per column rather than as one flat
 * table-wide number -- a flat table minimum sized for a typical 2-column table would leave a
 * 5-column table crushed just as badly as before (same failure this comment's neighbor above
 * describes), while one sized for 5 columns would force pointless overflow on a simple 2-column
 * table. Per-cell 'min-width' scales the effective table floor with the real column count instead.
 * 130px was picked empirically, not guessed: measured (real Chromium, not jsdom -- 'scrollWidth'/
 * 'clientWidth' are unimplemented there) against this package's narrowest known real host, an
 * admin chat dock fixed at 380px wide ('admin-chat-dock' in that host's own stylesheet), which
 * nets out to roughly 238px of usable width once that dock's own message-list padding, the 80%
 * message-bubble cap, and this content's own padding are all applied. Below 120px per column the
 * table still fits inside those 238px and never overflows -- the exact bug this fix exists to
 * correct. 130px was chosen just above that measured 120px crossover (a small margin so it clears
 * reliably rather than sitting exactly on the boundary) and reads as a genuinely defensible per-
 * column floor on its own terms too: with this rule's own 6px/10px cell padding subtracted, it
 * leaves about 110px of text room, roughly 14-16 characters per wrapped line at this rule's 12.5px
 * font -- enough that a table cell wraps in short phrases instead of one word per line, which is
 * the readability floor this fix is actually chasing. One real consequence, verified rather than
 * hand-waved: at this width, ANY 2-column table in that narrow dock now overflows and gets the
 * "Expand table" affordance, including ones with short cell content -- there is no per-cell
 * min-width value that can overflow a long-prose 2-column table without also overflowing a short
 * one at the same column count, because the browser's own auto-layout table-width algorithm sizes
 * the table to the greater of its container's width and the sum of each column's own minimum --
 * content length past that minimum only changes how much a column wraps internally, never whether
 * the table exceeds its wrap. Accepted here: in a surface already this narrow, showing "Expand
 * table" a little more eagerly is the better failure mode than silently crushing a table's own
 * content illegibly, which is the state this whole rule exists to fix.
 */
.jini-md-table th,
.jini-md-table td {
  padding: 6px 10px;
  min-width: 130px;
  border: 1px solid var(--jini-chat-border);
  text-align: left;
}
.jini-md-table th {
  background: var(--jini-chat-subtle);
  color: var(--jini-chat-text-strong);
  font-weight: 650;
}
.jini-md-table-expand {
  margin-top: 4px;
  padding: 4px 10px;
  color: var(--jini-chat-muted);
  background: var(--jini-chat-panel);
  border: 1px solid var(--jini-chat-border);
  border-radius: 999px;
  font-size: 11px;
  cursor: pointer;
}
.jini-md-table-expand:hover { color: var(--jini-chat-text-strong); }
.jini-md-table-modal {
  max-width: min(90vw, 900px);
  max-height: 80vh;
  overflow: auto;
  padding: 20px;
  color: var(--jini-chat-text);
  background: var(--jini-chat-panel);
  border: 1px solid var(--jini-chat-border);
  border-radius: 12px;
  box-shadow: 0 18px 46px rgba(13, 12, 10, .15), 0 2px 8px rgba(13, 12, 10, .06);
}
.jini-md-table-modal::backdrop {
  background: rgba(0, 0, 0, .4);
}
.jini-md-table-modal-close {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 28px;
  height: 28px;
  color: var(--jini-chat-muted);
  background: transparent;
  border: 0;
  border-radius: 6px;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}
.jini-md-table-modal-close:hover {
  color: var(--jini-chat-text-strong);
  background: var(--jini-chat-subtle);
}
@media (max-width: 560px) {
  .jini-chat-pane__header { padding-inline: 16px; }
  .jini-chat-pane .jini-message-list { padding-inline: 16px; }
  .jini-chat-pane__controls { padding-inline: 10px; }
}
/*
 * Attachment preview modal (MessageRow.tsx's chip -> AttachmentPreviewModal.tsx). Same
 * native-<dialog> shape as .jini-md-table-modal above (own box sized to content, not viewport;
 * ::backdrop dims the page), kept as its own class rather than reusing that one because the two
 * differ in intent: a table pop-out is a fixed-chrome expansion of content already on screen, this
 * is a general image/text/metadata viewer with its own header and a dedicated close control.
 */
.jini-attachment-preview-dialog {
  display: flex;
  flex-direction: column;
  width: min(90vw, 720px);
  max-height: 80vh;
  padding: 0;
  color: var(--jini-chat-text);
  background: var(--jini-chat-panel);
  border: 1px solid var(--jini-chat-border);
  border-radius: 12px;
  box-shadow: 0 18px 46px rgba(13, 12, 10, .15), 0 2px 8px rgba(13, 12, 10, .06);
}
.jini-attachment-preview-dialog::backdrop {
  background: rgba(0, 0, 0, .4);
}
.jini-attachment-preview-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--jini-chat-border-soft);
}
.jini-attachment-preview-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 650;
  color: var(--jini-chat-text-strong);
}
.jini-attachment-preview-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 26px;
  height: 26px;
  margin-left: auto;
  padding: 0;
  color: var(--jini-chat-muted);
  background: none;
  border: 0;
  border-radius: 6px;
  cursor: pointer;
}
.jini-attachment-preview-close:hover {
  color: var(--jini-chat-text-strong);
  background: var(--jini-chat-subtle);
}
.jini-attachment-preview-body {
  display: flex;
  flex: 1;
  min-height: 0;
  align-items: center;
  justify-content: center;
  padding: 16px;
  overflow: auto;
}
.jini-attachment-preview-image {
  display: block;
  max-width: 100%;
  max-height: calc(80vh - 90px);
  object-fit: contain;
  margin: auto;
}
.jini-attachment-preview-text {
  width: 100%;
  max-height: calc(80vh - 90px);
  margin: 0;
  padding: 12px;
  overflow: auto;
  color: var(--jini-chat-text);
  background: var(--jini-chat-subtle);
  border: 1px solid var(--jini-chat-border-soft);
  border-radius: 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
.jini-attachment-preview-truncated {
  width: 100%;
  margin-top: 8px;
  color: var(--jini-chat-muted);
  font-size: 11px;
  text-align: center;
}
.jini-attachment-preview-loading {
  color: var(--jini-chat-muted);
  font-size: 13px;
  font-style: italic;
}
.jini-attachment-preview-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  max-width: 360px;
  color: var(--jini-chat-text);
  font-size: 13px;
}
.jini-attachment-preview-meta-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.jini-attachment-preview-meta-label {
  color: var(--jini-chat-faint);
}
.jini-attachment-preview-meta-note {
  margin-top: 6px;
  color: var(--jini-chat-muted);
  font-size: 12px;
}
`;
