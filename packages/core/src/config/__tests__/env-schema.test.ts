import { expect, test } from 'vitest';
import { defineEnvSchema, EnvConfigError, readEnv } from '../env-schema.js';

test('reports every bad name without echoing its value', () => {
  const schema = defineEnvSchema({ vars: {
    Z_PORT: { description: 'a valid port', parse: () => ({ ok: false }) },
    M_MODE: { description: 'a supported mode', parse: () => ({ ok: false }) },
    A_TOKEN: { description: 'a valid token', parse: ({ raw }) => { throw new Error(raw); } },
  } });
  const env = { Z_PORT: 'private-port-value', M_MODE: 'private-mode-value', A_TOKEN: 'private-token-value' };
  let error: unknown;
  try { readEnv({ schema, env }); } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(EnvConfigError);
  expect((error as Error).message).toBe('A_TOKEN: a valid token\nM_MODE: a supported mode\nZ_PORT: a valid port');
  expect((error as Error).cause).toBeUndefined();
  expect(String(error)).not.toContain(env.Z_PORT);
  expect(String(error)).not.toContain(env.M_MODE);
  expect(String(error)).not.toContain(env.A_TOKEN);
});
