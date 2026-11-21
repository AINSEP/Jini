**Jini `release/lockfile-1120` @ (pending) · Tovu `release/lockfile-1120` @ (pending)**

# lockfile-1120 (2026-11-21) — IN PROGRESS

Unattended cloud run from 00:57 UTC. Node v24.22.3 (`/opt/node24`), pnpm 10.33.2 (corepack). No subagents, no codebase-memory tools, no force-push, no `--no-verify`. Only `release/lockfile-1120` pushed.

## Step 1 — base gates (Jini `origin/integ/merge-7-2026-11-20` @ `06559aff`): DONE
- `pnpm install --frozen-lockfile`: exit 0.
- `pnpm build`: there is no root `build` script (exit 254 "did you mean guard"); used `pnpm --no-bail -r build` as combine-7 did: exit 0, 0 `error TS`.
- `pnpm guard`: exit 0, zero violations.

## Step 2 — packed-entry proof: DONE
`pnpm pack` of core, admin, devops, http-kit, protocol (dependency of the closure), cms → `npm install` of the six tarballs into an empty temp consumer (34 packages, exit 0) → `import()` of every target subpath (`lockfile-1120-packed-entry-probe.{mjs,txt}`). All resolve from the tarball:
cms `./presentation/html`, `./presentation/page-head`, `./forms/result-query`, `./forms/result-flash`, `./themes/preview/refresh`, `./themes/token-aliases`, `./media/cover-image`; http-kit `./range`; devops `./backup/plan-store`, `./backup/push-jobs`; core `./errors/{idioms,sentences,bindings,catalog,reporter,approved-cause,disclosure,error-id,testing}` and `./model-facing-tool-errors`.
- **`@jini-ai/cms/seo/cover-image` does not exist** (ERR_PACKAGE_PATH_NOT_EXPORTED): the cover-image entry ships as `./media/cover-image`. The scope name was wrong, not the package.
- admin has none of the listed subpaths; its four non-JS entries (`themes/default/*.css`, `manifest.json`, `contracts/*` wildcard) cannot be `import()`ed by bare Node but resolve to files in the tarball; every other admin entry imports.
- npm today: `latest` 0.7.2, `next` 0.6.15-rc.2; **no published version ships `./errors/idioms`, cms `./presentation/html`, http-kit `./range` or devops `./backup/push-jobs`** (checked 0.7.1 and 0.7.2 with `npm view … exports`).
