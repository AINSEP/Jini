# Cloud coordinator T1 — progress

Branch: `cloud/coord-T1` (from `origin/general-work`). Started 2026-10-19 21:42 UTC.

## Environment
- Linux vm, /home/user/Jini. Subagent spawning works (subagent hostname `vm`, same container).
- Setup: install 20s, `pnpm --no-bail -r build` 114s (only @jini-ai/integrations fails, expected).
- Worktrees: `../wt-<LOT>` on `cloud/coord-T1-<LOT>`; `pnpm install --frozen-lockfile --offline` 4s each;
  `pnpm --filter <pkg>^... build` in a worktree FAILS (undeclared deps, e.g. ui -> agentic), so dist/ was
  copied (`cp -a packages/*/dist`) from the main checkout instead (no rsync in image).
- Vitest 2.1.9: `--maxWorkers=2` alone errors (minThreads/maxThreads conflict) — use `--maxWorkers=2 --minWorkers=1`,
  run from inside `packages/<pkg>`.
- Complexity measure: temp flat config (tseslint parser + sonarjs, complexity 10, cognitive 10, noInlineConfig).

## Baseline (worst cyc / cog per file, production files only)
- L024 agent-plugins/lifecycle: automatic-use 37/29, manifest 25/20, retire-bundled 14/17, installed-package-roots 13/16,
  installed-package-index 15/11, skill-file-reader 13/15, also uninstall 16/14, fetch-archive 13, search 11, resolve-agent-plugin-refs 11
- L027 ui/connectors: ConnectorDetailDrawer 43/41, ConnectorCard 39/31, ConnectorsBrowser 24/21, rules 14/17, ConnectorGrid 11
- L028 chat/core/util: parser 28/45, manifest 29/21, markdown-context 18/25, strip 15/12, pointer 11, validate cog 11
- L029 mcp/core: config 24/37, tokens 35/34
- L030 admin/core: create-admin 42/55, entities/rules 18/19, transport/http 13
- L032 platform/web: web-page 39/22, html-to-markdown 21/15, (html-document 16/18 — out of named scope)

## Lots
| lot | status | branch commits | verify |
|---|---|---|---|
| L030 admin/core | MERGED 22:01 | f5d43c16, ac89eab7, fb4a8732 | eslint 0; tsc 0; 20 files/266 tests (was 191); 100/100/100 on all 3; comments moved not deleted; create-admin 42/55→8/8, entities/rules 18/19→10/10, http 13→9/4. Note: 2 commit messages state pre-measurement numbers |
