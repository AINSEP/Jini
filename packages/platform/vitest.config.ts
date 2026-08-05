import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      // The v8 text table silently drops rows once there are many files —
      // json-summary/json are what a coverage-driven pass should actually
      // read (see ADS-memory/reports/jini-port's Phase 6.5 method).
      reporter: ['text', 'json-summary', 'json'],
      // CR-R4: widened to the whole package (matching packages/core and
      // packages/agent-runtime's package-wide convention) — the prior config
      // measured only 4 files, silently excluding command.ts/http.ts/
      // process.ts/proxy-env.ts/toolchain.ts/asset-cache.ts and everything
      // else, which hid this package's real coverage from CI (see
      // ADS-memory/reports/code-review/CR-backend-coverage-push-2026-07-20.md, R4).
      include: ['src/**'],
      exclude: ['src/**/*.test.ts'],
      thresholds: {
        // Measured 2026-07-22 (audit fix, coverage pass): genuine
        // 99.89/99.54/100/99.89 package-wide. The prior 98/91/98/98 baseline
        // predated two things this pass fixed for real: (1) the root-vs-chmod
        // regression noted below is gone — replaced with `vi.mock("node:fs/
        // promises", ...)`-based error injection (see download.test.ts's and
        // index.test.ts's own top-of-file notes) — and (2) asset-cache.ts's
        // and download.ts's own large pre-existing branch gaps (SSRF/DNS-
        // rebinding/streaming edge cases; resume/retry/prune edge cases) are
        // now closed with real tests or real refactors (dead
        // `noUncheckedIndexedAccess`-driven `??`/guard branches removed via
        // non-null assertions or narrowed types, matching this package's own
        // pre-existing "Strictness-only edits" precedent above). Branches
        // sits at 99.54, not 100, because of exactly 3 branches confirmed
        // genuinely unreachable through any real call path this session
        // (verified via fuzzing, not assumed) — see source-map.md's
        // 2026-07-22 entry for each: asset-cache.ts's `isPrivateAddress`
        // `!groups` fallback, download.ts's `acquireLock` loop-tail, and
        // proxy-env.ts's `resolveSystemProxyEnv` outer catch. Raise these
        // numbers if a future change closes one of those — do not lower them.
        statements: 99,
        branches: 99,
        functions: 100,
        lines: 99,
      },
    },
  },
});
