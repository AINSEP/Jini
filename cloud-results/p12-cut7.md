DONE 0bdd4ae0f5 2ea2053e

# P12 cut #7: retire the HTML escape and slug duplicates

This was an unattended Opus build run on 2026-11-23, from 19:46 to about 20:10 UTC. Codex has not reviewed it yet, and it must not be merged until Codex does.

- **Spec:** Tovu `origin/plan/whats-left-1122:plans/P12-cut-plan-v2.md`, section #7.
- **Fixes:** F7.1–F7.3 from `origin/codex/approve-p12-1123:reviews/approve-P12-cutplan2.md`.
- **Role bootstrap:** I read `AI-Dev-Shop/agents/programmer/skills.md` (v1.7.5, 2026-11-05) before starting any work.
- **Subagents:** none. All changes were mechanical one-line import repoints, so I did them myself.
- **Prohibited actions:** none taken. No codebase-memory tools, no force-push, no `--no-verify`, no publish or tag. I did not touch `main`, `integ/*`, `plan/*` or `release/*`.

## Branches and SHAs

| Repo | Branch | Base | Work tip (excluding this report) |
|---|---|---|---|
| Tovu | `codex/p12-cut7-tovu` | `origin/integ/merge-13-2026-11-22` `f7185f153a` | `0bdd4ae0f5` |
| Jini | `codex/p12-cut7-jini` | `origin/integ/merge-14-2026-11-22` `4902a6a1` | `2ea2053e` (foundation merge only; cut #7 has no Jini code change) |

### Foundation merges (applied first)

| Head | Tip | Result |
|---|---|---|
| Tovu `origin/codex/ex2-tovu-halves` | `d6590fc72` | merged clean: `19ebc16d8` |
| Tovu `origin/codex/ex5-fnd-kit-tovu` | `541537de6` | merged clean: `76732d714` |
| Jini `origin/codex/ex5-fnd-kit-jini` | `c03c3cd1` | merged clean: `2ea2053e` (pairs with kit-tovu) |
| Tovu `origin/codex/ex2-holds-tovu` | `8eb8ea568` | **SKIPPED, non-trivial.** Content conflicts with kit in `apps/admin/src/lib/admin-http/settings-api.ts`, `features/pages/__tests__/use-pages.unit.test.ts`, `features/posts/__tests__/use-posts.unit.test.ts` and `development/why-comments-debt.json`. This is the Kit-vs-Holds overlap that the plan says needs a reconcile. |
| Tovu `origin/codex/ex5-fnd-seams-tovu` | `63b09af26` | **SKIPPED, non-trivial.** Conflicts in 9 `apps/website/src/contracts/core/tool-metadata/*.ts` files and the why-comments debt file. |
| Tovu `origin/codex/ex5-fnd-inject-tovu` | `6f571e3d0` | **SKIPPED, non-trivial.** Conflicts in `i18n-common.ts`, `tool-approval-policy.ts` and 20+ `tool-metadata/*.ts` files. It also needs Seams first (rv-f). |

The approval's build order lists cut #7 as depending on "merge-13 / halves only". The skipped heads do not affect it.

## Setup

- Node 24.22.3 (`/opt/node24`) and pnpm 10.33.2 for gates and tests.
- Jini: `pnpm install --frozen-lockfile` returned 0, and `pnpm --no-bail -r build` returned 0 (0 `error TS`).
- Tovu: `npm ci --ignore-scripts` returned 0 in root, admin, desktop and site-chat.
- Link: `JINI_PACKAGES_DIR=/home/user/Jini/packages node development/scripts/link-jini.mjs` linked 82 packages.
- `packages/contracts` tsc returned 0, and the `packages/sdk` build returned 0.
- Both slug files resolve to blob `e92352c21f30818faa767b1f58bce4446087ce07`, as the plan pinned.
- The linked exports match the pinned declarations: Core `text/index.ts:3` exports `escapeHtml` and `escapeXml`, and CMS `./html/site/slug` is a universal entry.
- The importer census matched the plan exactly: 29 production escape importers plus `escape.test.ts`, and 9 slug importers. There was no extra real importer, so none of the STOP conditions fired.

## Step 1: tests first (`07ce2c440c`)

New test file: `apps/website/src/platform/html/__tests__/html-owner-imports.boundary.test.ts`. Its named cases:

- `cut7-no-host-copy`: `platform/html/{escape,slug}.{ts,js}` must not exist.
- `cut7-no-stale-specifier`: no source under `apps/{website,admin,desktop,site-chat}/src` or `packages/` may reach the deleted owners. The test covers all four specifier forms: `#src/…`, relative paths with and without `.js`, and Admin's cross-app path. Inside `platform/html` it also covers the `./`/`../` sibling forms.
- `cut7-scan-sees-all-four-forms`: checks that the matcher itself catches each form, and does not flag `@jini-ai/cms/html/site/slug` or the post-local `./slug.js`.

**RED before the repoint:** 2 failed, 1 passed. `cut7-no-stale-specifier` listed 39 stale files: 29 escape importers, `escape.test.ts`, 9 slug importers counted once each (`doc-nodes.ts` imports both), and the sibling import in `slug.test.ts`.

## Step 2: repoint and delete (`e50e0e6b87`)

- 29 escape importers now use `import { escapeHtml } from "@jini-ai/core/text";`. I swapped only the specifier and kept each file's quote style.
- `escape.test.ts` now uses `import { escapeHtml, escapeXml } from "@jini-ai/core/text";`.
- 9 slug importers now use `import { toSlug } from "@jini-ai/cms/html/site/slug";`:
  - `A/features/menus/hooks/use-menu-editor.hooks.ts:16`. This removes the cross-app relative import.
  - `W/features/{forms/index.ts, pages/tool-registrations.ts, plugin-runtime/built-ins/content-analyzer/analyze-content.ts, post/slug.ts, taxonomy/tool-registrations.ts, widgets/deps.ts}`.
  - `W/server/inbound/public-http/http/site/render/doc/doc-nodes.ts`.
  - `W/platform/html/__tests__/slug.test.ts`, which stays as a parity run against the linked package.
  - The synthetic fixture at `W/assistant/__tests__/domain-no-direct-tool-registration.boundary.test.ts:260`. It now reads `import { toSlug } from "@jini-ai/cms/html/site/slug";`, and the fixture still covers the pure-platform-helper case through `#src/platform/markdown/frontmatter`.
- **F7.1:** the six `W/features/theme/` importers got the import-line change only. No theme file moved, and no theme code entered Jini.
- **F7.2:** `W/platform/html/escape.ts` and `W/platform/html/slug.ts` are deleted with no forwarding shim. A search of all four specifier forms (the boundary test above) finds 0 matches.
- **F7.3:** `development/scripts/__tests__/dev-lite.test.mjs` is unchanged. Its `platform/html/slug.ts` string is a temp-file fixture under a fresh root.
- BLOCK list respected: `post-tool-schemas.ts`, `tiptap-{block,text,doc}-schema.ts`, `source-edits.ts`, `menu-render.ts` (except its escape import line), `safe-url.ts` and `published-webmcp-strip.ts` are untouched.
- No new types, ports, host bindings, package entries or dependencies. Admin already declares `@jini-ai/cms` and `@jini-ai/core`, and the root `package.json` declares `@jini-ai/cms`.
- **GREEN:** the boundary test passes 3/3.

## Step 3: Wiring docs (`d416ba7b62`)

- New `W/platform/html/INFO.md` with a `## Wiring` section: Core owns escaping, CMS owns slugs, and the folder must not hold a forwarding file.
- `## Wiring` added to `W/features/post/INFO.md` (Posts slug binding), `W/features/forms/INFO.md` and `A/features/menus/README.md` (Menus browser binding through the universal entry).
- The other touched folders (theme, comments, site-backup, site-export, pages, taxonomy, widgets, content-analyzer, and the server render/routes folders) have no INFO.md or README. Their only change is one import line, so I did not create new docs there.

## Step 4: why-comments ledger (`0bdd4ae0f5`)

- `check:why-comments --base 76732d7149` reported one lost block: `178e43d79674`, the one-line doc of the deleted `escape.ts` forwarder.
- That comment described a file that no longer exists. Its reasoning (a leaf module with no imports cannot close a renderer import cycle) is preserved in Jini `packages/core/src/text/escape.ts`'s `@file` doc. I recorded it in `development/why-comments-debt.json` with that reason.
- After that, why-comments returns ok (1 allow-listed).
- The slug doc survives byte-for-byte in Jini, because the blob is identical.

## Named mutations

I planted each mutation in both the linked Jini `dist/` file that Tovu imports and the Jini `src/` file that vitest reads. Both were restored with `git checkout` plus a dist backup copy. The Jini tree was clean afterwards.

| Mutation | Plant | RED | Restored GREEN |
|---|---|---|---|
| `html-apostrophe-to-apos` | `HTML_ENTITIES["'"]`: `&#39;` → `&apos;` | Jini `escape.hwa.test.ts`: 1/1 failed. Tovu `escape.test.ts`: 1 failed, 4 passed. The failing case was "escapeHtml: escapes all five special characters, apostrophe as numeric &#39;". | Jini 1/1 passed. Tovu 5/5 passed. |
| `slug-decamelize-on` | `{ decamelize: false }` → `true` | Jini `slug.test.ts`: 2 failed, 2 passed (ASCII corpus and 10,000 seeded random strings). Tovu `platform/html` plus `features/post` slug tests: 2 failed (ASCII corpus and seeded random strings), 5 passed. | Jini 4/4 passed. Tovu all passed. |

Under `slug-decamelize-on`, the Admin vitest run filtered to `MenuEditor` and `menu-authoring-ux` stayed green: 4 files, 57 tests. No menus test uses camelCase input, so the parity corpus above is what catches this mutation.

## Verification (restored tree)

- `pnpm --filter @jini-ai/core test escape.hwa.test.ts`: 1/1 passed.
- `pnpm --filter @jini-ai/cms test src/html/site/__tests__/slug.test.ts`: 4/4 passed.
- `npm --prefix apps/admin run typecheck`: 0.
- Admin vitest (`--maxWorkers=2`), changed file and importers:
  - `src/features/menus`: 16 files, 226/226 passed.
  - `fqfix-editor-reopen`, `admin-route-lazy-loading` and `panels-render`: 3 files, 155 passed, 2 skipped.
- The plan's node test set (escape, slug, the boundary test, post slug, the domain boundary test, and render golden): 35 tests, 33 passed, 2 failed. Both failures are pre-existing:
  - `render.golden.characterization`: 9 hashes drift (`widget:contact-form-{default,range,html,collection}`, `shell:assistant-on`, `site:{static,fallback}-home-assistant`, `inject-assistant:{on,commented-tags}`). The base `76732d7149` drifts on the same 9. The post-title-with-marks and post-content cases are not among them, so they match.
  - `domain-no-direct-tool-registration`: `features/external-mcp/external-mcp-probe.ts` value-imports `../../assistant/index.js`. That file is not part of this cut, and the test fails the same way at base.
- **Website tests covering changed files and their importers:** 143 files, each run alone under a 15-minute watchdog, 3 in parallel.
  - 133 green and 10 red. All 10 fail with an identical failing-test set (hash match) when re-run in a clean worktree at base `76732d7149`. **No new red.**
  - The 10 base-red files: `domain-no-direct-tool-registration.boundary`, `theme/preview-switcher-layout` (7), `widgets/resolve-html-page-embeds.integration` (1), `server/routes/forms-submit` (1), `site-chat-stream.golden` (1), `admin-http/routes/forms/l244-characterization` (4), `site/render-form-layout` (3), `site/render.golden.characterization` (1), `site/tiptap-render-contract` (1) and `commerce/settlement.integration` (1).

## Gates (base-diff against `76732d7149`)

### Tovu

| Gate | HEAD | Base | Verdict |
|---|---|---|---|
| `typecheck` (+e2e) | 0 | — | green |
| `typecheck:tests` | 0 | — | green |
| `typecheck:scripts` | 2 | 2 | same 3 `error TS` lines; none in cut files |
| `check:size` | 1 | 1 | identical violation set (`dev-auth.ts`, `assistant-byok.ts`, PageEditor and related files) |
| `check:complexity` | 1 | 1 | identical (`App.tsx` AdminShell, 12) |
| `check:hooks` | 0 | — | green |
| `check:boundaries` | 0 | — | green |
| `check:architecture` | 1 | 1 | same runtime-only propagation trade. The cut improves the module API surface from 687 to 685 and deep-import edges from 2,813 to 2,778. |
| `check:why-comments --base 76732d7149` | ok | — | 1 lost block, allow-listed (Step 4) |

### Jini

Cut #7 changes no Jini source. Jini HEAD code is the foundation merge base, so these results equal the base by construction.

| Gate | Result |
|---|---|
| build | 0 |
| `typecheck` | 0 |
| `guard` | 0 |
| `api:check` | 0 |
| `check:hooks` | 0 |
| `check:why-comments` | Fails with the default base: `origin/refactor/terra` is not in the Jini clone. With `WHY_COMMENTS_BASE_REF=origin/integ/merge-14-2026-11-22` it is ok (0 lost). |
| `check:size` | 1, all in files outside this cut: `cms/redirects/redirects.ts`, `daemon/agent-executor/launch.ts`, and stale `sidecar/json-ipc.ts` entries |
| `check:complexity` | 1: `ui/panel-kit/ErrorNotice.tsx` (11), outside this cut |
| XP (`check:cross-package`) | **NOT-RUN at the pinned base.** The clone is shallow and `35c4961af` cannot be fetched. Run against merge-14 it reports XP4 runtime statements in `core/src/contracts/vault/__tests__/invariants.test.ts`, which came with the foundation merge and is not part of cut #7. |

I did not run size and complexity separately at merge-14 to work out whether the kit-jini merge or merge-14 introduced those reds.

## Files removed from Tovu

- `apps/website/src/platform/html/escape.ts`
- `apps/website/src/platform/html/slug.ts`

## Skipped and open

- The Holds, Seams and Inject foundation merges were skipped because of non-trivial conflicts (table above).
- Jini XP at its pinned base: not run (shallow clone).
- The pre-existing reds above belong to the base and were left untouched.
