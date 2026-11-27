# Bundled publisher-ID rename upgrade

Working tree only; coordinator commits. Do not commit this file. No installs,
builds, tests, typechecks, or linters run, per dispatch.

## 1. Completed: characterization tests first

Suggested commit: `test(agent-plugins): cover publisher upgrade with historical revisions`

Files:
- `packages/agent-plugins/src/site/__tests__/bundled-id-upgrade.test.ts`

Added before production edits:
- `multiple pre-rename revisions upgrade when only the current revision is ledgered`
  requires both revisions to move to package-only backups and only the ledgered
  current revision to be packed. Historical bytes deliberately do not re-pack to
  their digest and are never trusted as content.
- `a tampered ledgered current revision holds every pre-rename revision without moving history`
  requires the tampered-current reason and zero renames even with history listed
  first.

Named mutations for coordinator/cloud verification (not executed):
- `require-every-historical-revision-to-match-current-ledger`: reinstate the
  per-revision ledger mismatch refusal in `unverifiedReason`; the positive
  multi-revision test must fail.
- `accept-tampered-ledgered-current-revision`: remove the re-packed digest
  mismatch refusal; the new tampered-current test must fail.
- `accept-unledgered-current-revision`: remove the requirement that the ledgered
  digest is present among this plugin's blockers; the existing test
  `a revision the ledger does not name is held with the INJECTED wording, never moved`
  must fail.

Expected RED by source inspection only: the current implementation holds the
historical revision with the ledger-mismatch reason before checking the current
revision. No RED/GREEN or mutation execution is claimed. Test count: 10 -> 12;
no existing tests deleted or weakened.

## 2. Completed: verify current provenance, quarantine historical packages

Suggested commit: `fix(agent-plugins): upgrade bundled ids with historical revisions`

Files:
- `packages/agent-plugins/src/site/bundled-id-upgrade.ts`
- `.changeset/bundled-id-upgrade-history.md`

Kept the existing port, outcomes, publisher checks, frozen-tree moves, backup
paths, restore behavior, and lock ordering. Required a ledgered current blocker
and verified its bytes before moving anything. Historical blockers retain their
publisher check but do not acquire content trust. Only package roots move;
activation, data/, and memory/ are outside those roots. Updated existing comments
to describe the revised provenance scope. Added the package patch changeset.

No new exports or subpaths are needed on Tovu. Consume the patched existing
`@jini-ai/agent-plugins/site/bundled-id-upgrade` subpath, then run the existing
Tovu regression from `codex/tv-ghfix`.

## Review and handoff

- Built: the one dispatched Jini bug fix and patch changeset. No stopped or
  dependent implementation sheets; runtime verification remains for Opus/cloud.
- Reuse: extended the existing upgrade owner and its injected port; inspected
  `site/bundled-id-upgrade.ts`, its unit tests, and lifecycle
  `bundled-digests.ts`, `resolve-agent-plugin-refs.ts`, `index.ts`,
  `installed-package-index.ts`, and `install.ts`. No new helpers, interfaces,
  types, dependencies, exports, or wrappers.
- Architecture audit: PASS by source inspection for all three deliverable files.
  Current means the ledger-selected digest, as in the existing lifecycle; there
  is no separate current pointer on the upgrade port. Package backups are
  dot-prefixed and excluded from live package discovery. Owner state has no
  write/delete path in the upgrade port. Existing restore and lock code is
  untouched.
- Function assessment: `upgradeOne` and `unverifiedReason` are INCONCLUSIVE on
  runtime evidence because execution is prohibited. Source review found no new
  structural issues: existing injected effects, stable outcome contracts,
  O(r) blocker scans, O(f) re-packing of ledgered current files, O(r) moved-path
  retention. No new resource or abstraction layer.
- Adversarial evidence added first: history listed before current, different
  historical digest/content, and tampered current with no partial movement.
- Fresh textual validation: `git diff --check` passed before final review;
  final working-tree diff reviewed for scope. No existing tests deleted,
  weakened, skipped, or excluded. No coverage result is claimed.
- Final scope review deletions: removed only the now-unused private
  `ledgerMismatchReason` argument/property from `unverifiedReason`; no unrelated
  code removed. The ledger-presence guard follows publisher checks to retain
  publisher-refusal wording before any move.
- Self-validation not run: dispatch expressly prohibits installs, builds,
  tests, typechecks, and linters. Coordinator must execute the 12-test file,
  named mutations, and the existing Tovu real-lifecycle regression.
