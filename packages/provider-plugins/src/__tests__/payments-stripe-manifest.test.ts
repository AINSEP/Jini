import { readFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { paymentsProviderContract } from '@jini-ai/commerce/payments/kernel';
import plugin, { createStripeProvider } from '../payments-stripe/index.js';

it('registers one stateless commerce factory without collecting credentials at initialization', () => {
  const register = vi.fn();
  plugin.definition.setup({ providers: { register } } as never);
  expect(register).toHaveBeenCalledTimes(1);
  expect(register).toHaveBeenCalledWith({ contract: 'payments', id: 'stripe', contractVersion: 1, factory: createStripeProvider });
  const resource = createStripeProvider({});
  expect(paymentsProviderContract.validate({ provider: resource.port })).toBeUndefined();
  expect(createStripeProvider({}, {}).port).not.toBe(resource.port);
  expect(resource.dispose({})).toBeUndefined();
  expect(resource.dispose({}, {})).toBeUndefined();
});

it('keeps the artifact identity and declares public account and mode-scoped secret slots', async () => {
  const manifest = JSON.parse(await readFile(new URL('../payments-stripe/jini.plugin.json', import.meta.url), 'utf8'));
  expect(manifest).toMatchObject({ id: 'payments-stripe', tier: 'tier-3', capabilities: ['providers.register'] });
  expect(manifest.contributes.providers).toHaveLength(1);
  const declaration = manifest.contributes.providers[0];
  expect(declaration).toMatchObject({ contract: 'payments', id: 'stripe', contractVersion: 1 });
  const fields = declaration.settings.map(({ name, secret = false, required = false }: { name: string; secret?: boolean; required?: boolean }) => ({ name, secret, required }));
  expect(fields).toEqual([
    { name: 'accountId', secret: false, required: true },
    ...['test', 'live'].flatMap(mode => createStripeProvider({}).port.credentialKeys.map(key => ({ name: `${mode}_${key}`, secret: true, required: false }))),
  ]);
  await expect(readFile(new URL('../payments-stripe/stripe.ts', import.meta.url))).rejects.toMatchObject({ code: 'ENOENT' });
});
