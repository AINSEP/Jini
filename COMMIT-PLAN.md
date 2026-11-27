# Commit plan — r62t-rev-p10c

Base: `codex/b-p10cj`, `010c8cd874f709ffa2c61de0de4e1dde4f808aad`.
All changes remain in the working tree; the coordinator makes the commit.

## 1. P10-U2.J — completed implementation, validation deferred

Suggested commit: `feat(devops): add read-only site update status and notice`.

Files changed:

- `packages/core/src/contracts/site/devops-deploy.ts` — add `SiteUpdateAvailability` and `SiteUpdateStatusReply`.
- `packages/devops/package.json` — add the two direct entries and their runtime classifications.

Files created:

- `packages/devops/src/deploy/admin-http/__tests__/site-update-status.test.ts`
- `packages/devops/src/deploy/react/__tests__/SiteUpdateNotice.test.tsx`
- `packages/devops/src/deploy/admin-http/site-update-status.ts`
- `packages/devops/src/deploy/react/SiteUpdateNotice.tsx`
- `.changeset/p10-site-update-notice.md` — minor for Core and DevOps.
- `COMMIT-PLAN.md` — this handoff.

Both test files were written before production changes. Five named tests added;
existing tests deleted or weakened: zero. No test, mutation, build, install,
type-check, linter, or runtime verification was run, as explicitly dispatched.
No passing results or coverage figures are claimed.

### Tests and pinned mutations

| Exact test name | Named mutation | Observable assertion |
| --- | --- | --- |
| authorizes system.read before reading site update status | `read-before-authorize` | A pending authorizer leaves the reader untouched; completed effects are authorization then read. |
| refuses to read status when no authorizer is supplied | `skip-authorize-when-absent` | Direct handle invocation rejects with the required refusal text and never calls the reader. |
| forwards the request abort signal to the status reader | `drop-status-signal` | Reader receives the exact request signal. |
| shows the offered version and renders release notes as text through the injected kit | `render-release-notes-as-html` | Injected kit renders info tone, both versions, disclosure label, escaped literal `<strong>` notes, and no strong element markup. |
| renders no update notice when the check is unavailable current or failed | `render-notice-for-every-status` | Null, unavailable, current, and failed states produce empty output without invoking Notice; the hook still runs. |

### Review and remaining verification

Anchors matched; no sheet stopped. Static architecture review: PASS against U2.J.
Reuse: the route uses Core's existing `defineJsonRoute` and `ok`; the notice uses
the required injected hook, structural kit component, and native `details`.
No feed, platform, credential, apply, admin-package, or UI-kit implementation dependency added.

Function review: handler and parser have constant local work and no recorded
findings; the notice scans notes for blankness and renders text proportional to
notes length, with no recorded findings. Name/security skepticism review confirmed
awaited authorization, unchanged signal identity, unconditional hook invocation,
and text-only release content. Runtime behavior remains unverified.

Final diff review found no out-of-scope changes to remove. Deletions: none.
Coordinator: run the affected tests and pinned mutations in cloud. Opus combine
must refresh `api-baseline/jini-ai__core.json` and
`api-baseline/jini-ai__devops.json`, verifying only intended exports/types changed.

## OPUS sheets left

`P10-U2.T`, `P10-U4.J`, `P10-U3.T`, `P10-U4a.T`, `P10-U4b.T` remain untouched.
U1 is already done; P9 lanes are untouched.

## Tovu consumption

After building Jini, consume:

- `@jini-ai/core/contracts/site/devops-deploy` — the two new status types.
- `@jini-ai/devops/deploy/admin-http/site-update-status` — route spec and deps, universal.
- `@jini-ai/devops/deploy/react/site-update-notice` — notice and props, browser.

The Tovu host supplies status reading, authorization/mount guards, kit, hook, and translated copy as specified in U2.T.
