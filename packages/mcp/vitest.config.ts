import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      // The v8 text table silently drops rows once there are many files —
      // json-summary/json are what a coverage-driven pass should actually
      // read (see ADS-memory/reports/jini-port/skills/fixing-open-design.md Phase 6.5).
      reporter: ['text', 'json-summary', 'json'],
      include: ['src/**'],
      exclude: ['src/**/*.test.ts'],
      thresholds: {
        // Measured 2026-07-22 (audit fix — oauth.ts's last two branch gaps closed for real: a dead
        // `headers?` optional made required, since all three real internal call sites always
        // supplied it; `readCappedText`'s real-but-unused `controller` early-abort parameter
        // exported and directly unit-tested. See oauth.ts's own doc comment and this package's
        // source-map.md dated entry). The 2026-07-21 note below about oauth.ts's 98.77% branches
        // keeping the global aggregate under 100 no longer applies — genuine 100/100/100/100 across
        // every file in this package now, set at the real number, not a margin below it.
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
