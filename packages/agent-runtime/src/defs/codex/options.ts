/** @file Codex definition config. A host policy that only the Codex definition reads; it never enters a
 * neutral contract (owner rule: vendor code lives with its vendor). Environment defaults are read at native composition. */
export interface CodexDefOptions {
  /** Pass `--disable plugins` to every Codex run. */
  readonly disablePlugins?: boolean;
}

/** Explicit host/run policy wins; this is the environment default native composition falls back to. */
export function codexDefOptionsFromEnv(required: { env: Record<string, string | undefined> }, _optional: Record<string, never> = {}): CodexDefOptions {
  return { disablePlugins: required.env.CODEX_DISABLE_PLUGINS === '1' };
}
