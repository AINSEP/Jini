import { toPluginHttpClient } from '@jini-ai/platform/mail';
import { expect, it } from 'vitest';
import type { HttpClientPort, HttpRequest } from '@jini-ai/core/primitives';

it('the real resend plugin sends through the neutral host object-request HTTP port', async () => {
  const modulePath = '@jini-ai/agent-plugins/resend/adapters/resend.mjs';
  const plugin = (await import(modulePath)).default;
  const requests: HttpRequest[] = [];
  const httpClient: HttpClientPort = { send: async ({ request }) => {
    expect(request).toBeDefined();
    requests.push(request);
    return { status: 200, headers: {}, bodyText: '{"id":"neutral-message"}' };
  } };
  const mailer = plugin.create({ credential: { token: 'neutral-key' }, kit: { httpClient: toPluginHttpClient({ httpClient }) } });
  const result = await mailer.send({ workspaceId: 'studio', from: { email: 'sender@example.test' }, to: { email: 'reader@example.test' }, subject: 'Hello', text: 'Body' }, {
    workspaceId: 'studio', idempotencyKey: 'neutral-send', sourceContext: { module: 'studio' },
  });
  expect(result.ok).toBe(true);
  expect(requests).toHaveLength(1);
  expect(requests[0]?.headers.Authorization).toBe('Bearer neutral-key');
});
