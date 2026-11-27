# Commit plan

1. A2 / y5n-api (Jini): preserve the host layout argument in bundled seed ports.
   - Tests first: `packages/agent-plugins/src/site/__tests__/y5m-install-tool.test.ts` adds the single required host-seed case before production edits; existing test retained (1 -> 2 tests).
   - Mutation `drop-host-seed-input`: reconstruct the seed call's layout with only `root` and `forWorkspace`, dropping `workspacesDir`. The new assertion on the host seed's `input.layout.workspacesDir` must fail.
   - Production: `packages/agent-plugins/src/site/install-tool.ts` retains the host layout type through the seed port and bound execution arguments, without changing runtime statements.
   - Release note: `.changeset/y5m-plugin-upload-abi.md` (agent-plugins minor).
   - No commits or git writes; coordinator commits these working-tree changes.
   - Tests, mutation execution, installs, builds, typechecks and linters prohibited by dispatch; runtime/type validation remains NEEDS-OPUS.
   - Tovu half remains outside this dispatch: use existing `@jini-ai/agent-plugins/site/install-tool` binding; no new subpath or export required.
   - Completed in the working tree: test first, type-only implementation, release note. No sheet stopped or anchor mismatch.
   - Final scope/deletion audit: removed unnecessary generic propagation from the customization callback type, restoring its original declaration. No files or tests deleted; no existing assertions weakened. Only the three named delivery files plus this uncommitted plan changed.
   - Architecture audit (manual): PASS for inspected scope. Host layout stays injected and generic; existing default public dependency shape remains available; no runtime statement, effect order, comment, import, export name, or package boundary changed in production. No new helper, wrapper, interface or runtime adapter.
   - Function assessment: binding and six existing internal functions have type-signature changes only; bodies, lengths, decisions, I/O and complexity are unchanged. No new logic-bearing production function. The new test keeps the typed host seed outside the fixture cast.
   - Documentation: existing why-comments retained verbatim; changeset documents the changed seed argument contract. No source comments added, per dispatch.
   - Fresh evidence: reviewed the complete diff and ran `git diff --check` successfully. Static review confirmed the seed call still forwards the exact layout object, workspace id and source root. This is not execution/typecheck or mutation evidence; all remain NEEDS-OPUS.
