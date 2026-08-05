# Publishing `@jini/*` packages

Status: **scaffolding, not live.** The pipeline described here is fully wired up
(Changesets config, `package.json` metadata on every package, the GitHub Actions
workflow) but nothing has been published anywhere yet, and the workflow cannot
publish anything until an `NPM_TOKEN` secret is added to the repo (see
"Going live" below). This doc explains how the pipeline works and what a
contributor or the repo owner needs to do with it.

## The tool: Changesets

We use [Changesets](https://github.com/changesets/changesets), the standard
versioning/publishing tool for pnpm/npm monorepos. Each `@jini/*` package
versions **independently** — there is no `fixed`/`linked` grouping in
`.changeset/config.json` — because the 25 packages under `packages/*` are
genuinely independent components at very different maturity levels (14
locked, 11 incubating per `UNLOCKED.md`), not a single product that should
move in lockstep.

Key config (`.changeset/config.json`):

- `"access": "restricted"` — packages publish as npm **private/restricted**
  packages, not public. This is an early-stage, unreleased engine; nothing
  here should default to public visibility.
- `"baseBranch": "main"` — changesets diff against `main` to figure out
  what changed.
- `"fixed": []`, `"linked": []` — no version-locked groups; every package
  bumps independently based on the changesets that touch it.

## How the pipeline works end to end

1. **A contributor makes a change** to one or more packages and runs
   `pnpm changeset` at the repo root. This launches an interactive prompt:
   pick which package(s) changed, pick a bump type (patch/minor/major) for
   each, and write a short human-readable summary. This writes a new
   `.changeset/<random-name>.md` file — commit it alongside the code change,
   in the same PR.
2. **The PR merges to `main`.** `.github/workflows/publish.yml` runs on
   every push to `main`.
3. **If there are pending changeset files**, the `changesets/action` step
   opens (or updates, if one already exists) a PR titled "Version Packages."
   That PR contains the actual version bumps and `CHANGELOG.md` updates,
   computed from all pending changeset files, with the changeset files
   themselves deleted (consumed).
4. **A human reviews and merges the "Version Packages" PR.** That merge is
   itself a push to `main` — but this time there are no pending changesets
   (they were consumed in step 3), so `changesets/action` takes the *publish*
   path instead: it runs `pnpm changeset publish`, which publishes every
   package whose `version` in `package.json` doesn't yet exist on the
   registry. `workspace:*` internal dependency ranges are automatically
   rewritten to real semver ranges at this point — nobody hand-edits those.
5. **On a successful npm publish**, a second workflow step mirrors the same
   packages to GitHub Packages (`npm.pkg.github.com`) using `pnpm publish`
   again (not `npm publish`, for the same workspace-range-rewriting reason)
   against the packages the action's own `publishedPackages` output says
   were just published.

Nothing in this flow requires a human to run `npm publish` by hand. The only
manual steps are: write the changeset, and merge the two PRs (feature PR,
then the auto-generated Version Packages PR).

## Going live: what only the repo owner can do

This is external setup outside of what any agent or CI job can automate:

1. **Own the `@jini` npm scope.** Create (or use an existing) npm account or
   npm org that has publish rights to the `@jini/*` scope. If nobody has
   claimed `@jini` on npmjs.org yet, this is a one-time claim.
2. **Generate an npm access token** from that account (Automation-type token
   recommended, since it needs to publish from CI without 2FA prompts).
3. **Add it as a GitHub repo secret** named `NPM_TOKEN`: repo Settings ->
   Secrets and variables -> Actions -> New repository secret. That's the only
   secret this pipeline needs beyond the automatically-provided
   `GITHUB_TOKEN` (used both for opening the Version Packages PR and, with
   `packages: write` permission, for the GitHub Packages mirror step).
4. **Run the first changeset + version cycle**: `pnpm changeset` on some real
   change, merge that PR, let the workflow open the "Version Packages" PR,
   merge that. That merge is the first real publish.

Until step 3 is done, pushes to `main` either no-op (no pending changesets)
or open/update the Version Packages PR just fine (that part only needs
`GITHUB_TOKEN`, which GitHub provides automatically) — only the actual `npm
publish` step fails, harmlessly, at the npm-auth step.

## Scope: all 25 packages, not just the locked 14

`packages/*` currently has 25 packages: the 14 locked in
`ADS-memory/reports/jini-port/extraction-plan.md` §3 (`protocol`, `core`, `daemon`,
`agent-runtime`, `sqlite`, `http`, `cli`, `platform`, `sidecar`, `node-host`,
`chat-core`, `chat-react`, `renderers-react`, `ui`) plus the 11 incubating
packages tracked in `UNLOCKED.md` (`artifacts`, `deploy`, `registry`,
`memory`, `media`, `capability-providers`, `desktop-host`, `diagnostics`,
`mcp`, `metatool`, `agui`). All 25 have publish-ready `package.json` metadata
(no `private` field, `version: 0.1.0`, `license: Apache-2.0`, `repository`,
and `publishConfig`) and are in scope for this pipeline.

This was a **deliberate choice**, not an oversight: npm publication and
`UNLOCKED.md`'s admission-manifest status are orthogonal concerns.
`UNLOCKED.md` governs whether a *locked* package may **import** an
*incubating* package inside this monorepo (`lockedPackagesMayImport: false`
until an entry graduates to `"stable"`) — an internal architectural
boundary enforced by `scripts/check-engine-boundaries.ts`. It says nothing
about whether that incubating package is fit to exist as its own installable
artifact on npm. A package can be published on npm while still carrying
`"status": "incubating"` / `"signOff": "PENDING"` in `UNLOCKED.md` — shipping
it doesn't promote it, and promotion doesn't require unpublishing it first.
Consumers who explicitly `pnpm add @jini/metatool` (say) are opting in with
full visibility into its maturity via that package's own `source-map.md`;
the guardrail this pipeline needs to respect is the internal import graph,
not external installability.

## Where things live

- `.changeset/config.json`, `.changeset/README.md` — Changesets config.
- `.github/workflows/publish.yml` — the CI workflow, commented inline with
  the same dormant-until-`NPM_TOKEN` explanation as above.
- Root `package.json` — `"changeset": "changeset"` script (so
  `pnpm changeset ...` works) and `@changesets/cli` devDependency.
- Every `packages/*/package.json` — publish metadata described above.
