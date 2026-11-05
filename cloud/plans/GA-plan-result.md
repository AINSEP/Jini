Software Architect(Direct): Loaded and applied the Software Architect, Programmer, and TDD skills you named.

**1. Goal**

Make Jini CI green by removing conflicting enforcement and fixing confirmed regressions, with no new platform features.

**2. Findings**

Both clones are on `merge-1029`; their uncommitted work remains untouched. No files changed and no tests, builds, installs, servers, or Electron ran. Graph MCP tools were unavailable, so discovery used bounded searches and source excerpts. Architecture chapters 13/14 were missing from the clone; I consulted the originals under `/Users/la/Programming/Tovu`.

The named night log is absent. Both requested `gh` commands failed to connect; the connected GitHub reader recovered [run 41988001311](https://github.com/AINSEP/Jini/actions/runs/41988001311). Its logs confirm:

| Errors | Classification |
|---|---|
| 40 missing `react-hooks/exhaustive-deps`; 2 missing `react/no-danger` | Configuration errors. The final ESLint block overrides the existing parser that handles those legacy directives. |
| 4 missing TypeScript rules | Generated provider bundles are being linted as authored source. |
| 29 host-neutrality matches | False positives on ordinary “this site” wording. |
| 8 specification-ID matches | False positives on `sec-gpc`, `Sec-GPC`, and `sec-fetch-site`, caused by case-insensitive `SEC-` matching. |
| 5 product/path matches | Deliberate legacy plugin identifiers; compatibility policy needs alignment, not identifier removal. |

That totals **88 errors**, not 88 production defects. Evidence: [ESLint configuration](/Users/la/Programming/tovu-integration-clones/prov2-jini/eslint.config.mjs:30), [existing parser](/Users/la/Programming/tovu-integration-clones/prov2-jini/development/quality/sonarjs.config.mjs:59), [HTTP headers](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/cms/src/consent/express/index.ts:93), and [legacy format constants](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/plugins/src/host/plugin-format.ts:1).

The existing neutrality guard already permits “this site,” supports reasoned compatibility exceptions, and tests real forbidden tokens. Reusing it is smaller than repairing the duplicate ESLint policy. See [guard policy](/Users/la/Programming/tovu-integration-clones/prov2-jini/scripts/lib/source-neutrality.ts:21) and [its regression fixtures](/Users/la/Programming/tovu-integration-clones/prov2-jini/scripts/lib/publish-hygiene-self-test.ts:27).

Semgrep reports exactly **one missed fixture: line 31**, the rejection callback. The fixture represents a real unsafe error echo; fix the rule. The precise matching failure remains **UNVERIFIED** without running the pinned scanner. See [rule](/Users/la/Programming/tovu-integration-clones/prov2-jini/.semgrep/tests/no-provider-error-echo.yaml:7) and [fixture](/Users/la/Programming/tovu-integration-clones/prov2-jini/.semgrep/tests/no-provider-error-echo.ts:28). Callback source scoping needs validation against [Semgrep’s documented taint behavior](https://docs.semgrep.dev/writing-rules/data-flow/taint-mode/advanced).

**Additional blockers:** the same logs contain 11 guard violations and one Cloudflare content-test failure. Fixing only lint and Semgrep cannot establish green CI. A newer [run 42078411066](https://github.com/AINSEP/Jini/actions/runs/42078411066), matching Jini clone HEAD `651571c5`, had already failed Semgrep; its quality job was still running when checked.

**Release impact:** lint and Semgrep failures currently do **not automatically prevent npm publishing**; publishing has no dependency on CI. The Cloudflare content failure **does** gate publishing because that suite runs there. Recommend holding affected releases until the release commit passes validation. See [publish gates](/Users/la/Programming/tovu-integration-clones/prov2-jini/.github/workflows/publish.yml:59).

**3. Ordered plan**

All estimates below exclude unchanged lines moved during a rename. Tests run later in the Node 24 cloud container; reproduce each failing assertion before fixing it.

1. **Delete duplicate ESLint neutrality enforcement; correct generated-file scope.**
   - In `eslint.config.mjs`, delete the final neutrality block. This also removes its parser override. Ignore only generated `packages/provider-plugins/plugins/**` payloads; keep provider `src/**` checked.
   - Expand `development/quality/eslint-uninstalled-rules.test.mts`: lint an actual failing hook and `render-markdown.tsx`, verify generated payloads are ignored, and retain authored-source coverage.
   - **Size:** approximately **+30–45 / −20–25 lines**.
   - **Proof:** expanded ESLint regression suite, existing neutrality self-tests, then `pnpm complexity`.
   - **Why no smaller:** changing messages would preserve conflicting policies; installing unused React lint plugins would add dependencies. Existing guard enforcement remains active.

2. **Repair stale guard metadata without changing runtime behavior.**
   - Move the two obsolete manifest exceptions in `scripts/source-neutrality-allowlist.json` to their shared `core/identity-namespace.ts` resolver; retain the approved legacy-format exception.
   - Correct both Antigravity paths in `scripts/check-model-fallback-freshness.ts` to `defs/antigravity/index.ts`.
   - Export `SurfaceRecoveryInfo` explicitly from `packages/chat/src/react/index.ts`; the public caller already exposes it.
   - **Size:** approximately **+10–20 / −10–15 lines**, including test adjustments.
   - **Proof:** `check-model-fallback-freshness.test.ts`, `check-subpath-isolation.test.ts`, existing manifest-default-namespace and plugin-format suites, then `pnpm guard:drift`.
   - **Why no smaller:** these are stale locations and a missing public type export. Removing compatibility or expanding the debt baseline would hide the issue.
   - Evidence: [exception locations](/Users/la/Programming/tovu-integration-clones/prov2-jini/scripts/source-neutrality-allowlist.json:7), [stale model path](/Users/la/Programming/tovu-integration-clones/prov2-jini/scripts/check-model-fallback-freshness.ts:129), [exposed type](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/chat/src/react/features/chat-pane/create-mcp-ui-tool-caller.ts:39).

3. **Close the remaining six guard findings through existing seams.**
   - **Environment:** inject the probe environment in `packages/devops/src/local-dev/node-runtime.ts`, defaulting through the existing options convention.
   - **MCP:** rename the SDK HTTP implementation to `http-tool-server.adapter.ts` and update internal references while preserving public exports. Import `CallToolResult` in `tool-result-pages.ts` from the existing `adapters/protocol.ts` re-export.
   - **Forms:** inject the existing media grace interval and hash-lock function into `attachment-cleanup.ts`; wire them in Tovu’s composition `app.ts` and `deps.ts`. Keep the same shared lock instance.
   - **Size:** approximately **+45–70 / −20–35 lines**, plus the implementation rename.
   - **Proof:** add environment-forwarding assertions using a mocked spawn; run `node-runtime.test.ts`, `http-tool-server.wire.test.ts`, and `tool-result-pages.unit.test.ts`. Extend `attachment-cleanup.test.ts` for injected delay and serialization; run Tovu’s `form-file-purge.test.ts` and the guard.
   - **Why no smaller:** these are boundary violations. New exceptions, duplicated locks, or duplicated retention constants would preserve defects.
   - Evidence: [ambient environment](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/devops/src/local-dev/node-runtime.ts:19), [existing protocol adapter](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/mcp/src/server/adapters/protocol.ts:1), [forms coupling](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/cms/src/forms/attachment-cleanup.ts:1), [Tovu wiring](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/runtime/composition/app.ts:1845).

4. **Repair Semgrep’s rejection-callback coverage.**
   - Change callback source matching in `.semgrep/tests/no-provider-error-echo.yaml`, preserving the unsafe fields, sinks, and named sanitizers.
   - Keep the failing fixture; add callback alias/return cases and safe fixed-message/redacted cases. Do not broadly taint every callback value.
   - **Size:** approximately **+30–50 / −5–10 lines**.
   - **Proof:** `pnpm quality:semgrep:test` using CI’s pinned Semgrep **1.175.0**; require all existing rules and new positive/negative fixtures to pass.
   - **Why no smaller:** changing the fixture or disabling the rule would leave an error-echo blind spot. No scanner upgrade or new analyzer is needed.

5. **Resolve the historical Cloudflare failure only if it still reproduces.**
   - Run `packages/agent-plugins/cloudflare/worker/__tests__/forms-receiver.test.mjs` unchanged first.
   - Current source and fixture both hash `[secret, slug, ip]`; whether the historical failure persists is **UNVERIFIED**. Avoid a speculative rewrite.
   - If red, reconcile the key derivation while preserving salting, pruning, and no raw-IP storage; add assertions for those outcomes.
   - **Size:** **0 lines if already fixed**; otherwise approximately **+10–20 / −1–5 lines**, subject to reproduction.
   - **Why no smaller:** this is an existing publisher gate. It must pass, but matching current code does not justify another implementation change.
   - Evidence: [key derivation](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/agent-plugins/cloudflare/worker/forms-receiver.mjs:188), [failed assertion](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/agent-plugins/cloudflare/worker/__tests__/forms-receiver.test.mjs:125).

6. **Prove the final commit with existing gates.**
   - After targeted suites pass, run the existing build, typecheck, guard, content, ESLint, and Semgrep gates once in cloud; inspect actual exit codes and the final workflow result.
   - **Size:** **0 implementation lines**.
   - **Why no smaller:** targeted tests cannot establish that the whole workflow is green. PostgreSQL is available but these targeted checks need no new PostgreSQL setup.

**4. Cost**

- Added production network/DB reads, writes, and polls: **0 × 0 bytes**.
- Forms cleanup keeps its existing job frequency, payload, ownership reads, and deletion writes.
- Added test fixture I/O: per focused run, approximately **10–20 small fixtures × ≤4 KiB** read/write; estimates, not measured.
- ESLint regression adds a few existing source-file reads per test run. Existing repository scans remain unchanged.
- Added scheduled jobs, background polling, and recurring services: **none**.

**5. What this will not do / CUT-CANDIDATES**

No user-facing copy rewrite, eslint-disable comments, broader baselines, schema changes, new error framework, new lock implementation, or repository-wide complexity cleanup. Changed functions stay within complexity 10; desktop code is untouched.

**CUT-CANDIDATES:** automatic release-to-CI coupling, a separate lint job, React lint-plugin installation, scanner upgrades, and the report-only Semgrep reporting crash. Park these outside GA.

**6. Effort and dependencies**

Approximately **5–8 hours of Codex work**, excluding CI queue time. Steps 1, 2, and 4 are independent; step 3 requires coordinated Jini/Tovu wiring. Step 5 may already be complete. Step 6 depends on all reproduced blockers being resolved.

**7. Owner questions**

None required. Recommendation: preserve compatibility, reuse the existing guards, and hold affected releases until the final commit is green.