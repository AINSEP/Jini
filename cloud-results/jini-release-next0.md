# jini-release-next0 — 0.7.1-next.0 snapshot

**Status: PARTIAL. Branch is ready and gated; the tag push was refused (HTTP 403), so nothing was published.**

Branch `release/0.7.1-next.0`, base `origin/refactor/terra` `4c1892368`. Tag `release-0.7.1-next.0` exists locally on `826c020e` only.

## To finish (one command, from a machine with tag-push rights)

    git fetch origin release/0.7.1-next.0 && git tag release-0.7.1-next.0 826c020e469e3a9bf44c0350e7cf752b7814d742 && git push origin release-0.7.1-next.0

Tag the gated commit `826c020e`, not the later report commit. The cloud git proxy answered `RPC failed; HTTP 403` on every tag push (3 retries). I did not try another route (e.g. workflow_dispatch) around that refusal.

## Commits pushed

| SHA | What |
| --- | --- |
| `93dc9e74` | fix(release): prerelease versions (any `-`) publish with `--tag next` (`publishArgs` in `scripts/publish-pending.ts`, unit test `scripts/__tests__/publish-pending-args.test.ts`) |
| `00ac1309` | chore(release): 41 public `@jini-ai/*` (40 under `packages/*` plus `cms-forms`) set to `0.7.1-next.0`; private `plugin-fixture-provider` left at 0.7.1; provider-plugins export paths, 3 README release lines, hand-kept `provider-plugins/catalog.json` follow |
| `09abed9c` | chore(release): seal catalog and unblock publish checks (see below) |
| `d270f90b` | fix(release): allow the OTel port library entry in the packed provider-plugins check (+ tests) |
| `826c020e` | chore(release): `pnpm api:update` baselines (separate commit as asked) |

## Extra fixes the publish workflow needed (refactor/terra would have failed without them)

Found by running every `publish.yml` pre-publish step and `preparePluginRelease` for all 41 packages locally, with no upload:
1. `provider-plugins/tsconfig.lib.json` emitted `.map` files; `prepack` rebuilds `dist` after the workflow deletes maps, so publish-pending would refuse the tarball. Maps are now off for that config.
2. `agent-plugins` `netlify` and `vercel` payloads changed on terra (R12d typedef restatement) without an inner version bump; the release consistency check requires one. Both `plugin.json` 0.1.1 -> 0.1.2.
3. `guard:plugins:packed` rejected `dist/observability-opentelemetry/*` (shipped since the `./observability-opentelemetry/port` export). Narrow allowance added.
4. `plugin-catalog/catalog.json` regenerated for 0.7.1-next.0 (66/66 catalog tests).

## Gates (green baseline on unmodified tree, then after changes)

`pnpm -r build` 0, `guard` 0, `typecheck` 0, `check:size` 0, `check:complexity` 0, `api:check` 0 (after update). `check:hooks` exits 1 **identically before and after** (pre-existing violations on refactor/terra; output diff empty) — no new line. Workflow steps `guard:plugins`, the 5 plugin vitest files, `test:plugins:artifacts`, `test:agent-plugins:content`, `guard:plugins:packed` all pass. `publish-pending --plan`: 40 of 41 pending (`node-adapters` never published, skipped by design; `--plan` was run before the final fixes).

## npm state observed (before any publish)

- `@jini-ai/core` dist-tags: `latest` = **0.7.2**, `next` = `0.6.15-rc.2`. The brief assumed `latest` = 0.7.0; it is 0.7.2 (main released 0.7.2 on 2026-11-13). `latest` will not move either way, but `next` would then point at a version semver-older than `latest`.
- 0.7.1 and 0.7.2 are already on npm; `0.7.1-next.0` is unpublished.
- Internal dependency ranges `^0.7.0`/`^0.7.1` (non-workspace) in a few packages do not match `0.7.1-next.0`, so installing `@next` packages may pull stable siblings for those edges. Left as instructed.

## Workflow result / dist-tags

Not run (no tag). `gh` is unauthenticated here (invalid GH_TOKEN). After the tag push, verify with `npm view @jini-ai/core dist-tags --json` (expect `next` = 0.7.1-next.0, `latest` = 0.7.2) for 3 packages.
