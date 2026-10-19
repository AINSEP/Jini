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
| L027 ui/connectors | MERGED 22:10 | 80e1858f, 0476f17b, 280c7793, fa72549f, 8b0f17cc | eslint 0; tsc 0; 15 files/306 tests; 100% all touched; markup proven identical (old-vs-new render, temp deleted); Drawer 43/41→8/5, Card 39/31→8/5, Browser 24/21→8/6, rules 14/17→4/4, Grid 11→8 |
| L024 agent-plugins/lifecycle | MERGED 22:12 (9/10 files) | d3edcdbd 25a572d3 4a3166ea d3ec5fcc 2e701c3f df42f7ea 03670552 3ef3fb76 f392949f | eslint 0 on 9 files; tsc 0; 42 files/495 pass (2 pre-existing skips); 100% all 9; tests 184→281. REAL BUG pinned: non-object plugin.json `extensions` reported twice (2nd from core validatePluginIdentity). uninstall.ts (16/14, 79.75% line cov) → follow-up lot L024b |
| L028 chat/core/util | MERGED 22:14 | 4495c763 2d1007d4 ab45120f b8025b38 022508d5 7a52dd48 51f3a0a0 c774573f | eslint 0; tsc 0; core tests 34 files/447 pass; 100% all 6; tests 109→156; parser 28/45→7/8, manifest 29/21→8/5, markdown-context 18/25→8/9, strip 15/12→9/6, pointer 11→6/3, validate cog 11→8/7. Some commit subjects state pre-measurement numbers |
| L029 mcp/core | MERGED 22:15 | 79b43bb8 0b5f4ebd | config 24/37→10/10, tokens 35/34→9/9; 100% both; tests 55→79; EISDIR bare rejects→code match. Quirk pinned: OpenCode remote entries validate trimmed url but emit untrimmed |
| L024b agent-plugins uninstall.ts | MERGED 22:19 | 55a7cd37 dafedfa7 | 16/14→≤10; 100%; +21 fault-injection tests (rollback paths were only covered by a chmod test that self-skips as root). Whole lifecycle folder now 0 production violations |
| L032 platform/web | MERGED 22:25 | cfa56fa4 2b4b4608 42084a2d 7f6396bb | web-page 39/22→10/10, html-to-markdown 21/15→9/10, html-document 16/18→10/9; 100% all 3; tests 67→171. Bug pinned: empty `<code></code>` → bare "``" |
