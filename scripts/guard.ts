/**
 * Jini repo guard — aggregates the boundary + neutrality checks.
 * Run via `pnpm guard`. See ADS-memory/reports/jini-port/extraction-plan.md §7 (guardrails) and §12 C-series.
 *
 * STATUS (2026-07-19 hardening pass): `checkEngineBoundaries` and `checkProtocolPurity` are
 * real (R1/R2/R3/R5/R6/R7/R8 — see their own module docs), replacing the literal `return []`
 * stubs the 2026-07-19 swarm-consensus debate found (guard printed "ok" unconditionally for
 * weeks; see ADS-memory/reports/swarm-consensus/runs/2026-07-19T1632-consensus-report.md).
 * Two rules from the original TODO list are still genuinely unimplemented, not silently
 * dropped — see the bottom of this file.
 *
 * `checkAgenticDomPurity` (R9, added 2026-07-26 alongside the `@jini-ai/agentic` extraction) is a
 * third, narrower check: it protects the `packages/agentic` DOM-free/DOM-split *configuration*
 * (tsconfig.json vs. tsconfig.dom.json), not an import-graph or string-content rule like the
 * other two — see its own module doc for why source-scanning would be the wrong tool here.
 *
 * `checkChatPanePublicSurface` (R10, added 2026-08-05 for REF-001 Step D) is a fourth check —
 * ENFORCING as of 2026-08-05, having shipped disabled/reporting-only for one review cycle first
 * (see its own module doc). Landed disabled while `features/chat-pane/**` was still mid-restructure
 * by a concurrent agent and REF-001 §1 (does `ChatPane` stay in the generic barrel at all) was still
 * open; both settled the same day. Its first real run found 3 genuine findings across 8 call sites
 * — one (`createFakeChatTransport`) was a scope bug in the check itself (flagging a test file
 * reaching for a documented test-only double; fixed by excluding `__tests__/**` from the scan) and
 * two (`definedProps`, `useLatestOperation`) were real gaps, resolved by exporting both from
 * `index.ts` rather than narrowing scope — see ADS-memory/reports/refactor/2026-08-05-ref-001-steps-bcd-proposal.md
 * §9 for the reasoning on each.
 *
 * `checkExtensionlessImports` (R11, added 2026-08-05) is a fifth check, shipped ENFORCING
 * immediately, not disabled-first like R10 — R10's disabled period existed because a concurrent
 * agent was mid-restructuring the exact tree it checks; no such concurrent-edit risk applies here.
 * Found by REF-001 Step C's hardened tarball-execution check (import the real packed tarball, not
 * just `require.resolve` it): `@jini-ai/ui`'s `Toast.js` reached `./Icon` with no extension, which
 * resolves under a bundler (Vite, Vitest) but throws `ERR_MODULE_NOT_FOUND` under plain Node ESM.
 * Investigating found it wasn't `ui`-specific — `tsconfig.base.json`'s repo-wide
 * `moduleResolution: "Bundler"` lets every package's typechecker accept this. Fixed the 21 real
 * sites found (10 in `ui`, 11 in `renderers-react`) in the same change that adds this check. See
 * `check-extensionless-imports.ts`'s own module doc for two false-positive classes this check
 * deliberately does NOT flag (import-shaped text inside a string literal; a package's own
 * tsconfig-excluded, separately-built vendored subtree) and why both are correct to exclude.
 *
 * Fail-closed guarantee: before trusting any check against the real repo, `runGuardSelfTest`
 * runs all five against known-bad fixtures and refuses to report "ok" on the real repo unless the
 * checks demonstrably still catch what they're supposed to. This is what makes "silently
 * regress to a no-op again" a self-test failure instead of a silent false "ok."
 */
import { checkAgenticDomPurity } from './check-agentic-dom-purity.js';
import { checkChatPanePublicSurface } from './check-chatpane-public-surface.js';
import { checkEngineBoundaries } from './check-engine-boundaries.js';
import { checkExtensionlessImports } from './check-extensionless-imports.js';
import { checkProtocolPurity } from './check-protocol-purity.js';
import { runGuardSelfTest } from './lib/self-test.js';

async function main() {
  const selfTestFailures = await runGuardSelfTest();
  if (selfTestFailures.length) {
    console.error('[guard] SELF-TEST FAILED — refusing to trust the checks against the real repo.');
    for (const f of selfTestFailures) {
      console.error(`[guard] self-test: ${f.expectation}`);
    }
    console.error(
      '\nA guard check no longer detects a known-bad fixture (scripts/lib/self-test.ts). This is' +
        ' exactly the failure mode that let guard.ts print "ok" unconditionally for weeks — see' +
        ' the self-test file before touching check-engine-boundaries.ts / check-protocol-purity.ts' +
        ' / check-agentic-dom-purity.ts.',
    );
    process.exit(1);
  }

  const results = [
    await checkEngineBoundaries(),
    await checkProtocolPurity(),
    await checkAgenticDomPurity(),
    await checkChatPanePublicSurface(),
    await checkExtensionlessImports(),
    // TODO: vocabulary-firewall check (foundry/automation/** must not import engine domain types) —
    // genuinely unimplemented, not covered by either check above (both are scoped to packages/).
    // TODO: residual-JS allowlist — genuinely unimplemented; scope not yet specified precisely
    // enough to build without guessing.
  ];
  const violations = results.flat();

  if (violations.length) {
    for (const v of violations) console.error(`[guard] ${v.rule} ${v.file}: ${v.reason}`);
    console.error(`\n${violations.length} guard violation(s).`);
    process.exit(1);
  }
  console.log(
    '[guard] ok — self-test passed (checks proven against known-bad fixtures) and zero violations' +
      ' found in packages/. Vocabulary-firewall and residual-JS-allowlist checks are still TODO.',
  );
}
main();
