/** Pure environment descriptions for host-owned diagnostics. */
import type { EnvSchema, EnvValueEcho, HostEnvironment } from '../contracts/env.js';
import { echoEnvValue } from './value-echo.js';

/** Render only the disclosure-safe echo, never the raw environment value. */
function describeEcho({ echo }: { echo: EnvValueEcho }): string {
  if (echo.kind === 'shown') return echo.text;
  return echo.kind === 'hidden' ? `set (${echo.length} characters)` : 'not set';
}

/** Describe every schema name and every supplied env name without applying defaults or coercion.
 * Values require an explicit non-secret value display; unknown names always show presence only.
 * Pure: no I/O, ambient reads or input mutation; bad values do not throw.
 * @param required The host's schema and environment snapshot.
 * @returns Env names mapped to sanitized values, `set (N characters)` or `not set`.
 * @complexity O(s + e) lookups for s specs and e env entries, plus shown-value redaction;
 *   O(s + e) map entries and bounded text per entry.
 * @example describeEnvForDiagnostics({ schema, env: hostEnv });
 */
export function describeEnvForDiagnostics<Config>(
  required: { readonly schema: EnvSchema<Config>; readonly env: HostEnvironment },
  _optional: Record<string, never> = {},
): Readonly<Record<string, string>> {
  const { schema, env } = required;
  const byName = new Map(schema.specs.map(spec => [spec.name, spec]));
  const names = new Set([...byName.keys(), ...Object.keys(env)]);
  return Object.fromEntries([...names].map(name => [name, describeEcho({ echo: echoEnvValue({ spec: byName.get(name), raw: env[name] }) })]));
}
