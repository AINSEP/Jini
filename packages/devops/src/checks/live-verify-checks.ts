/**
 * @file The PASS/FAIL ledger shared by the opt-in live Playwright verifiers
 * (`scripts/verify-find-in-page.ts`, `scripts/verify-site-power.ts`). Each check prints one
 * `PASS::`/`FAIL::` line as it is decided; the final report lists every failure and yields the exit
 * code. The log sink is injected, so the ledger's format and verdict are unit-tested here while the
 * verifiers themselves need a real Electron app (they are not part of `npm test`).
 */

/** One verifier run's ledger. */
interface CheckLog {
  /** Record one check, printing `PASS:: <name> — <detail>` or `FAIL:: <name> — <detail>`. */
  check(required: { name: string; ok: boolean; detail: string }, optional?: {}): void;
  /** Print the verdict: every failure (exit 1) or `VERIFY_OK` (exit 0). */
  report(): 0 | 1;
}

/**
 * @param input.log where each line goes — `console.log` at the composition edge.
 * @returns a fresh ledger with no recorded failures.
 */
export function createCheckLog({ log }: { log: (input: { line: string }, options?: Record<string, never>) => void }): CheckLog {
  const failures: string[] = [];
  return {
    check({ name, ok, detail }, _optional = {}) {
      log({ line: `${ok ? "PASS" : "FAIL"}:: ${name} — ${detail}` });
      if (!ok) failures.push(`${name}: ${detail}`);
    },
    report() {
      if (failures.length > 0) {
        log({ line: `\nVERIFY_FAILED:: ${failures.length} check(s)\n- ${failures.join("\n- ")}` });
        return 1;
      }
      log({ line: "\nVERIFY_OK:: every check passed" });
      return 0;
    },
  };
}

export type { CheckLog };
