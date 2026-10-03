Spec ID: SPEC-JINI-VIBECODING-STATE
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:078d634ddd6db22871815b9dc48244dd88c590f927591a9cfe9599176263da09
spec_mode: reverse_spec


# State contract: vibecoding

## Target and history

Target persistence belongs entirely to `EditTarget`/`HtmlDocumentStore`. Snapshots are data maps, not process/build/environment captures. HTML snapshot IDs derive from region count and string length, so IDs are not unique content hashes.

History starts with empty undo/redo arrays; oldest undo entries are evicted over limit (default 50). New nonempty transactions clear redo. Empty transactions leave both stacks intact. Overlapping transactions reject; other actions have no global serialization lock. Consumers must serialize target operations.

Undo/redo use peek → ordered replay → stack transfer; failed replay retains the source-stack entry. Snapshot history restore uses capture → record → replay. A failed restore can therefore be undone, but replay is a series of writes with no transaction guarantee. `clear` drops stacks without changing content; `entries` returns a shallow array copy, not deeply frozen entries.

## Session cache

Construction is idle and performs no I/O. Each session owns history, content map and subscriber set. Work generally transitions loading → ready or error; a later successful operation recovers ready and clears lastError. `getSnapshot` returns the same reference between commits. Commits are shallow; readonly types do not freeze maps or contents.

Content is loaded per ID once and cached. Apply caches only applied proposals in order, undo caches reverse replay, redo caches forward replay. Refresh relists and prunes absent IDs. External changes to retained IDs remain stale; there is no invalidation/watch API. Discard/recreate the session or coordinate changes through its methods.

`subscribe({ listener })` returns an unsubscribe function. There is no dispose/shutdown or durable session serialization. Consumers must unsubscribe their listeners and retain snapshots externally if needed. The React hook subscribes with `useSyncExternalStore`, refreshes on mount/session identity change and cleans up its subscription.

## Viewer selection

Workbench selection and loading/content UI state are local to each component. Selection does not reset automatically when a selected part disappears or the session changes. Preview uses supplied whole-document HTML first, then selected content, then empty string.

Evidence: core/history, html/regions, React session/hook/workbench source and source tests.
