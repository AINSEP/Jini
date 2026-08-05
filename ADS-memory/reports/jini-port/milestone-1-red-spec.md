# Milestone 1 red-spec — scope note for `m1-impl`

Written by the `m1-red-spec` WorkItem attempt. Pins gate N and gate O from
extraction-plan.md §8 task 1 as two failing vitest suites, before any of the
harness implementation exists. `m1-impl` should make both suites go green —
do not edit the assertions themselves; if a contract detail below turns out
to be wrong, fix it deliberately and note why.

## Gate N — health-boot from packed tarballs

Spec: `examples/minimal-host/src/health-boot.test.ts`

Target: `scripts/health-boot.ts`, runnable as `tsx scripts/health-boot.ts` from
the repo root, must:
1. Pack every `@jini/*` dependency of `examples/minimal-host` into `.tgz`
   tarballs (e.g. via `pnpm pack`).
2. Install those tarballs — never a `workspace:*` link — into a scratch copy
   of `examples/minimal-host`.
3. Boot/run the example's entry point from that scratch copy (the entry
   point itself doesn't exist yet either — add a minimal one that imports
   only `@jini/*` and exits 0, per the neutrality rule in `examples/minimal-host/README.md`).
4. Print exactly one JSON line to stdout:
   `{ "ok": true, "marker": "HEALTH_BOOT_OK", "packedTarballs": string[] }`,
   with `packedTarballs` non-empty and every entry ending in `.tgz`.

## Gate O — sync-ownership manifest + patch canary

Spec: `foundry/integrations/open-design/sync-ownership.test.ts`
Fixture: `foundry/integrations/open-design/reference/fixtures/upstream-daemon-sample.patch`
(synthetic — see the fixtures README for why; swap for a real upstream
`git format-patch` when this session has real access to the OD repo).

Target:
1. `foundry/integrations/open-design/sync-ownership.manifest.json` — `{ "entries": {
   "<upstream-path>": "product-owned" | "delegated-to-jini" } }`, at minimum
   classifying `apps/daemon/src/routes/health.ts`.
2. `scripts/patch-canary.ts` exporting `transformUpstreamPath(path: string): string`
   (rewrites `apps/daemon/...` -> `foundry/integrations/open-design/daemon/...`), and
   runnable as `tsx scripts/patch-canary.ts --patch <file> --repo <dir>`,
   printing `PATCH_CANARY_OK` to stdout after a clean `git apply` of the
   transformed patch against `--repo`.

## Everything else this attempt touched

- Added a bare `"test": "vitest run"` script to both `examples/minimal-host/package.json`
  and `foundry/integrations/open-design/package.json` (matching the convention already
  used by `packages/core`, `packages/platform`, `packages/sidecar`, etc.) so
  the two suites above are runnable via `pnpm --filter <pkg> run test`.
- Did not touch `scripts/health-boot.ts` or `scripts/patch-canary.ts`
  themselves, the manifest, or minimal-host's entry point — that's `m1-impl`'s
  job.
