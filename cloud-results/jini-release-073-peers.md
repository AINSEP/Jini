# jini-release-073-peers — STOPPED (lockfile blocker, no package changes committed)

**Status: STOPPED by the stated rule** ("if `pnpm install --frozen-lockfile` fails after the edit, STOP and report; do not touch the lockfile").
Branch `release/0.7.3-next.0`. Gated SHA to tag is **unchanged: `a2b536efd652c6ced4731b32c60209cd597af860`** (the report commit `a9cef280` and this one only add docs). Nothing published, no tag pushed.

## What I tried
Form chosen (one form, everywhere): `^0.7.0 || >=0.7.3-next.0 <0.8.0` (the publish scripts use no range form of their own; `scripts/lib/peer-range-compatibility.ts` only checks that peer ranges intersect, which this form keeps).
Applied it to every `peerDependencies` entry that pointed at a sibling with `^0.7.0` (23 lines, 13 files):

    admin/package.json:477-480 (ui, agent-plugins, cms, core)
    agent-plugins/package.json:377,378,381 (core, platform, commerce)
    agentic/package.json:93,94 (protocol, core)
    chat/package.json:262,263 (agent-runtime, ui)
    cms/package.json:476,477 (db, http-kit)
    commerce/package.json:129 (db)
    devops/package.json:179 (platform)
    infra/package.json:88 (db)
    integrations/package.json:145 (platform)
    plugins/package.json:95 (platform)
    search/package.json:75 (agent-plugins)
    server/package.json:116 (chat)
    user-management/package.json:115,116,117 (admin, ui, ui-kit)
    (all under packages/<name>/)

## Gate that failed
`pnpm install --frozen-lockfile` (Node 24.22.3, pnpm 10.33.2) -> **fails**:

    specifiers in the lockfile don't match specifiers in package.json:
    - @jini-ai/commerce (lockfile: ^0.7.0, manifest: ^0.7.0 || >=0.7.3-next.0 <0.8.0)

Cause: `autoInstallPeers: true` — pnpm records the optional peer `@jini-ai/commerce` of `packages/agent-plugins` as a `dependencies` specifier (`pnpm-lock.yaml` importer `packages/agent-plugins`, line ~367). Changing that one range needs a lockfile edit.
Diagnostic only: with the other 22 lines edited and the commerce line left at `^0.7.0`, `pnpm install --frozen-lockfile` passes. That would be a partial fix (agent-plugins' optional commerce peer would still reject 0.7.3-next.0), so I did **not** commit it. All edits reverted; tree clean.

## Other finding
`devDependencies` with `^0.7.1` on siblings (agent-plugins core/platform, agent-runtime core, agentic core, oauth core) are recorded in the lockfile too; they are not resolved by consumers, so I left them out of scope.

## Not run (blocked behind the install)
Pack/`npm install` proof of core+ui+admin+agent-plugins, publish.yml pre-publish steps, `preparePluginRelease` — not re-run; they are unchanged from jini-release-073 results.

## Decision needed (owner)
Either (a) allow a lockfile regeneration (`pnpm install --no-frozen-lockfile`, one specifier line for commerce) — minimumReleaseAge trap until 2026-11-19 means it should run after that date or be a pure specifier change; or (b) make `@jini-ai/commerce` resolve as `workspace:^` in agent-plugins' peerDependencies (pack rewrites it to `^0.7.3-next.0`), which also needs a lockfile specifier change; or (c) accept the 22-line partial and leave the commerce peer. The 22-line script is reproducible: replace `"^0.7.0"` with the form above on sibling peerDependencies lines.
