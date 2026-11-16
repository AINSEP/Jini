/** @file Pi definition config. A host policy that only the Pi RPC session reads; it never enters a neutral
 * contract (owner rule: vendor code lives with its vendor). Environment defaults are read at native composition. */
export interface PiDefOptions {
  /** How long a Pi RPC session may take to stop on its own before it is killed. `0` kills at once. */
  readonly gracefulShutdownMs?: number;
}

/** Explicit host policy wins, then `PI_GRACEFUL_SHUTDOWN_MS`, then 5000 ms. An unparsable or zero env value means 5000. */
export function piDefOptionsFromEnv(required: { env: Record<string, string | undefined> }, _optional: Record<string, never> = {}): PiDefOptions {
  return { gracefulShutdownMs: Number(required.env.PI_GRACEFUL_SHUTDOWN_MS) || 5000 };
}
