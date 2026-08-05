# Swarm Consensus Report — `design-systems/index.ts` Architecture

- **Date:** 2026-07-02
- **Mode:** debate, 1 round (unanimous — Round 2 not needed)
- **Result:** CONSENSUS REACHED (unanimous on all decisions)

## The Swarm

| Slot | Model | CLI | Confidence |
|------|-------|-----|------------|
| Primary | Claude Sonnet 4.6 | (host session) | 0.85 |
| Peer 1 | gpt-5.5 | codex 0.140.0, reasoning=medium | 0.82 |
| Peer 2 | Gemini 3.1 Pro (High) | agy 1.0.15 | 0.82 |

## Dispatch Diagnostics

- Context packet: `ADS-project-knowledge/.local-artifacts/swarm-consensus/context/CTX-design-systems-architecture-2026-07-02.md`
- codex dispatched via `codex exec -c model="gpt-5.5" - < packet` (stdin mode)
- agy dispatched via `agy --print "$(cat packet)"` from `/tmp` (avoids AGENTS.md pickup)
- agy ACK confirmed. codex produced output without explicit ACK line.
- Both returned exit 0.

## Individual Responses

### Primary / Claude Sonnet 4.6
Pick (a) flat domain modules now. (c) daemon-level feature slices is the right v2 but wrong timing while server.ts decomposition is in progress. (b) nested sub-slices inside design-systems/ adds folder overhead for no isolation benefit at this function scale. Confidence 0.85.

### Peer 1 / gpt-5.5
Pick (a) flat domain modules. Adds: enforce an explicit dependency direction rule — `files/body/types` are leaf modules; `catalogue/assets/user-registry/revisions/ui-kit` may import them, not the reverse. Recommends extracting largest/most-distinct clusters first (ui-kit, body, revisions, assets). Two-phase: extract first, then add import convention. Rejects (b) as premature taxonomy before stable boundaries. (c) is correct strategic direction but "combining domain extraction with composition-root surgery makes review harder and regression risk higher." Confidence 0.82.

### Peer 2 / Gemini 3.1 Pro (High)
Pick (a) flat domain modules, executed fully. Key addition: extract `types.ts` FIRST — every subsequent extraction is blocked by cross-cluster type dependencies. Bottom-up extraction order: leaf deps (file-utils.ts, body.ts, migration.ts) → mid-layer (revisions.ts, assets.ts) → top (reader.ts, user-registry.ts, ui-kit.ts). Rejects (b): "two layers of indirection for no isolation benefit — you now have design-systems/catalogue/index.ts which itself is a barrel." (c) right idea, wrong timing: "do (a) now; do (c) in 6 months once server.ts stabilizes." Mind-changer: if server.ts decomposition is already targeting a features/ layout, skip (a) and do (c) directly to avoid moving files twice. Confidence 0.82.

## Synthesis

**On Gemini's mind-changer:** The current branch (`arch/chatrun-service-extraction`) extractions (http/sse-registry.ts, shell/commands.ts, deploy/cloudflare-pages.ts, media/task-service.ts) are all flat — NOT inside a features/ folder. The in-progress work is not pre-targeting a features layout. Flip condition not met. (a) now stands.

## Decision Ledger

| Decision | Verdict | Notes |
|----------|---------|-------|
| (a) flat domain modules now | **ACCEPTED 3/3** | finish what was started |
| (b) nested sub-slices inside `design-systems/` | **REJECTED 3/3** | two layers of indirection for no isolation benefit |
| (c) daemon-level feature slices | **DEFERRED 3/3** | right direction — file as v2 issue, do after server.ts stabilizes |
| Extract `types.ts` first | **ACCEPTED 3/3** | unblocks every subsequent extraction |
| Enforce dependency direction (leaf → feature, not reverse) | **ACCEPTED 3/3** | codex addition; prevents structural cycles |
| CI guards from day one (madge, max-lines, barrel lint) | **ACCEPTED 2/3** | Gemini explicit, others implied |
| Extraction order: bottom-up (leaf → mid → top) | **ACCEPTED 3/3** | Gemini clearest, consistent with others |

## Final Recommendation

### Target structure

```
design-systems/
├── index.ts          ← ~30-line re-export barrel only (enforce with lint)
├── types.ts          ← FIRST — all types + constants (lines 1–255)
├── file-utils.ts     ← leaf 1 — fileExists, collectDesignSystemFiles, classifyDesignSystemFile
├── body.ts           ← leaf 2 — slugify, parseProvenance, provenanceToNotes,
│                        buildDraftDesignSystemBody, renderReadme
├── migration.ts      ← leaf 3 — migrateLegacyDesignSystemPackage, copyIfMissing,
│                        removeLegacyDesignSystemArtifacts
├── revisions.ts      ← mid 1 — parseDesignSystemRevision, writeAcceptedUserDesignSystemRevision,
│                        writeTextFilesAtomically, rollbackAtomicTextFileWrites
├── assets.ts         ← mid 2 — resolveDesignSystemAssets, pruneAssetsCache, fileFingerprint,
│                        buildDesignSystemPullIndex, withComponentsManifest
├── reader.ts         ← top 1 — listDesignSystems, readDesignSystem,
│                        readDesignSystemPullFile, readDesignSystemSourceEvidence
├── user-registry.ts  ← top 2 — createUserDesignSystem, updateUserDesignSystem,
│                        createUserDesignSystemRevision, deleteUserDesignSystem
├── ui-kit.ts         ← top 3 — renderUiKitComponent + 9 render* functions
└── [existing siblings untouched]
```

### Dependency direction rule

- `types.ts`, `file-utils.ts`, `body.ts` → import from nothing in this folder
- `migration.ts`, `revisions.ts`, `assets.ts` → leaf tier only
- `reader.ts`, `user-registry.ts`, `ui-kit.ts` → leaf + mid tiers
- `index.ts` → re-exports only, zero logic

### v2 plan

Daemon-level feature slices (`features/design-systems/` owning routes, domain, CLI together) — deferred to a separate GitHub issue filed with the open-design team. Do after server.ts decomposition completes and cli.ts is split.
