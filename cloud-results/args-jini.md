# args-jini — API args as (required: object, optional: object = {})

Branch: `fix/args-jini` (Jini), cut from `origin/refactor/terra` @ `4c189236`. Tovu: **untouched** (no branch pushed).

## Method
- Ran Tovu's `development/scripts/args-object-audit.mjs` over `packages/` + `scripts/` of Jini, then kept only functions whose
  signature line lies in a hunk of `git diff -M 02edbb68..origin/refactor/terra` (new or changed).
- Dropped type guards (`x is T`) and 1-param functions from the "fix" set. Rewrote signatures and every call site with a small
  AST-free rewriter (kept outside the repo), then fixed the leftovers by hand; `tsc` + the package's whole vitest run after each batch.
- Shape used: `fn({ a, b }, { optionalX } = {})`. Where a leading context/ports/scope/state param existed (`s`, `ctx`, `run`,
  `ports`, `scope`, `c: typeof ts`) it is folded into the required object, except in `claude-stream-handler`,
  `vault-token-store`, a2ui `interpreter`, `host.ts`, `stdio-hosting`, search `memory-provider`, cookie-consent where it
  stays first as `(ctx, args)` (the `feed(s, { chunk })` precedent; the audit accepts `*Ctx`-typed first params).

## Counts (new/changed-since-02edbb68, audit "violation", excluding type guards)
| | start | now |
|---|---|---|
| >=2 positional params / scalar params | 412 | 109 |
| of which exported | 29 | 13 |
| single scalar param (n==1, left alone) | 268 | ~263 |
Fixed: ~303 functions. Left: ~109 (31 in `scripts/*.mjs`, 3 typed-interface lambdas in `kit.tsx`, ~20 object-literal methods/handlers whose
shape is imposed by an interface (admin adapters, express handlers, clocks), the rest are shapes my rewriter does not handle).
Exported fixed: `useConnectorAuthorization`, `useConnectorSelection`, `useVersionSearch`, all of `claude-stream-frames`,
`json-event-stream-shared` (`dispatchFrame`, `extractErrorMessage`), acp `session-run` (`sendAgent`, `resetStageTimer`, `failRun`).
No exported symbol of Jini is imported by Tovu (grepped every changed export name over Tovu `apps packages development`; only an
unrelated local `failRun` in `apply-report.ts`), so no Tovu change was needed.

## Not done
- `scripts/check-why-comments*.mjs`, `scripts/check-hook-injection*.mjs` (exported `scanSource`, `runCli`, `parseArgs`, ... take `(argv, options = {})`
  or untyped positionals; plain JS, node:test runner) — left.
- `packages/user-management/src/react/kit.tsx` `(r, o) =>` forwarders: typed by `UserManagementKitHooks` (interface override, exempt).
- Still positional/manual: agent-plugins `automatic-use` (4), `resolve-agent-plugin-refs` `buildInjectedSection`, `uninstall` (2),
  public module wrappers (`listInstalledPlugins(workspaceRoot)`, `stageForRemoval(...)`, ...), `note-store` (3 helpers: folding `s` pushes the file over the 500-line ratchet),
  core `settings/express/http.ts`, `contracts/runtime/testing.ts`, integrations `tool-registrations`, devops `electron/typescript.ts`, `model-discovery.failureSnapshot`.
- No new characterization tests were written; every converted function is covered by the package's existing tests (all pass).
- Commits are per package/file group, not strictly one file each; two mid-run commits were not individually size-ratchet clean
  (`note-store`, `write-service`, `emitSafeText`) — fixed in `42d621fd`; the branch tip is clean.

## Gates (exact commands, results)
Base = `origin/refactor/terra` (worktree). Pass = no NEW line beyond base.
- `pnpm install --frozen-lockfile`, `pnpm --no-bail -r build`: clean (no errors).
- `pnpm typecheck` (root): green at tip.
- `pnpm guard`: ok (1 stale hardwiring-debt occurrence message is printed; not caused by this branch's logic changes).
- Package vitest (`npx vitest run --maxWorkers=2 --minWorkers=1`, whole package, per touched package), all green at tip: agent-runtime 4479, ui 8584, agent-plugins 2165,
  devops 1248, core 2975, memory 409, protocol 793, oauth 819, user-management 1246, platform 3117, search 356, mcp 1805, integrations 2053,
  chat 4434, desktop-host 703, agentic 1143, diagnostics 997, vibecoding 363.
  cookie-consent: 1 failure `bundle.smoke.test.ts > dist/client.min.js > is built` — **identical on base** (dist not built in this env).
- `node scripts/check-size.mjs`: passes (base passes). `node scripts/check-complexity.mjs`: passes (base passes).
- `node scripts/check-hook-injection.mjs`: output byte-identical in finding set to base (32 "(new)" lines on both; base-red).
- `node scripts/check-why-comments.mjs`: ok. `node scripts/check-log-safety.mjs`: fails identically on base. `pnpm check:errors`: WARN mode, same 20 entries on base.
- Not run: `node --test` scripts suite, eslint.

## Next step
Convert the plain-JS scripts (needs a JS-aware pass and the node:test suite), then the remaining manual shapes above; then a
second audit run to confirm the new/changed count.
