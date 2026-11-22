import { expect, it } from 'vitest';
import { createMailCatalog } from '../catalog.js';

/** The SMTP port calls `sendMail({ mail })`; the host's transport must receive that same object. */
it('hands the SMTP payload to the host transport as { mail }, not positionally', async () => {
  const received: unknown[] = [];
  let portTransport: { sendMail(required: { mail: unknown }): Promise<{ messageId: string }> } | undefined;
  const mod = { id: 'x' } as never;
  const catalog = createMailCatalog({
    mailEngine: {
      createRegistry: () => ({ get: () => undefined, list: () => [] }) as never,
      builtins: {
        console: () => mod,
        smtp: (required: { createTransport: (c: never) => typeof portTransport }) => { portTransport = required.createTransport({} as never); return mod; },
      },
    },
    mailHostText: { smtpCredentialLabel: 'l', smtpSetup: { fields: [] }, credentialCategory: 'mail' as never },
    defaultSetup: () => ({ fields: [] }),
    contributeMailProviders: () => ({ accepted: [], refusals: [] }),
  } as never);
  await catalog.loadMailProviderCatalog({
    loadMailAdapters: async () => ({ list: () => [], refusals: [] }),
    createSmtpTransport: (() => ({ sendMail: async (arg: unknown) => { received.push(arg); return { messageId: 'm1' }; } })) as never,
  });
  const mail = { to: 'a@b.c' };
  await expect(portTransport!.sendMail({ mail })).resolves.toEqual({ messageId: 'm1' });
  expect(received).toEqual([{ mail }]);
});
