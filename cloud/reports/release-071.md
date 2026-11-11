# release-071

Branch `cloud/release-071`, from `origin/main` `9d243799` (published 0.7.0 + notes app + PORT-1025 fixes). This job prepared the release commits only: nothing was published, no tag, no push to main, no force-push.

## Result

- Release version: **0.7.1** (patch) for the whole fixed `@jini-ai/*` group: 40 public packages plus the private `plugin-fixture-provider`.
- Every export key published in npm 0.7.0 is still exported. The only additions are core `./contracts/server` and three names in cms `./forms/sql`. Nothing was removed or broken, so there was no reason to stop.
- All gates pass: install, build, `guard:plugins`, `guard:plugins:packed`, `check:cross-package` (XP1–XP5 clean), plugin-catalog tests (66/66), provider-plugins distribution-manifest test (2/2), publish plan (40 of 40 pending), and a pack of all 40 with publish-pending's own tarball checks.

## Commits (Jini `cloud/release-071`)

| Commit | What |
| --- | --- |
| `8f0a2f65` chore(release): prepare 0.7.1 | consumes both changesets; versions, CHANGELOGs, provider-plugins export paths and README release lines |
| `6c034918` chore(release): seal 0.7.1 catalog metadata | plugin-catalog `catalog.json` regenerated, provider-plugins `catalog.json` moved to 0.7.1, lockfile |
| (this report) | report + `raw/release-071/` |

## Method (same as the 0.7.0 prep: `de6f83653`, `62c30e2b5`; Tovu `cloud/reports/release-prep.md`)

1. `pnpm changeset version` consumes the pending changesets. There were 2. `.changeset/` now holds only `README.md` and `config.json`.
2. provider-plugins: the 7 versioned export paths in `package.json` (`./plugins/<id>/0.7.1/jini.plugin.json`) and the "npm release is **x**" line in three provider READMEs (posthog, opentelemetry, sentry) move to 0.7.1, as de6f83653 did.
3. `pnpm install` and a rebuild, then seal. `pnpm --filter @jini-ai/plugin-catalog run generate` rewrites `packages/plugin-catalog/catalog.json`. The diff changes only `version`/`pluginVersion` fields and the digests of version-bearing license/README files. `packages/provider-plugins/catalog.json` has no generator, so its 10 `{version, path}` pairs were moved to 0.7.1 by hand, as 62c30e2b5 did. The lockfile follows the `^0.7.1` ranges changesets wrote and is part of the seal commit.

## Bump decisions

- **Both pending changesets were `minor` and are relabelled `patch`**, per the owner's 0.7.1 instruction. Both are additive:
  - `core-contracts-server`: new types-only subpath `@jini-ai/core/contracts/server` (`Server`, `ServerHandler`, `ServerMethod`, `ServerRoute`), not in the root barrel. The changeset also mentions a route-precedence fix inside that new contract. Before this release npm had no such subpath, so no published consumer depends on the old behaviour.
  - `cms-create-forms-tables`: `createFormsTables`, `FormsTablesKernel` and `FormsTablesDialect` are added to the existing `@jini-ai/cms/forms/sql`.
- **`changeset version` computed 0.7.1 directly.** It did not compute a minor or major, so no version, range or CHANGELOG heading had to be relabelled (unlike 0.7.0, where it computed 1.0.0). Peer ranges stay `^0.7.0` (`onlyUpdatePeerDependentsWhenOutOfRange`). 0.7.1 satisfies them, and the publish plan's `assertCompatiblePeerRanges` passes. Changesets moved five `@jini-ai/core`/`platform` *dependency* ranges to `^0.7.1`.
- **No other changesets exist.** The hardening fixes and DeepSeek auth fix the brief mentions have no changeset of their own. They still ship in 0.7.1 because the fixed group bumps every member. Their CHANGELOGs only list "Updated dependencies", so the coordinator may want to add a line for them before publishing. Nothing in the prep needed it.
- The only intra-repo consumer of either new API would need `^0.7.1`. None exists: no package outside core imports `@jini-ai/core/contracts/server`, and none outside cms uses `createFormsTables`.

## Export comparison vs npm 0.7.0

Two levels (`exports-diff.txt`, `exports-symbols-diff.txt`):

1. **Export keys**, all 40 public packages: `npm view <pkg>@0.7.0 exports` compared with the local `package.json`. **No key removed.** One added: core `./contracts/server` (24 → 25).
2. **Exported names**, for the 12 packages whose `src` changed since the 0.7.0 prep (`agent-runtime analytics cli cms core daemon integrations mcp oauth platform search sidecar`). Each npm 0.7.0 tarball was extracted. For every export key, the TypeScript checker's `getExportsOfModule` on the npm `.d.ts` entry was compared with the same call on the local build. **No name removed in any package.** Real additions: core `./contracts/server` (4 types) and cms `./forms/sql` (3 names). The tool also reported many "added" names under cms `./settings`, `./settings/express` and platform `./mail`. Those are artifacts: every `.d.ts` under those npm directories (2 + 27 files) is byte-identical to the local build. They re-export `@jini-ai/core/*`, which resolves through the workspace locally but not inside the isolated npm extract.

Verdict: **additions only**, so a patch is appropriate.

## Package versions

old = `origin/main` before this job; npm = `npm view <pkg> version` on 2026-11-11 (`versions.txt`).

| Package | old | npm | new |
| --- | --- | --- | --- |
| `@jini-ai/admin` | 0.7.0 | 0.7.0 | 0.7.1 |
| `@jini-ai/agent-plugins` | 0.7.0 | 0.7.0 | 0.7.1 |
| `@jini-ai/agent-runtime` | 0.7.0 | 0.7.0 | 0.7.1 |
| `@jini-ai/agentic` | 0.7.0 | 0.7.0 | 0.7.1 |
| `@jini-ai/analytics` | 0.7.0 | 0.7.0 | 0.7.1 |
| `@jini-ai/artifacts` | 0.7.0 | 0.7.0 | 0.7.1 |
| `@jini-ai/capability-providers` | 0.7.0 | 0.7.0 | 0.7.1 |
| `@jini-ai/chat` | 0.7.0 | 0.7.0 | 0.7.1 |
| `@jini-ai/cli` | 0.7.0 | 0.7.0 | 0.7.1 |
| `@jini-ai/cms` | 0.7.0 | 0.7.0 | 0.7.1 |
| `@jini-ai/commerce` | 0.7.0 | 0.7.0 | 0.7.1 |
| `@jini-ai/cookie-consent` | 0.7.0 | 0.7.0 | 0.7.1 |
| `@jini-ai/core` | 0.7.0 | 0.7.0 | 0.7.1 |
| `@jini-ai/daemon` | 0.7.0 | 0.7.0 | 0.7.1 |
| `@jini-ai/db` | 0.7.0 | 0.7.0 | 0.7.1 |
| `@jini-ai/desktop-host` | 0.7.0 | 0.7.0 | 0.7.1 |
| `@jini-ai/devops` | 0.7.0 | 0.7.0 | 0.7.1 |
| `@jini-ai/diagnostics` | 0.7.0 | 0.7.0 | 0.7.1 |
| `@jini-ai/http-kit` | 0.7.0 | 0.7.0 | 0.7.1 |
| `@jini-ai/infra` | 0.7.0 | 0.7.0 | 0.7.1 |
| `@jini-ai/integrations` | 0.7.0 | 0.7.0 | 0.7.1 |
| `@jini-ai/mcp` | 0.7.0 | 0.7.0 | 0.7.1 |
| `@jini-ai/memory` | 0.7.0 | 0.7.0 | 0.7.1 |
| `@jini-ai/oauth` | 0.7.0 | 0.7.0 | 0.7.1 |
| `@jini-ai/platform` | 0.7.0 | 0.7.0 | 0.7.1 |
| `@jini-ai/plugin-catalog` | 0.7.0 | 0.7.0 | 0.7.1 |
| `@jini-ai/plugins` | 0.7.0 | 0.7.0 | 0.7.1 |
| `@jini-ai/protocol` | 0.7.0 | 0.7.0 | 0.7.1 |
| `@jini-ai/provider-plugins` | 0.7.0 | 0.7.0 | 0.7.1 |
| `@jini-ai/registry` | 0.7.0 | 0.7.0 | 0.7.1 |
| `@jini-ai/sandbox` | 0.7.0 | 0.7.0 | 0.7.1 |
| `@jini-ai/search` | 0.7.0 | 0.7.0 | 0.7.1 |
| `@jini-ai/server` | 0.7.0 | 0.7.0 | 0.7.1 |
| `@jini-ai/sidecar` | 0.7.0 | 0.7.0 | 0.7.1 |
| `@jini-ai/sqlite` | 0.7.0 | 0.7.0 | 0.7.1 |
| `@jini-ai/ui-kit` | 0.7.0 | 0.7.0 | 0.7.1 |
| `@jini-ai/ui` | 0.7.0 | 0.7.0 | 0.7.1 |
| `@jini-ai/user-management` | 0.7.0 | 0.7.0 | 0.7.1 |
| `@jini-ai/vibecoding` | 0.7.0 | 0.7.0 | 0.7.1 |
| `@jini-ai/cms-forms` | 0.7.0 | 0.7.0 | 0.7.1 |

Private (not published), bumped by changesets:

| Package | old | npm | new |
| --- | --- | --- | --- |
| `@jini-ai/plugin-fixture-provider` | 0.7.0 | not published (private) | 0.7.1 |
| `@jini-example/cookie-consent-standalone` | 0.0.2 | not published (private) | 0.0.3 |
| `@jini-example/minimal-host` | 0.0.7 | not published (private) | 0.0.8 |
| `@jini-example/neutral-host` | 0.0.0 | not published (private) | 0.0.0 |
| `@jini-app/nlweb-demo` | 0.0.0 | not published (private) | 0.0.0 |
| `@jini-example/notes-app` | 0.0.0 | not published (private) | 0.0.1 |
| `@jini-app/reference-desktop` | 0.0.7 | not published (private) | 0.0.8 |
| `@jini-app/reference-web` | 0.0.7 | not published (private) | 0.0.8 |

## Publish plan (`pnpm exec tsx scripts/publish-pending.ts --plan`, exit 0)

The plan runs `assertCompatiblePeerRanges` over the whole public set (it passed) and lists the publish order, dependency-first:

```
pending          @jini-ai/protocol@0.7.1
pending          @jini-ai/core@0.7.1
pending          @jini-ai/agentic@0.7.1
pending          @jini-ai/ui-kit@0.7.1
pending          @jini-ai/platform@0.7.1
pending          @jini-ai/ui@0.7.1
pending          @jini-ai/db@0.7.1
pending          @jini-ai/commerce@0.7.1
pending          @jini-ai/agent-plugins@0.7.1
pending          @jini-ai/http-kit@0.7.1
pending          @jini-ai/cms@0.7.1
pending          @jini-ai/admin@0.7.1
pending          @jini-ai/oauth@0.7.1
pending          @jini-ai/integrations@0.7.1
pending          @jini-ai/agent-runtime@0.7.1
pending          @jini-ai/analytics@0.7.1
pending          @jini-ai/artifacts@0.7.1
pending          @jini-ai/capability-providers@0.7.1
pending          @jini-ai/diagnostics@0.7.1
pending          @jini-ai/chat@0.7.1
pending          @jini-ai/sidecar@0.7.1
pending          @jini-ai/cli@0.7.1
pending          @jini-ai/cookie-consent@0.7.1
pending          @jini-ai/daemon@0.7.1
pending          @jini-ai/desktop-host@0.7.1
pending          @jini-ai/devops@0.7.1
pending          @jini-ai/infra@0.7.1
pending          @jini-ai/mcp@0.7.1
pending          @jini-ai/memory@0.7.1
pending          @jini-ai/plugin-catalog@0.7.1
pending          @jini-ai/plugins@0.7.1
pending          @jini-ai/provider-plugins@0.7.1
pending          @jini-ai/registry@0.7.1
pending          @jini-ai/sandbox@0.7.1
pending          @jini-ai/search@0.7.1
pending          @jini-ai/server@0.7.1
pending          @jini-ai/sqlite@0.7.1
pending          @jini-ai/user-management@0.7.1
pending          @jini-ai/vibecoding@0.7.1
pending          @jini-ai/cms-forms@0.7.1
40 of 40 package(s) to publish.
```

## Pack checks (`pack-checks.txt`, exit 0)

`--plan` does not pack. As in the 0.7.0 prep, a scratch driver (not committed) called the script's own exported `preparePluginRelease` for all 40 packages in plan order. That is exactly what a real run does before upload: `pnpm pack` per package (prepack included), then `packAndCheck` on each tarball, then `checkPluginReleaseConsistency` of the packed catalog against the packed provider-plugins and agent-plugins archives. `packAndCheck` checks for no `workspace:` range, that `assertPackedExports` resolves every packed export, no `.map`, and no compiled tests. Nothing was uploaded. The driver ran `assertCompatiblePeerRanges` first (compatible). Catalog consistency against the packed archives passed. After packing, `git status` was clean, so prepack's rebuild and regeneration reproduce the sealed catalogs byte for byte. The tarballs were deleted afterwards.

| Package | files | workspace: | .map | tests | packed exports |
| --- | --- | --- | --- | --- | --- |
| `@jini-ai/protocol@0.7.1` | 28 | none | 0 | 0 | resolve |
| `@jini-ai/core@0.7.1` | 270 | none | 0 | 0 | resolve |
| `@jini-ai/agentic@0.7.1` | 110 | none | 0 | 0 | resolve |
| `@jini-ai/ui-kit@0.7.1` | 69 | none | 0 | 0 | resolve |
| `@jini-ai/platform@0.7.1` | 232 | none | 0 | 0 | resolve |
| `@jini-ai/ui@0.7.1` | 1486 | none | 0 | 0 | resolve |
| `@jini-ai/db@0.7.1` | 219 | none | 0 | 0 | resolve |
| `@jini-ai/commerce@0.7.1` | 181 | none | 0 | 0 | resolve |
| `@jini-ai/agent-plugins@0.7.1` | 590 | none | 0 | 0 | resolve |
| `@jini-ai/http-kit@0.7.1` | 56 | none | 0 | 0 | resolve |
| `@jini-ai/cms@0.7.1` | 576 | none | 0 | 0 | resolve |
| `@jini-ai/admin@0.7.1` | 763 | none | 0 | 0 | resolve |
| `@jini-ai/oauth@0.7.1` | 74 | none | 0 | 0 | resolve |
| `@jini-ai/integrations@0.7.1` | 236 | none | 0 | 0 | resolve |
| `@jini-ai/agent-runtime@0.7.1` | 288 | none | 0 | 0 | resolve |
| `@jini-ai/analytics@0.7.1` | 28 | none | 0 | 0 | resolve |
| `@jini-ai/artifacts@0.7.1` | 24 | none | 0 | 0 | resolve |
| `@jini-ai/capability-providers@0.7.1` | 60 | none | 0 | 0 | resolve |
| `@jini-ai/diagnostics@0.7.1` | 94 | none | 0 | 0 | resolve |
| `@jini-ai/chat@0.7.1` | 445 | none | 0 | 0 | resolve |
| `@jini-ai/sidecar@0.7.1` | 30 | none | 0 | 0 | resolve |
| `@jini-ai/cli@0.7.1` | 36 | none | 0 | 0 | resolve |
| `@jini-ai/cookie-consent@0.7.1` | 56 | none | 0 | 0 | resolve |
| `@jini-ai/daemon@0.7.1` | 284 | none | 0 | 0 | resolve |
| `@jini-ai/desktop-host@0.7.1` | 139 | none | 0 | 0 | resolve |
| `@jini-ai/devops@0.7.1` | 184 | none | 0 | 0 | resolve |
| `@jini-ai/infra@0.7.1` | 30 | none | 0 | 0 | resolve |
| `@jini-ai/mcp@0.7.1` | 170 | none | 0 | 0 | resolve |
| `@jini-ai/memory@0.7.1` | 22 | none | 0 | 0 | resolve |
| `@jini-ai/plugin-catalog@0.7.1` | 5 | none | 0 | 0 | resolve |
| `@jini-ai/plugins@0.7.1` | 134 | none | 0 | 0 | resolve |
| `@jini-ai/provider-plugins@0.7.1` | 245 | none | 0 | 0 | resolve |
| `@jini-ai/registry@0.7.1` | 38 | none | 0 | 0 | resolve |
| `@jini-ai/sandbox@0.7.1` | 53 | none | 0 | 0 | resolve |
| `@jini-ai/search@0.7.1` | 35 | none | 0 | 0 | resolve |
| `@jini-ai/server@0.7.1` | 34 | none | 0 | 0 | resolve |
| `@jini-ai/sqlite@0.7.1` | 6 | none | 0 | 0 | resolve |
| `@jini-ai/user-management@0.7.1` | 228 | none | 0 | 0 | resolve |
| `@jini-ai/vibecoding@0.7.1` | 58 | none | 0 | 0 | resolve |
| `@jini-ai/cms-forms@0.7.1` | 24 | none | 0 | 0 | resolve |

File counts match 0.7.0's prep exactly, except core (268 → 270, the new `contracts/server` `.js`/`.d.ts`) and cms (574 → 576, the new forms-tables module).

## Gates

| Gate | Result | Raw |
| --- | --- | --- |
| `pnpm install` | exit 0 (baseline, and after version) | `install-pre.txt`, `install-post.txt` |
| `pnpm changeset version` | exit 0 | `changeset-version.txt` |
| `pnpm --no-bail -r build` | exit 0 at 0.7.1 | `build-post.txt` |
| plugin-catalog `generate` + `test` | exit 0, 66/66 | `catalog-generate.txt`, `plugin-catalog-test.txt` |
| provider-plugins `distribution-manifest.test.ts` | 2/2 | `provider-distribution-manifest-test.txt` |
| `pnpm guard:plugins` | exit 0 | `guard-plugins.txt` |
| `pnpm guard:plugins:packed` | exit 0 | `guard-plugins-packed.txt` |
| `pnpm check:cross-package` | exit 0, "XP1–XP5 clean" | `check-cross-package.txt` |
| `publish-pending.ts --plan` | exit 0, 40 of 40 pending | `publish-plan.txt` |
| pack + tarball checks | exit 0, 40 packed | `pack-checks.txt` |

XP baseline, as in Tovu `cloud/reports/fix-1110.md`: a separate `git worktree` at `35c4961af718f0f30591c46d2ea2756c4484a731`, frozen install (0), core build (0), recursive build (0), `--write-baseline /home/user/xp3-baseline` → **3308 source mappings**, the same count as FIX-1110 and the 0.7.0 prep (`xp3-snapshot.txt`). The gate ran with `JINI_DECLARATION_BASELINE_DIR` pointing at that snapshot. The worktree was removed afterwards.

The full `pnpm guard` and the per-package test suites were not run; the brief did not list them. The base build on the unmodified tree was not run separately either. The post-version build is the only build, and it exited 0.

## Left for the coordinator

- Publish Jini 0.7.1 from `cloud/release-071` (40 packages, order above).
- Optionally add changesets/notes for the PORT-1025 hardening and DeepSeek auth fixes, which ship without CHANGELOG entries of their own.
- Then move consumers (Tovu) to `^0.7.1` where they want the new APIs. `^0.7.0` ranges already pick 0.7.1 up.

No process is left running. No ref other than `cloud/release-071` was touched.

RELEASE-PREP-071 DONE
