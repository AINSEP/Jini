# build-commerce2 — builder brief (coordinator-owned; builders read, never edit)

Repo /home/user/Jini, branch cloud/build-commerce2-2026-10-21 (base 08f5dac9). Package: packages/commerce.
Shell prefix: `export PATH=$HOME/.local/node24/bin:$PATH;` (node 24, pnpm). Deps installed and built.
Read first: `.cloud-coord/build-commerce-REPORT.md` (L0–L3 result; "What L4 must start from", "Known limits").
Personas: read `AI-Dev-Shop/agents/tdd/` and `AI-Dev-Shop/agents/programmer/` persona files (skim, apply). Skip all other bootstrap (this is a `<<SUBAGENT_DISPATCH>>` run: do NOT read CLAUDE.md/AGENTS.md startup, no banners, no sidekick, no indexes).

## House rules (owner, non-negotiable)
- Functions take `(required, optional = {})` objects. Deps injected as ports (now, newId, ledger, providers, ...). No module-level singletons.
- Plugins never import each other; commerce imports no plugin.
- Cyclomatic complexity <= 10 AND sonarjs cognitive <= 10 per function. Check:
  `cd packages/commerce && npx eslint --no-eslintrc --parser @typescript-eslint/parser --plugin sonarjs --rule 'complexity:[error,10]' --rule 'sonarjs/cognitive-complexity:[error,10]' <files>` (if that invocation fails, use the repo eslint config: `npx eslint <files>` from repo root and read complexity lines only).
- 100% line/branch/function/statement coverage for every file you touch or create, with DI fakes. No `istanbul ignore`/`v8 ignore`, no excludes, no threshold changes, no weakened assertions, no deleted behavior to raise coverage. A truly unreachable branch: refactor it away with a comment naming the guarantee.
- Preserve existing "why" comments. Smallest change. TS migrations only via ADR-066 style (see `src/payments/ledger/migrations/`), append a new numbered migration, never edit 0001.
- No new runtime dependency without a one-line reason in your report.
- Kernel tests are vitest files named `*.vitest.test.ts` (run by `vitest.kernel.config.ts`). Run ONLY your files:
  `cd packages/commerce && npx vitest run -c vitest.kernel.config.ts --maxWorkers=2 --minWorkers=1 <paths> --coverage --coverage.include=<your src files>`
  Read the text table only; NEVER cat coverage json. Then `npx tsc -p tsconfig.json --noEmit` (ignore errors clearly in another builder's in-progress files; report them).
- No Postgres server, no Playwright/Chromium. Never commit, never push, never git stash/reset/checkout (other builders share this working tree). The coordinator commits by path.
- Stay inside your OWN files list. Shared files you may append to (one line each, at the end of the relevant block): `src/payments/kernel.ts` (export lines), `package.json` `exports`/`jini.entries` (only if you add an entry). Do not edit another lot's files; if you need a change there, say so in the report.
- If blocked > 10 min on one step: record it and move on.
- Write a running ledger at `.cloud-coord/build-commerce2-<lot>.md` (what's done, what's left) after each major step — if you die, the next builder resumes from it.

## Shared seam already written by the coordinator
`src/payments/provider-registry.ts` (exported from `./payments/kernel`):
- `createKernelProviderRegistry({ items: [{pluginId, module: PaymentProvider}] }, { bindings? })` → `{ get({id}) → {provider, pluginId}|null, list() }`. Throws on invalid id, duplicate id (any plugin), binding mismatch.
- `ProviderContextPort.resolve({ scope, provider }, { signal? })` → `{ok:true, ctx: ProviderContext} | {ok:false, error: PaymentError}` (host-owned: credentials, httpClient, webhook/return URL).
L4 owns this file's tests (and may fix bugs without changing the interface).

## Final report (your last message, <= 40 lines)
Files created/changed/deleted; test count before/after for your files; per-file coverage (4 numbers); complexity result; deviations + why; open questions; anything another lot must know.
- `src/payments/contract/alerts.ts`: `PaymentsAlertPort.raise({alert:{kind,workspaceId,mode,paymentId,detail}})`, `noopAlertPort`. Kinds: over-withdrawn, unknown-aged, inbox-dead-letter, quarantine. L4 owns its tests.
