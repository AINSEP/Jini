# jini-release-073 — 0.7.3-next.0 snapshot (replaces release/0.7.1-next.0)

**Status: DONE (nothing published, no tag pushed).** Branch `release/0.7.3-next.0`, created from `origin/release/0.7.1-next.0` (`0801d479`).

## Why
npm already has 0.7.0/0.7.1/0.7.2 and `latest` = 0.7.2, so 0.7.1-next.0 sorts below published versions. 0.7.3-next.0 sorts above `latest`, and `npm view @jini-ai/core versions` does not contain it (checked 2026-11-18). dist-tags observed: `latest` = 0.7.2, `next` = 0.6.15-rc.2; nothing was uploaded, so they are unchanged.

## Commits
| SHA | What |
| --- | --- |
| `a2b536ef` | chore(release): 41 public `@jini-ai/*` (40 under `packages/*` + `cms-forms`) 0.7.1-next.0 -> 0.7.3-next.0; private `plugin-fixture-provider` unchanged; provider-plugins export paths, 3 README release lines, hand-kept `provider-plugins/catalog.json`, and the re-sealed `plugin-catalog/catalog.json` |
| (this report) | docs |

Prior run's fixes are kept (inherited commits `93dc9e74` publishArgs `--tag next` for any prerelease, provider-plugins maps off, netlify/vercel plugin.json bumps, packed-check OTel allowance).
`pnpm api:update` produced **no diff** (baselines do not encode the package version), so there is no separate baseline commit.

## Gated SHA to tag
**`a2b536efd652c6ced4731b32c60209cd597af860`** (all gates below ran on this tree; the report commit after it only adds this file).

    git fetch origin release/0.7.3-next.0 && git tag release-0.7.3-next.0 a2b536efd652c6ced4731b32c60209cd597af860 && git push origin release-0.7.3-next.0

## Gates (Node 24.22.3, pnpm 10.33.2; `pnpm install --frozen-lockfile` clean, lockfile untouched)
- `pnpm --no-bail -r build` -> 0
- `pnpm guard` 0; `pnpm typecheck` 0; `pnpm check:size` 0; `pnpm check:complexity` 0; `pnpm api:check` 0; `pnpm api:update` 0 (no diff)
- `pnpm check:hooks` -> 1: pre-existing violations on the terra base (e.g. `packages/ui/.../AssetGridToolbar.tsx:49`), documented identical in jini-release-next0; this change touches only package.json/catalog/README so it cannot affect it.
- publish.yml pre-publish steps, in order: `find packages/*/dist -name '*.map' -delete`; `pnpm guard:plugins` 0; `pnpm guard:plugins:catalog` 0 (66/66 catalog tests); the 5-file plugin vitest set 0; `pnpm test:plugins:artifacts` 0; `pnpm test:agent-plugins:content` 0; `pnpm guard:plugins:packed` 0; `scripts/__tests__/publish-pending-args.test.ts` 0.
- `tsx scripts/publish-pending.ts --plan`: 40 of 41 pending (`node-adapters` never published, skipped by design).
- `preparePluginRelease` + pack/check of all 40 pending packages (copy of publish-pending with only the `npm publish` call stubbed; temp file deleted, tree clean afterwards) -> exit 0; each would run `npm publish <tgz> --access public --provenance --tag next`. No upload.

## Left
- Tag push (the cloud proxy refused tag pushes last run; not attempted here per instructions).
- Internal non-workspace ranges `^0.7.0`/`^0.7.1` in a few packages do not match 0.7.3-next.0 (left, as in the previous run).
- Doc examples in `scripts/publish-pending.ts` comment and its test still use the string `0.7.1-next.0` as a sample prerelease; harmless.
