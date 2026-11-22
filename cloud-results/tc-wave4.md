# tc-wave4 report (2026-11-18), Jini side

Branch `wave3/tc-wave4` from `origin/refactor/terra` (`4c1892368`), plus `--no-ff` merges of wave2/tc-a, tc-b, tc-c, tc-d (`7fa4bc26`, `e1368576`, `38b372d1`, `9cd51150`; one conflict in `mcp/src/server/tool-server.ts` imports, resolved by keeping both). Tovu side and the overall result: `Tovu/cloud-results/tc-wave4.md`.

## S12b: done

`obtainFrom` on a required input property: a call missing it is told which tool lists valid values, on both paths, from one pure function.

Commits: `a3f87af7` characterization (daemon + mcp) · `9177c36b` change (core `missingArgumentGuidance`, `assertRepairKeywords` refuses a bad `obtainFrom`; mcp `argumentShapeMessage`; daemon `withValidationGuidance`; changeset; CAPABILITIES.md and core README).
Files: `core/src/tool-input-repairs.ts` (+`missingArgumentGuidance`, 190 lines), `mcp/src/server/tool-arguments.ts`, `mcp/src/server/tool-protocol.ts` (one argument), `daemon/src/http/validation-guidance.ts` (new, 38 lines), `daemon/src/http/delegated-tools.ts` (net +2 lines), tests `core/src/__tests__/tool-input-repairs.obtain-from.test.ts`, `mcp/src/server/__tests__/tool-arguments-obtain-from.test.ts`, `daemon/src/http/__tests__/delegated-tools.obtain-from.integration.test.ts`.

Sentences (new):
- typed: `invalid arguments for <tool>: supply required argument \`themeId\`; list valid values with theme_list; Input schema: {…}`
- gateway (both): handler text + ` List valid values for \`themeId\` with theme_list.`
No clause when the property is present, declares no `obtainFrom`, the failure is about another field (the handler's text must name the property), the named tool is not visible (typed: published names plus `ctx.diagnosticToolIds`; gateway: the route's registry; a route without `toolRegistry` is unchanged), or the property is nested (typed path only handles top-level).
Characterization changed in the same commit: the gateway characterization now uses a schema without `obtainFrom` (with one the text is the new text).

Gates: `pnpm guard` ok · `pnpm typecheck` rc 0 · tests after the change: core **3026** (14 new) · mcp **1841** (6 new) · daemon **4782** + 1 skipped (10 new). Not baselined on the merged tree before editing (only guard + typecheck were); the counts before are these minus the new files. Re-run on the final tree (after the complexity 11 → 10 fix in `delegated-tools.ts handle`): guard rc 0, typecheck 0 errors, core 3026, mcp 1841, daemon 4782 + 1 skipped, all pass.
§4: 4.3 to 4.7, 4.15, 4.17 print nothing. 4.8 prints 5 lines, all reworded in the same place because the declaration now also covers `obtainFrom` (`tool-input-repairs.ts` header and `assertRepairKeywords`/`assertObjectSchema`/`assertClampDeclaration` doc lines). 4.9: `await import('@jini-ai/core/tool-input-repairs')` from `packages/mcp` gives `function`; no `node:` import. 4.16: after the fix prints nothing.
Red-first: core 13 of 14 failed (`missingArgumentGuidance is not a function`, the refusal test got no throw); mcp 2 of 6 failed (text without the clause); daemon 2 of 10 (text without the sentence). No Tovu code changed for S12b (Tovu's `theme_list_files` is S13).

`pnpm api:check` was not run (red on the base per `tc-wave2a.md`).

Overlap: files in `packages/core/src/tool-input-repairs.ts`, `packages/mcp/src/server/tool-arguments.ts`, `tool-protocol.ts`, `packages/daemon/src/http/delegated-tools.ts` (also edited by S1/S2a/S3 runs, merged here).
