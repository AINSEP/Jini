# Y5M content — Jini working-tree handoff

Scope: C1, C2, C3 only. No host edits, subagents, installs, checks, or git writes.
The supplied sheets define the approved patterns and override generic workflow steps.
Tests are written first; execution and mutation runs belong to the coordinator.

## Planned commits, in build order

1. C1 — required native memory sampler slot and desktop subpath handoff.
   - packages/desktop-host/src/electron/__tests__/memory-sampler.test.ts
   - packages/desktop-host/src/electron/__tests__/desktop-resources.test.ts
   - packages/desktop-host/src/electron/memory-sampler.ts
   - .changeset/y5-desktop-memory-sampler.md
   - Mutation: `drop-missing-native-pid` filters out a PID missing from native results;
     partial-read inventory and `mixed-rss` assertions must fail.
2. C2 — injected video input, refusal constructor, and dependency assembly move.
   - packages/cms/src/media/site-import/__tests__/bindings.test.ts
   - packages/cms/src/media/site-import/bindings.ts
   - packages/cms/src/media/site-import/bindings.deps.ts
   - .changeset/y5-media-import-bindings.md
   - Mutation: `drop-injected-video-options` passes `video: undefined` for configured
     imports; typed URL/local forwarding assertions must fail. Host conversion-link
     integration assertions remain for the coordinator's host run.
3. C3 — one injected schema erasure for post SQL and search.
   - packages/cms/src/posts/sql/__tests__/y5-post-repo.test.ts
   - packages/cms/src/posts/sql/repo.ts
   - .changeset/y5-post-content.md
   - Mutation: `search-on-detached-kernel` passes a separate kernel to the projection;
     same-kernel identity and same-transaction rollback assertions must fail.

## Constraints and evidence

- Named anchors match the checkout; existing exports cover all three sheets.
- Preserve deferred reads, fallback rows, workspace selection, effect order, why-comments,
  direct erased-kernel construction, and lower handlers/conversion contracts.
- No dependency versions, lockfiles, themes, host files, or export shells change.
- Keep rules are host-owned: no host file becomes a G3 binding in this Jini-only task.
- LEFT-DESKTOP: dependency pin and lock refresh explicitly dropped from this dispatch.

## Completed logical commits (not committed)

1. C1 Jini side built: all four files listed above. Required sampler slot accepts
   undefined; new cases pin empty inventory and non-Windows fallback. Existing batch,
   partial/invalid/unavailable, zero, Windows conversion and mixed-RSS assertions remain.
2. C2 Jini side built: all four files listed above. Dependency assembly moved verbatim
   into bindMediaImportDeps; generic video input and constructor-based refusal wiring
   are bound through the existing subpath. URL/local uploads preserve option identity;
   replacement retains probe/signal and no upload; omitted conversion stays undefined.
3. C3 Jini side built: all three files listed above. One erasure per factory call;
   the resulting kernel goes to both constructor and search selection. The new test
   checks projection kernel identity, durable search output, and row/search rollback.

No sheets stopped. P1-P3 were excluded by dispatch. All host work remains with the
host coordinator, including deletion/G3 completion, call-site updates, and keep rules.

## Test evidence and handoff

Tests were edited before each sheet's implementation. No tests, mutation runs,
installs, builds, typechecks, or linters ran, as required. No runtime pass is claimed.
Declared cases, counted from HEAD and working-tree text only:

- memory-sampler.test.ts: 5 -> 6
- desktop-resources.test.ts: 1 -> 2
- bindings.test.ts: 5 -> 5 (existing cases strengthened)
- y5-post-repo.test.ts: 6 -> 7
- Total: 17 -> 20; no tests removed, skipped, or weakened.

Existing package export paths retained; no package.json edits or new public subpaths:

- @jini-ai/desktop-host/electron/memory-sampler
- @jini-ai/cms/media/site-import/bindings
- @jini-ai/cms/posts/sql/repo

New internal named export: bindMediaImportDeps in bindings.deps.ts (no public subpath).

## Static architecture and function review

Architecture audit: PASS on source inspection of the eleven listed implementation,
test and changeset files. Only named Jini files changed; vendor/server neutrality,
static imports, structural host dependencies, transformDefinitionRepo inheritance,
direct constructor, existing comments and effect order are preserved. The moved
assembly has the same getter/deferred-read order, workspace recording and byte ceiling.
Documentation additions were omitted per the dispatch's explicit no-new-comments rule.

Unit | disposition | findings | local fix
--- | --- | --- | ---
readDesktopMemory | INCONCLUSIVE | runtime evidence deferred | required slot only
bindMediaImportTools | INCONCLUSIVE | runtime/type evidence deferred | approved ports only
bindMediaImportDeps | INCONCLUSIVE | runtime/type evidence deferred | verbatim assembly
bindPostRepoFor | INCONCLUSIVE | runtime/type evidence deferred | shared erased kernel

No new behavioral risks found by source review; runtime/type verification remains
unproven. Construction is O(1); the unchanged memory sampling is O(p+e+r).
Rechecked variable names, optional forwarding, safe error recreation and SQL rollback
assertions. No new I/O, timers, caches, schema, or resource lifetimes were introduced.
Fresh evidence: git diff, git status, direct reads of new files, and text-only test
counts. Self-validation is deferred by explicit dispatch instruction; zero attempts.

Reuse: existing memory sampler, lower media handlers and converting uploader, and
SqlPostRepo/search projections remain the behavior owners named by C1-C3.

## Diff cleanup deletions

- Removed the old local bindDeps assembly after moving it to bindings.deps.ts;
  removed its no-longer-needed local imports and concrete uploader signature coupling.
- Removed uploader/video `as never` setup (and unnecessary replacement cast) in the
  named binding test; retained all prior behavioral assertions.
- Removed a redundant configured-video deep-equality assertion during final review;
  exact call count plus identity assertions for both calls provide the required signal.
- No files deleted in Jini; desktop duplicate deletion is host work.
