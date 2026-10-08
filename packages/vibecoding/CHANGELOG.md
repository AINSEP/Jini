# Changelog

## 0.4.1

### Patch Changes

- Tovu clean-up release (2026-10-08): code Tovu moved into Jini, plus the Jini clean-up (see the commit log since 0.4.0).

## 0.4.0 — 2026-10-02

### BREAKING

- Pure kernel containment and isolated HTML/React entries remain; shared ports and public object-argument contracts replace local vocabulary.
- Distribution includes runtime output, release documentation and required assets only. Process records and per-job neutrality checks are no longer part of the package surface.

## Unreleased

- Fixed compilation against the current core contracts: tool input errors use `{ message }`,
  and registry integration tests use object arguments for registry creation and listing.
  The parse5 factory return type now exposes its always-present `checkWellFormed` method.
  Error messages and parser behavior are unchanged.

- Integration follow-up: reconciled the `./core`, `./html`, `./html/node` and `./react`
  surfaces, including HTML parser/storage ports, session/history, discoverable tool registrations,
  direct tool runner, React hook and preview components. Export metadata and optional React peers
  were already present and are retained. No version change or new dependency is required.
- BREAKING: `createVibecodingSession({ target }, { historyOptions })` separates required ports
  from optional tuning. `VibecodingSessionOptions` now contains only history tuning; the required
  target lives in the new `VibecodingSessionArgs` type. `useVibecodingSession`,
  `createVibecodingToolRegistrations` and `createVibecodingToolRunner` receive `{ session }`.
- BREAKING: session subscriptions, part reads, edit batches and snapshot rewinds take named
  objects; labels are in the optional second object. Hook actions share these method types.
  The runner uses `run({ toolId, input })`. Tool wire schemas and React component props are unchanged.
- Fixed session caching for repeated part ids and reverse-order undo. Selected previews now
  refresh after history replay. Added regression, composition, export-map and whole-source
  neutrality tests, and migrated the existing React test fixtures and README API examples.
- Integration status supersedes the earlier React ownership note below: the cleared React
  directory and its dependent calls are now migrated. Tests, typechecks, builds and pack checks
  remain **not run (owner directive)**; no runtime correctness or release readiness is claimed.

- BREAKING: `applyEdit`, `applyEdits`, `correctionsFor`, `createEditHistory`, and
  `isValidRegionHandle` accept named required arguments. `createHtmlRegionTarget`
  receives optional settings as its second object, separate from storage and parser ports.
- BREAKING: `EditTarget.readPart`, `replacePart`, and `restore`, `EditHistory.transaction`
  and `restore`, `HtmlRegionParser.findRegions` and `checkWellFormed`, and
  `HtmlDocumentStore.write` accept named object arguments. Transaction labels belong
  to the optional second object. Export names and edit/history behavior are preserved.
- Updated core/HTML behavior tests and added a package neutrality guard. Verification
  is deferred by owner directive. The pre-existing React worktree remains unchanged;
  its dependent calls require migration before package verification or release.
