import { expect, it } from 'vitest';
import { fakeOAuthPkceFlowPort } from './fake-oauth-port.js';
import type { OAuthPkceProviderConfig } from '../oauth-port.js';

const FAKE_CONFIG: OAuthPkceProviderConfig = {
  providerId: 'xai', issuer: 'https://auth.fake.test', authorizationEndpoint: 'https://auth.fake.test/authorize',
  tokenEndpoint: 'https://auth.fake.test/token', clientId: 'fake-client', scope: 'openid',
};

it('keeps the OAuth token store in memory, per file name, and counts pending authorizations', async () => {
  const port = fakeOAuthPkceFlowPort();
  expect(await port.tokens.get({ dataDir: '/d', fileName: 'a' })).toBeNull();
  await port.tokens.set({ dataDir: '/d', fileName: 'a', token: { accessToken: 't', tokenType: 'Bearer', savedAt: 1 } });
  expect((await port.tokens.get({ dataDir: '/d', fileName: 'a' }))?.accessToken).toBe('t');
  expect(await port.tokens.get({ dataDir: '/d', fileName: 'b' })).toBeNull();
  await port.tokens.clear({ dataDir: '/d', fileName: 'a' });
  expect(await port.tokens.get({ dataDir: '/d', fileName: 'a' })).toBeNull();
});

it('runs begin then complete as one dance and consumes the state exactly once', async () => {
  const port = fakeOAuthPkceFlowPort();
  const pending = port.createPendingCache();
  const { state, authorizeUrl } = port.begin({ config: FAKE_CONFIG, pending, redirectUri: 'http://127.0.0.1:1/callback' });
  expect(authorizeUrl).toContain(state);
  expect(pending.size()).toBe(1);
  const token = await port.complete({ config: FAKE_CONFIG, pending, state, code: 'c' });
  expect(token.access_token).toBe('fake-access-token');
  expect(pending.size()).toBe(0);
  await expect(port.complete({ config: FAKE_CONFIG, pending, state, code: 'c' })).rejects.toThrow('state not found or expired');
});

it('lets a test fire the loopback callback and stop the listener', async () => {
  const port = fakeOAuthPkceFlowPort();
  const outcomes: unknown[] = [];
  const listener = await port.startCallbackListener({ host: '127.0.0.1', port: 1, path: '/callback', expectedState: 's', onCallback: (outcome) => { outcomes.push(outcome); } });
  await port.fireCallback({ kind: 'ok', code: 'c', state: 's' });
  expect(outcomes).toEqual([{ kind: 'ok', code: 'c', state: 's' }]);
  await listener.stop();
  expect(port.listenerStops).toBe(1);
});
