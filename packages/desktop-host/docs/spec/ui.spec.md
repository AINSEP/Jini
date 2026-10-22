Spec ID: SPEC-JINI-DESKTOP-HOST-UI
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:a0fa68cbea3b75851b1ea26305b0a1a819b0c01249ded3ea9cc09ca6f47bb6c6
spec_mode: reverse_spec


# UI Contract: desktop usability surfaces

## Components and slots

The package supplies native menu descriptors and IPC adapters, not renderer components or a mounted application. Consumers supply all labels, channels, native Menu bindings, focused-window lookup, search input/result display, zoom state and persistence adapters. There are no framework component slots or exported CSS/theme variables.

| Surface | Observable contract |
|---|---|
| `findMenu` | One host-labeled menu/item; default accelerator literal `CmdOrCtrl+F`; click sends host toggle channel to live focused content |
| `zoomMenuItems` | Actual-size, zoom-in, hidden unshifted `=` alias, zoom-out; accelerator literals `CmdOrCtrl+0`, `CmdOrCtrl+Plus`, `CmdOrCtrl+=`, `CmdOrCtrl+-` |
| `sendFindToggle` / `sendZoomCommand` | Return false for missing/destroyed/contentless window; otherwise send and return true |
| Find IPC | Search the caller's top-level window, forwarding text/forward/findNext; stop clears selection; unknown window is a no-op |
| Find result relay | Send only `{activeMatchOrdinal,matches}` while the window is live; ordinal is 1-based when a match exists |
| Spellcheck menu | Up to five suggestions by default, disabled no-suggestions placeholder if needed, add-to-dictionary, then edit actions when editable |
| Edit actions | Cut/copy/paste/select-all enabled from native edit flags; no menu when neither spelling nor editable actions exist |
| Window bounds | Restore finite saved rectangle only when it overlaps a display by at least 100 px on each axis by default; otherwise return caller fallback size without position |

`findNext=true` starts a fresh search session and false steps within one, matching the comment's native convention; matchCase is omitted for case-insensitive search. Find IPC does not supply a sender trust predicate. Native adapters must validate the sending context and translate menu callback/event shapes.

## Accessibility and theme ownership

Keyboard shortcuts are supplied as menu accelerator strings, and disabled items expose native `enabled:false`. The consumer owns OS shortcut parsing, focus management, search field label, result announcements, Escape/close behavior, localization and visible zoom feedback. Native accelerator acceptance was not checked here.

Speech bridge contains no microphone button, recording UI or permission dialog component. The consumer owns capture state, permission communication, accessible controls and transcript insertion. Capability absence is `{available:false,reason?}` and successful silence is empty text; do not display a fabricated transcript.

Sources: [Find menu](../../src/electron/usability/find-menu.ts), [zoom](../../src/electron/usability/zoom-menu.ts), [spelling](../../src/electron/usability/spellcheck-menu.ts), [bounds](../../src/electron/usability/window-bounds-store.ts), [speech ports](../../src/speech/transcription-port.ts).
