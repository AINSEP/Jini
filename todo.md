# Todo

Lightweight cross-cutting backlog — not the formal ledger (that's
`ADS-memory/reports/jini-port/extraction-plan.md` §8 for engine port tasks, and
`ADS-memory/reports/jini-port/refactor-roadmap.md` for status). This file is for things
worth remembering that don't fit neatly into either, including items that
live in Open Design's own repo rather than Jini's.

## In flight

- **`features/html-viewer/` extraction** — dispatched 2026-07-18, fires
  09:20 UTC (2:20 AM PDT), branch `feature/jini-ui-html-viewer`. See details
  below; this entry stays until the branch is verified (not just
  self-reported) as actually done. Also folds in the audit-report lessons
  from PR #5228 and tonight's `port/source-config-list-resource-dashboard`
  failure (false i18n claims, unfulfilled port contracts, silently swallowed
  errors, per-file-vs-full-package coverage confusion, undetected duplicate
  primitives) as explicit things not to repeat.

## Priority

- **Extract a `features/html-viewer/` slice from `HtmlViewer` +
  `FileVersionManagerModal` into `@jini/ui`** (source:
  `apps/web/src/components/FileViewer.tsx` in the real Open Design fork/
  upstream). Same "read everything in full, find the real generic core,
  host-inject the rest" discipline already used for `viewer-shell`/
  `connectors`/`browser-chrome` — NOT a verdict that this is un-portable.
  A first pass (2026-07-18) sampled ~200 lines + a full state/handler grep
  and found real generic material worth a proper full-file read, not a
  reason to skip it:
  - `HtmlViewer` (~7,110 lines) — sandboxed HTML/iframe rendering + a
    postMessage bridge (possible overlap with `@jini/renderers-react`'s
    srcDoc sandbox core, check before duplicating), deck/slide navigation
    with zoom/fullscreen present, a full inline visual/DOM editor (click an
    element, edit live, undo/redo), and comment-pinning to rendered elements
    (related to `viewer-shell`'s already-shipped `CommentSidePanel`/
    `CommentSideDock`).
  - `FileVersionManagerModal` (~1,050 lines) — version history list +
    cached preview + restore; the list/preview/restore shape is plausibly
    generic even if the specific version-source data isn't.
  - Genuinely OD-specific, to be dropped or turned into host-injected ports
    (not ported): Cloudflare-specific deploy config, PPTX/template export,
    the board/pod live-collaboration system, brand extraction, and OD's own
    analytics event taxonomy.
  - Needs a real full read (both files, in full) before scoping the actual
    slice boundary — do not assume the split above is final.
  - **Also pick up `CodeWithLines`/`JsonPanel`** (two smaller, separate flat
    atoms also in `FileViewer.tsx`) in this same session — pulled out of a
    2026-07-18 flat-atoms dispatch specifically so they land here instead,
    since this session reads the whole file anyway.
  - **Learn from PR #5228 first** (the `MemorySection.tsx` decomposition
    attempt, closed 2026-07-15 without merging after an exhausting review
    cycle that surfaced real, pre-existing async/state-correctness bugs —
    see `packages/ui/source-map.md`'s memory-feature entry for the full
    writeup). Build the malformed-response / race-condition / missing-error-
    handling / stale-state-on-retry test gate *before* starting this
    extraction, not after discovering the bugs the hard way. Related,
    still-pending task: making that same test-category checklist a standing
    requirement in `ADS-memory/reports/jini-port/skills/fixing-open-design.md`/`-web.md`
    for future ports (tracked separately in this session's task list, not
    yet done).
