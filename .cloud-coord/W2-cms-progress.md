# W2 cms — coordinator progress

- Coordinator branch: `cloud/w2-cms` (from origin/general-work). Cloud proof commit 2c6f9f3e.
- Personas loaded by coordinator: software-architect/skills.md, code-inspection/skills.md (../AI-Dev-Shop, cloned depth 1).
- Setup: pnpm install + `pnpm --no-bail -r build` = 186 s (only @jini-ai/integrations failed tsc, as expected; dist emitted). cms `tsc --noEmit` clean at baseline.
- Temp eslint config: `.cx-eslint.config.mjs` at repo root (untracked; never commit).

## Baseline violations (cyc/cog > 10)
| file | fn | cyc | cog |
|---|---|---|---|
| seo/media.ts | resolveSeoImageDetails | 17 | 12 |
| seo/seo.ts | buildOpenGraph | 16 | 11 |
| seo/sitemap.ts | (fn @62) | ≤10 | 11 |
| seo/write-service.ts | (fn @269) | ≤10 | 11 |
| widgets/resolvers/contact-form.ts | resolveMany | 14 | 16 |
| widgets/resolvers/gallery.ts | (fn @17) | ≤10 | 15 |
| core/commands/command.ts | executeCommand | 18 | 16 |
| navigation/menu-service.ts | validateTarget | 14 | 12 |
| navigation/menu-service.ts | updateMenuTree | 11 | ≤10 |
| listing/batch.ts | (fn @48) | ≤10 | 11 |
| listing/paths.ts | parseListingBatchPath | 13 | ≤10 |
| comments/express/submit-handler.ts | createCommentSubmitHandler | 12 | ≤10 |

## Lots
| lot | status | branch | commits | before→after | coverage | verify |
|---|---|---|---|---|---|---|
| L186 seo | dispatched | cloud/w2-cms-L186 | | | | |
| L193 widgets/resolvers | MERGED | cloud/w2-cms-L193 | 311d8137, 5df22a79 | contact-form cyc14/cog16→7/3; gallery cyc10/cog15→6/7 | 100/100/100 both (was 95/78, 100/79) | eslint 0, tsc 0, widgets+nav 16 files 193/193 |
| L200 core/commands | MERGED | cloud/w2-cms-L200 | 768f99e9 | executeCommand cyc18/cog16→5/3 (file worst 6/3) | 83/67/100→100/100/100 | eslint 0, tsc 0, 8 command-related files 103/103 |
| L227 navigation | MERGED | cloud/w2-cms-L227 | 7003a710 | validateTarget cyc14/cog12, updateMenuTree cyc11 → all ≤10 | 95/90/100→100/100/100 | eslint 0, tsc 0 (see L193 row) |
| L258 listing | MERGED | cloud/w2-cms-L258 | 4d7243a3, 683b7935 | batch cyc8/cog11→7/6; paths cyc13/cog7→10/4 | 100/100/100 both | eslint 0, tsc 0, listing tests 36/36 |
| L285 comments | dispatched | cloud/w2-cms-L285 | | | | |

## Problems / notes
- L258 bugs pinned (reported, not fixed): readListingBatch NaN `after` → next NaN; parseListingBatchPath accepts zero-padded cursor `/_more/1/012` → 12 (two URLs, one batch). Test count 12→32 (listing.test.ts unchanged). Unused-by-callers options (limitKey/fallback/isVisible) kept: public exports.

- L200: test moved core/__tests__/command-post-mutation-rollback.test.ts → core/commands/__tests__/; +16 boundary tests (9→25). Duplicate DuplicateCommandError construction unified. Kept (public sig): empty ExecuteCommandOptional, unused DuplicateCommandError optionalArgs. No bugs.

- L193: tests 10→34. Commit messages carry wrong before/after numbers (contact-form says 6/4; gallery says 6->6, real 10→6) — not amended (no force-push). Quirk pinned: empty-string formDefinitionId still sent to findById before slug fallback. Kept: `_optional = {}` typed `{}` on createContactFormResolver (public sig).
- L227: enqueueEvent (6 copies), findMenuOrThrow (3), assertMenuLive (2), assertSlugAvailable (2) extracted; 3 needless casts dropped. Tests 85→107. BUG pinned (reported, not fixed): non-string item id (e.g. 5) → validateAndCloneTree throws raw TypeError from .trim() → host 500 instead of 400.

## Next
