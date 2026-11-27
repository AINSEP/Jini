# BUGD rules — Jini handoff

Base: `codex/bugd-rulesj`, `a6a2c60c3b2890a8893aeaae8a5b0d7677ea4a1d`.
Working-tree changes only; this plan must not be committed.

## Design commit order

1. Sheet 1 — no-op in Jini. Required media hook, required-prop test,
   root export, and `.changeset/rules-media-providers-hook-required.md`
   already exist. Host slot adapter and regression test belong to the host.
2. Sheet 2 — implemented, awaiting coordinator verification: require the hook
   on the bound Access Tokens tab.
   - Test first: `packages/admin/src/security/host/__tests__/AccessTokensTab.unit.test.tsx`;
     add “requires the other-credentials hook on the bound tab” using the
     exact `expectTypeOf` contract from the sheet.
   - Mutation: `other-credentials-hook-optional` restores the optional bound
     prop and its factory-binding default (and the original complete factory
     hooks input). The required-prop type equality must then fail typechecking.
   - Fix: `packages/admin/src/security/host/AccessTokensTab.tsx`;
     omit only this hook from factory input, require it on the bound tab,
     and retain its injection into the leaf's complete hooks object.
   - Changeset: `.changeset/rules-access-tokens-hook-required.md`.
3. Sheet 4a — no Jini work by design; composition split and size test are
   host-owned. Sheets 3 and 4b belong to another job.

## Constraints and verification

- Follow the approved sheet's existing strict leaf and hook injection pattern.
- Keep other overrides, leaf contracts, effects, and existing assertions unchanged.
- No new exports, subpaths, helpers, dependencies, version bumps, or release steps.
- Do not run tests, installs, builds, typechecks, or linters; coordinator verifies.
- Regression test is written before production changes; RED/GREEN and mutation
  execution are not verified here because verification runs are prohibited.
- Final diff reviewed: only the sheet's factory-input omission, required prop,
  removed default, specified type test/imports, and changeset were added/changed.
- Logical test cases: 2 before, 3 after; existing assertions unchanged.
- Deletions: only the specified hook default and optional prop marker;
  no unrelated code or tests removed.
- Architecture audit (source review): PASS against the sheet's boundaries;
  leaf contracts, other overrides, and complete leaf-hook injection unchanged.
- Function review: factory and bound component remain within 50 lines, with no
  added branches or effects; source file is 154 physical lines. The required
  hook's type contract is covered by the new direct type assertion.
- Documentation: breaking host-contract change recorded in the changeset;
  no source comments added, per dispatch.

## Host handoff

Sheet 1 needs the stable media slot adapter and its named credential-input test.
Sheet 2 needs removal of the factory-bound hook, explicit injection by Security,
and the named fixture/comment updates. No new subpath or export is required.
No manifest, lockfile, or package version updates are required.
