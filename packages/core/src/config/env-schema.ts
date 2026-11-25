import type { HostEnvironment } from '../contracts/env.js';

export type EnvVarField<T> = {
  readonly description: string;
  parse(
    required: { raw: string | undefined },
    _optional?: Record<string, never>,
  ): { ok: true; value: T } | { ok: false };
};
export type EnvVars = Readonly<Record<string, EnvVarField<unknown>>>;
export type EnvValues<V extends EnvVars> = {
  readonly [K in keyof V]: V[K] extends EnvVarField<infer T> ? T : never;
};
export class EnvConfigError extends Error {
  override name = 'EnvConfigError';
}

// Strict boot policy does not silently change hosts that use tolerant diagnostics.
export function defineEnvSchema<const V extends EnvVars>(
  { vars }: { vars: V },
  _optional: Record<string, never> = {},
): Readonly<{ vars: V }> {
  return Object.freeze({ vars });
}

export function readEnv<V extends EnvVars>(
  { schema, env }: { schema: Readonly<{ vars: V }>; env: HostEnvironment },
  _optional: Record<string, never> = {},
): Readonly<EnvValues<V>> {
  const values: Record<string, unknown> = {};
  const failures: string[] = [];
  for (const name of Object.keys(schema.vars).sort()) {
    const field = schema.vars[name]!;
    let result: ReturnType<EnvVarField<unknown>['parse']>;
    try { result = field.parse({ raw: env[name] }); }
    catch { result = { ok: false }; }
    if (result.ok) values[name] = result.value;
    else failures.push(`${name}: ${field.description}`);
  }
  if (failures.length > 0) throw new EnvConfigError(failures.join('\n'));
  return Object.freeze(values) as Readonly<EnvValues<V>>;
}
