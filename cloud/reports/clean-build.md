# Clean build — in progress

Branch: `cloud/clean-build` in Jini. Base: `origin/cloud/combine` at `b0cc1371b5e739f9cd1b26f14aa5a21a82416b60`.

Fresh reproductions are running under `/workspace/work/clean-build/{Jini,Tovu}`.
Toolchain: Node 24.22.1, pnpm 10.33.2. Caches are isolated under the scratch directory; no existing dist output or installed links copied.

Jini install reports a cycle among agent-plugins, commerce, ui and integrations.
The commerce dev dependency on agent-plugins has no imports. The integrations dev dependency exists for a lifecycle-only test.

Commands underway:
- Jini: `pnpm install --frozen-lockfile && pnpm -r --workspace-concurrency=1 run build`.
- Tovu: `npm ci`.

Initial sandbox cache write restrictions were resolved with scratch-local package caches. Network fetches currently have intermittent HTTP 502 responses; final build results pending.

Open: reproduce compiler failures, apply minimal fixes, verify fresh serial and default builds, run affected checks, record timings and pushed SHAs.
