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
      // `src/types.ts` is a genuinely zero-executable-statement file
      // (`export type`/`export interface` only, verified via
      // `grep -nE '^(export )?(const|function|class|let|var) '` finding no
      // runtime declarations) — left in `include` rather than excluded so a
      // future non-type addition to that file is still gated, same
      // reasoning as packages/core/vitest.config.ts's principal.ts carve-out.
      include: ['src/**'],
      exclude: ['src/**/*.test.ts'],
      thresholds: {
        // Measured 2026-07-22 (audit fix, coverage pass): genuine
        // 100/98.34/100/100 package-wide. The prior 97/89/98/97 baseline
        // predated (1) replacing the root-vs-chmod-regressed tests with
        // `vi.mock("node:fs/promises"|"node:net", ...)`-based deterministic
        // error/race injection (see index.test.ts's own top-of-file note —
        // same technique and same reasoning as packages/platform's), and
        // (2) closing port.ts's/json-ipc.ts's remaining pre-existing gaps
        // for real. `branches` sits at 98.34, not 100, because of exactly 4
        // branches confirmed genuinely unreachable through any real call
        // path this session (each independently verified, not assumed —
        // see source-map.md's 2026-07-22 entry): json-ipc.ts's idle-timer
        // `handled` re-check (single-threaded execution already guarantees
        // `clearTimeout` always precedes it) and three `error instanceof
        // Error` checks whose real inputs (a `Socket`'s `'error'` event —
        // typed `Error` by `@types/node` itself and never anything else by
        // Node's own implementation — and a `JSON.parse` failure, always a
        // real `SyntaxError`) can never be non-Error. Raise these numbers if
        // a future change closes one of those — do not lower them.
        statements: 100,
        branches: 98,
        functions: 100,
        lines: 100,
      },
    },
  },
});
