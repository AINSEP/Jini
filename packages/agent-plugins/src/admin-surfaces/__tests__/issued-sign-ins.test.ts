import { describe, expect, test } from 'vitest';
import { createIssuedSignInCollector } from '../node.js';

const link = (authorizationUrl: string) => ({ authorizationUrl, expiresAt: '2026-01-01T00:00:00.000Z' });

describe('createIssuedSignInCollector', () => {
  test('keeps https and host-admitted http links issued inside one collection only', async () => {
    const collector = createIssuedSignInCollector({ admitHttp: ({ url }) => url.pathname.startsWith('/sign-in/') });
    collector.record(link('https://outside.test/a'));
    const { value, signIns } = await collector.collect({ run: async () => {
      for (const url of ['https://idp.test/x', 'http://host.test/sign-in/1', 'http://evil.test/x', 'javascript:alert(1)', 'not a url']) collector.record(link(url));
      return 7;
    } });
    expect(value).toBe(7);
    expect(signIns.map((entry) => entry.authorizationUrl)).toEqual(['https://idp.test/x', 'http://host.test/sign-in/1']);
  });

  test('concurrent collections stay apart', async () => {
    const collector = createIssuedSignInCollector({ admitHttp: () => false });
    const [a, b] = await Promise.all(['https://a.test/', 'https://b.test/'].map((url) => collector.collect({ run: async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      collector.record(link(url));
    } })));
    expect(a!.signIns.map((entry) => entry.authorizationUrl)).toEqual(['https://a.test/']);
    expect(b!.signIns.map((entry) => entry.authorizationUrl)).toEqual(['https://b.test/']);
  });
});
