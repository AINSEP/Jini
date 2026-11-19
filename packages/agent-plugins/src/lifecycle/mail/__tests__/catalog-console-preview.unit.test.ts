import { expect, it } from 'vitest';
import type { MailProviderModule, OutboundEmail } from '@jini-ai/core/contracts/mail';
import { createMailProviderRegistry } from '@jini-ai/platform/mail';
import { createMailCatalog } from '../catalog.js';

type ConsoleBuiltin = Parameters<typeof createMailCatalog>[0]['mailEngine']['builtins']['console'];

/** The local console mailer delivers nothing, so its preview is the only way to use a sign-in link:
 *  the catalog must hand it a preview that logs the whole body (regression: it passed none). */
it('gives the console mail provider a preview that logs the recipient, subject and full body', async () => {
  const lines: string[] = [];
  let preview: ((required: { message: OutboundEmail }) => void | Promise<void>) | undefined;
  const module: MailProviderModule = { id: 'console', label: 'Console', credentialKeys: [], capabilities: { hosted: false, feedback: false, domainVerification: false }, create: () => { throw new Error('not used'); } };
  const console: ConsoleBuiltin = (required) => { preview = required.preview; return module; };
  const catalog = createMailCatalog({
    mailEngine: {
      createRegistry: createMailProviderRegistry,
      builtins: { console, smtp: () => ({ ...module, id: 'smtp' }) },
    },
    mailHostText: { smtpCredentialLabel: 'SMTP', smtpSetup: { fields: [] }, credentialCategory: 'mail' },
    defaultSetup: () => ({ fields: [] }),
    contributeMailProviders: () => ({ accepted: [], refusals: [] }),
  });
  await catalog.loadMailProviderCatalog({
    loadMailAdapters: async () => ({ list: () => [], refusals: [] }),
    createSmtpTransport: () => ({ sendMail: async () => ({ messageId: 'unused' }) }),
    log: line => { lines.push(line); },
  });
  expect(preview).toBeTypeOf('function');
  await preview!({ message: { workspaceId: 'ws', to: { email: 'reader@example.test' }, from: { email: 'from@example.test' }, subject: 'Sign in', text: 'Open https://example.test/sign-in?token=abc' } });
  expect(lines).toEqual(['[mail:console] to=reader@example.test subject="Sign in"\nOpen https://example.test/sign-in?token=abc']);
});
