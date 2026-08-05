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
  --bg-panel: var(--jini-chat-panel);
  --bg-subtle: var(--jini-chat-subtle);
  --border: var(--jini-chat-border);
  --border-strong: var(--jini-chat-border-strong);
  --text: var(--jini-chat-text);
  --text-strong: var(--jini-chat-text-strong);
  --text-muted: var(--jini-chat-muted);
  --danger: #e5484d;
  --radius: 8px;
  --radius-lg: 12px;
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
   * pushes this list up), so its real height has to be reserved here instead. Measured against a
   * live render: the composer + footer + working-directory row alone is already 179.75px, above
   * the 170px this used to reserve -- the last message's tail rendered clipped under the overlay as
   * a direct result. 240px adds real margin above that measurement rather than matching it exactly,
   * because the composer also grows conditionally (a suggestions row, an attachment tray) that
   * this measurement did not have present.
   */
  padding: 20px 22px 240px;
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
  font-size: 11px;
  color: var(--jini-chat-muted);
  background: var(--jini-chat-subtle);
  border: 1px solid var(--jini-chat-border);
  border-radius: 999px;
  padding: 3px 10px;
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
.jini-chat-pane .jini-composer-leading {
  padding: 8px 12px 0;
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
.jini-chat-pane__cancel {
  position: absolute;
  right: 48px;
  bottom: 22px;
  padding: 5px 9px;
  color: var(--jini-chat-muted);
  background: var(--jini-chat-panel);
  border: 1px solid var(--jini-chat-border);
  border-radius: 7px;
  cursor: pointer;
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
@media (max-width: 560px) {
  .jini-chat-pane__header { padding-inline: 16px; }
  .jini-chat-pane .jini-message-list { padding-inline: 16px; }
  .jini-chat-pane__controls { padding-inline: 10px; }
}
`;
