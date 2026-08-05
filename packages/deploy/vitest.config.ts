import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      // The v8 text table silently drops rows once there are many files —
      // json-summary/json are what a coverage-driven pass should actually
      // read (see ADS-memory/reports/jini-port's Phase 6.5 method).
      reporter: ['text', 'json-summary', 'json'],
      // CR-R4: this package had no committed coverage gate at all (see
      // ADS-memory/reports/code-review/CR-backend-coverage-push-2026-07-20.md, R4).
      include: ['src/**'],
      exclude: ['src/**/*.test.ts'],
      thresholds: {
        // 2026-07-22 addition (audit fix, coverage pass): re-derived every
        // branch gap this package had — cloudflare-pages.ts's ~75, vercel.ts's
        // ~15, reachability.ts's ~10, netlify.ts's 2, github-pages.ts's 1 —
        // from scratch rather than trusting the prior ratchet comment above
        // (kept for history). Closed the overwhelming majority with real
        // tests exercising real API-response shapes, and two real refactors
        // in reachability.ts that eliminated dead ternaries and a V8
        // try/catch/finally coverage-instrumentation artifact entirely (see
        // that function's own doc comment). What's left — 32 branches
        // package-wide, all in cloudflare-pages.ts (26), netlify.ts (2),
        // github-pages.ts (1), reachability.ts (1), vercel.ts (2) — is every
        // one individually proven unreachable via its real call graph and
        // documented with both an inline code comment at the exact branch and
        // a packages/deploy/source-map.md entry (see the 2026-07-22 addition
        // there for the full per-branch trace). Measured, current, real
        // numbers: 99.78/95.95/100/99.78 (statements/branches/functions/
        // lines) — this is genuine 100% on every *reachable* branch in the
        // package. Thresholds below are set just under those real numbers as
        // a regression gate, not a stretch target — do not lower them, and
        // raise them only alongside genuinely new coverage (never by
        // documenting a branch unreachable without re-deriving the proof
        // yourself, per this repo's standing rule).
        statements: 99.7,
        branches: 95.9,
        functions: 100,
        lines: 99.7,
      },
    },
  },
});
