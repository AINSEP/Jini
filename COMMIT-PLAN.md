# Jini SOL commit plan

Base: `codex/b-archj`, `010c8cd874f709ffa2c61de0de4e1dde4f808aad`.
Changes are uncommitted; `.git` was not modified. Only Jini was edited.

## Completed implementation slices, in design order

1. **R06.J — Private artifact matcher args conversion**
   - `packages/agent-runtime/src/__tests__/json-event-stream.test.ts`
   - `packages/agent-runtime/src/defs/gemini/event-stream.ts`
   - Added the chunk-boundary characterization before changing the private signature and sole caller. It checks emitted text before and after completing a partial opening tag, with distinct surrounding and suppressed text. The internal call omits the empty optional object.
   - **M-swap-required-fields:** temporarily change the caller to `artifactOpenCandidateLength({ text: openTag, openTag: current })`. The new intermediate text assertion must fail.

2. **G12 — Web-clone templates**
   - `packages/agent-runtime/src/skills/web-clone/scripts/__tests__/template-byte-parity.test.mjs`
   - `packages/agent-runtime/src/skills/web-clone/scripts/__tests__/fixtures/template-skeleton.json`
   - `packages/agent-runtime/src/skills/web-clone/scripts/__tests__/fixtures/template-notes.md`
   - `packages/agent-runtime/src/skills/web-clone/scripts/dna-scaffold.mjs`
   - `packages/agent-runtime/src/skills/web-clone/scripts/init-clone.mjs`
   - Captured both fixtures by calling the original exports before extraction; wrote the two byte-comparison tests before production edits. Extracted exactly the four DNA and ten notes helpers named in the sheet. The existing DNA writer retains serialization and its newline.
   - **M-drop-template-final-newline:** temporarily remove the last newline from `notesVerificationSection`'s returned template. The complete notes byte comparison must fail.

3. **G20 — Search candidate and RPC error complexity**
   - `packages/agent-runtime/src/agent-protocol/acp/__tests__/session.handlers.unit.test.ts`
   - `packages/agent-runtime/src/agent-protocol/acp/session-results.ts`
   - `packages/agent-plugins/src/lifecycle/host-tools/__tests__/search-tool.authorization.test.ts`
   - `packages/agent-plugins/src/lifecycle/host-tools/search-tool.ts`
   - Added three RPC precedence/refusal tests and one sparse/populated metadata test before extraction. Retained the existing unexpected-ID cleanup and generic-failure pins. Extracted exactly the three predicates and `optionalPluginFields`. Display fields remain after `pluginId`; optional dependency keys remain after `provides`.
   - **M-rpc-cleanup-falls-through:** temporarily remove the `isUnexpectedInternalError` return branch. The retained `ignores an unexpected-id -32603 error as cleanup noise` test must fail when the reply reaches `failWithRpcError`.

## Stopped sheets

- **G13:** anchor mismatch at `packages/cms/src/content-duplication/agent-tools.ts:36`. `buildContentDuplicationAgentToolCatalog` returns only `content_duplicate`; there are no replace/import operations to move into `buildReplaceTools` or `buildImportTools`. At `media/tool-registrations.ts:273`, the upload handler delegates caps to `uploadMedia`; it has no existing kind-based cap guard to move verbatim into `assertWithinCap({ kind, bytes })`. No G13 edits or pins were made.
- **K03a:** required OPUS K01 has not landed. `AgentRuntimePort` and `runtime-port-bindings.ts` lack the bound receipt, MCP delivery, and staged launch strategy slots. `tool-call-receipts.ts:1–9` still directly imports both adapters and selects by `kind`. No K03a moves or pins were made.

## Verification handoff

Seven tests added; no existing tests removed or weakened. No tests, mutations, builds, installs, type-checks, linters, or gates ran, as dispatched. Fixture capture alone executed the original G12 exports. Opus must run all four affected test files, type-check R06.J/G20, and verify/revert each named mutation. Runtime evidence and coverage remain unmeasured.

Static diff review: boundaries, signatures, effect order, property order, template boundaries, existing comments, and the allowed helper names were inspected. Function assessment is INCONCLUSIVE pending execution: R06 retains its bounded prefix loop; G12 helpers assemble fixed templates; G20 predicates/projection perform constant work. No new external I/O, dependencies, exports, options, or public contracts were introduced. No out-of-scope cleanup deletions were needed.

## Left untouched

All 43 OPUS sheets: A01–A06, A08, A10–A12, A14; R01–R03, R05, R07, R09; K01–K06; G01–G11, G14–G19, G21–G23. All Tovu sheets remain outside this dispatch.

Tovu handoff: no new subpaths, exports, or caller changes are required by the three implemented sheets.
