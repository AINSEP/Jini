/** The conformance fixture's source (its built bytes are exercised by the packed-install test). */
import { expect, it } from 'vitest';
import plugin from '../fixture-provider/index.js';

it('registers one factory whose port serves its input until disposed', async () => {
  let provider: { factory: (required: Record<string, unknown>, optional?: Record<string, unknown>) => { port: { read(required: Record<string, never>): unknown }; dispose(required: Record<string, never>): void } } | undefined;
  plugin.definition.setup({ providers: { register: (value: never) => { provider = value; } } } as never);
  const resource = provider!.factory({ value: 'fixture' });
  expect(resource.port.read({})).toBe('fixture');
  resource.dispose({});
  expect(resource.port.read({})).toBeUndefined();
});
