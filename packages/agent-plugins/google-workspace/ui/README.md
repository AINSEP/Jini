# `ui/` - the Google Workspace admin panels

## Purpose

The plugin's own admin screens, declared in `../tovu-admin-surfaces.json` and mounted by the host as
sandboxed frames (Jini `@jini-ai/agent-plugins/admin-surfaces`; in Tovu,
`apps/website/src/features/agent-plugins/admin-surfaces/`). Three surfaces:

| surface id | entry | what the person does there |
|---|---|---|
| `connection` | `connection-panel.html` | Connect, reconnect, switch account (staged, confirm/cancel; confirming moves only the form destinations the person ticked, each after the new account opened its spreadsheet), disconnect and retry a pending revocation, turn Sheets on/off, grant a product's permission. |
| `picker` | `picker.html` | Choose a spreadsheet with Google's Picker; see the spreadsheets chosen so far. |
| `form-destinations` | `destination-panel.html` | Per form: spreadsheet (chosen one or the Picker) + tab (numeric sheet id); save or remove. |

## How it fits

```
frame (static files, served without credentials, CSP-locked)        server (handlerModule, never served)
  <name>.mjs ── dom.mjs ── surface-client.mjs ── action-request ──▶ host dispatcher ──▶ <name>.handler.mjs
                                             ◀── action-response ──                       │
                                                                       lib/surface-actions.mjs, lib/picker-flow.mjs,
                                                                       lib/form-destination-settings.mjs, lib/picker-selection.mjs
```

- Frame files: `*.html` entries, `*.mjs` frame scripts, `panel.css`. Text is always set with
  `textContent` (`dom.mjs`); no inline script or style (the CSP forbids both).
- `surface-client.mjs` is a verbatim copy of Jini's self-contained protocol client (see its header);
  refresh it when the protocol changes.
- `connection-view.mjs` and `picker-view.mjs` are pure wording modules (no DOM): the honesty rules
  ("Disconnected locally; Google revocation pending", "cancel changes nothing") live there and are
  tested there.
- Sign-in links: the frame has no `allow-popups`, so a handler's `begin` link is opened by the host
  page ("Continue to sign-in"); no handler returns the link.

## Public API (handler modules)

Form destinations declares the read-only `forms: ["list"]` capability. Its list/save/remove
results optionally include `forms: [{slug,title}]` (at most 200), so the panel offers site forms by
title and saves the chosen slug. An empty list keeps an empty selector; a failed initial read shows
the error without an editor. Only hosts without the capability use the typed short-name fallback.
The server's existing binding writer still checks that the selected form belongs to this workspace.

Each `*.handler.mjs` default-exports `{ actions, bootstrap? }` for its surface and exports its factory
(`createConnectionPanelHandlers()`, `createPickerHandlers({}, { now, randomId })`,
`createDestinationPanelHandlers({}, { now, randomId })`) for tests.

| surface | actions |
|---|---|
| `connection` | `status`, `sign-in { action }`, `confirm-switch { reassign: formSlug[] }` (result adds `reassignment: { moved, failed[{ formSlug, code, message }] }`), `cancel-switch`, `disconnect` (result adds `revocation: confirmed \| pending \| not-needed`), `set-product { productId, enabled }` |
| `picker` | bootstrap; `list-picked`, `verify-picked { sessionId, fileId }`, `start-system-picker`, `finish-system-picker` |
| `form-destinations` | the Picker's bootstrap and actions, plus `list-destinations`, `list-tabs { spreadsheetId }`, `save-destination { formSlug, spreadsheetId, sheetId, confirmExternalRows }`, `remove-destination { formSlug }` |

Plugin settings keys written here: `products` (`{ sheets: true }`), `picked-spreadsheets` (newest
first, at most 10, metadata + account), `form-destinations` (`{ <formSlug>: { spreadsheetId, title,
url, sheetId, tabTitle, accountId } }`, at most 50), and the transient `picker-session:<surface>` /
`picker-attempt:<surface>`. None holds a token.

## Hosted vs desktop Picker

The host decides (the handler call's `context.hostKind`), and the bootstrap's `mode` tells the frame:
`system-browser` on a desktop host (Google's native Picker as a code + PKCE sign-in with
`trigger_onepick` and the spreadsheet MIME filter; `picked_file_ids` comes back through the host's
callback inbox), `hosted` on a hosted site (the JS Picker inside the frame, with the bootstrap's
short-lived access token and the public `TOVU_GOOGLE_PICKER_BROWSER_KEY` / `TOVU_GOOGLE_PICKER_APP_ID`).
`unavailable` names why (not connected, permission missing, Sheets off, or a hosted site without both
Picker values: `picker-not-configured`). Every selection is verified by `lib/picker-selection.mjs` before it is saved.

## Extension points

A new product adds its switch automatically (the connection panel lists `products.json`); a new
action needs a declaration in `tovu-admin-surfaces.json` (closed schemas) and a handler in the
surface's module. Another provider plugin builds its own panels on the same host seam; nothing here
is imported by a host or Jini.
