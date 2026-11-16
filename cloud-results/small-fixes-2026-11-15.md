# Small fixes 2026-11-15

Setup: Node 24.22.3, pnpm 10.33.2. Baseline (unmodified tree): `pnpm -r build` fails in desktop-host, ui, daemon, user-management (pre-existing; agent-runtime/platform build fine). `src/defs/__tests__/amr.test.ts` has 2 pre-existing failures.

## 1. Claude mcpIsolation — DONE (10605caf, Jini)
- RED: `cd packages/agent-runtime && npx vitest run --maxWorkers=2 --minWorkers=1 src/__tests__/plan-run.unit.test.ts` -> 1 failed (mcpIsolation undefined).
- Fix: `mcpIsolation: { perRun: 'claude-strict-mcp-config@2026-11-16' }` in defs/claude.ts. NOTE: the stamp is a claim from the documented `--strict-mcp-config` behaviour, not a live CLI check; replace with a verified CLI version when one is run.
- GREEN: same command -> 8/8 passed; defs/__tests__ 628 passed, 2 failed (the pre-existing amr ones, identical on stashed tree). tsc --noEmit clean.
- Changeset: .changeset/agent-runtime-claude-mcp-isolation.md

## 2. preferWorkspacePackages — DONE (eff5c025, Jini)
- Added `preferWorkspacePackages: true` to pnpm-workspace.yaml. `pnpm install --frozen-lockfile` succeeds with no flag, no lockfile churn (git status clean apart from yaml).
- No RED: frozen install already passed without the setting on this tree (linkWorkspacePackages: true); the change only makes non-frozen resolution prefer workspace packages.
- Changeset: .changeset/workspace-prefer-workspace-packages.md (attached to @jini-ai/protocol; adjust if you prefer another/none).

## 3. nodemailer — DONE (Tovu, 51133f44)
- Declared only in Tovu root package.json (used by apps/website/src/platform/mail/adapters/smtp.nodemailer.ts, lazily loaded; not in Jini). 7.0.13 -> 10.6.0 (latest, published 2026-11-15); package-lock.json updated.
- Breaking changes read: 8.0.0 error code NoAuth->ENOAUTH (unused here; adapter relies on EAUTH/EENVELOPE/EMESSAGE, unchanged); 9.0.0 TLS validated by default for remote fetches (attachments are inline base64, no URL fetch -> n/a); 10.0.0 Node>=20 (repo on 24), TS rewrite with CJS build (createRequire load still works). No code change needed.
- Verified: smtp.nodemailer unit tests 19/19 pass; jsonTransport smoke send OK; root tsc 146 errors before AND after (pre-existing, registry-Jini mismatch, none nodemailer).
- Left: @types/nodemailer ^7.0.12 kept (nodemailer now ships its own types); consider removing.
