import { expect, it } from 'vitest';
import { startLoopbackAuthorizationReceiver } from '../src/loopback-receiver.js';

it('observes cancellation before receive and keeps the same rejection for later awaiters', async () => {
  const controller = new AbortController();
  const receiver = await startLoopbackAuthorizationReceiver({}, { signal: controller.signal });
  controller.abort();
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  const result = receiver.receive({ expectedState: 'fixture-state' });
  const failure = await result.then(() => { throw new Error('cancelled receiver resolved'); }, error => error);
  expect(failure).toMatchObject({ code: 'OAUTH_AUTHORIZATION_CANCELLED' });
  await expect(result).rejects.toBe(failure);
});
