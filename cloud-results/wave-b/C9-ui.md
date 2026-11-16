# C9-ui — DONE (hand edits only; TSV not run)
Branch wave-b/C9-ui from refactor/terra (Jini b7666092, Tovu b28d38c6). Code commit 0d71bdca.
Steps: new ui/src/react/kit.tsx (UiKit slots SecretInput + useOverlayContainer/useSecretReveal, UiKitProvider first-kit-wins, useUiKit throws plain error, facades); new __tests__/{fake-ui-kit,kit.unit.test}.tsx (4 tests: missing provider throws, hook routing, first kit kept, ref forwarded); git rm SecretInput.hooks.ts; package.json `./react-kit` export + jini.entries (browser); README section; .changeset/ui-react-kit.md (minor). ui-kit dep NOT dropped (importers repointed by the applier; R5 drops it).
Not done / left for applier+coordinator: 9 TSV rows (ui index.ts:154 DROP + coordinator line `export { UiKitProvider, type UiKit } from ./react/kit.js`), Tovu bindings + mounts (not touched; Tovu untouched, no Tovu branch).
Debt retired: injection-debt `packages/ui/src/react/components/SecretInput.hooks.ts @jini-ai/ui-kit/react (export-from)` (guard reports it stale).
Checks: kit tests 4/4 pass; eslint clean on 3 files; complexity + size ratchets pass; Tovu-text rg clean.
 NEEDS-APPLIER-PASS: tsc SecretInput.tsx(7) and SourceConfigField.tsx(5) cannot find SecretInput.hooks.js (TSV rows 7,9); guard SI-resolution same two files.
 PRE-EXISTING: tsc panel-kit/hooks/__tests__ errors (3 test files, missing sibling hooks); guard ~150 violations (N1/N2 Tovu refs in ui execution/tabbed-dialog, HW3, R13 fable model) none in my files.
 ENV: guard needed @jini-ai/plugins built; vitest `--maxWorkers=2` conflicts with config (run without it).
Sheet notes: sheet's `useOverlayContainer(required?: Record<string,never>…)` kept to match ui-kit's signature; useSecretReveal return typed readonly (matches ui-kit `as const`). C9a kit not present at this HEAD (not needed).
Context ~60k tokens, ~25 min.
