# Jini release rerun — cloud/jini-release-2026-10-22 @ ba61df9d
Verdict: READY TO PUBLISH (for the checked scope)
- Node v24.22.0, pnpm 10.33.2; `pnpm install` OK; `pnpm --no-bail -r build` exit 0, no errors in log.
- @jini-ai/agent-runtime: 172 files, 4143 passed, 1 skipped, 0 failed
- @jini-ai/core: 98 files, 1408 passed, 0 failed
- @jini-ai/integrations: 84 files, 1889 passed, 0 failed
- Typecheck (core, integrations, agent-runtime): all clean
- `changeset status --verbose`: ran, no errors/unknown packages reported
- Previous 3 failures: none reproduced.
- Scope note: only the three packages were tested; the changeset status lists many other packages as pending 1.0.0 bumps.
