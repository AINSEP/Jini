import { expect, it, vi } from 'vitest';
import { checkDeploymentUrl, waitForReachableDeploymentUrl } from '../reachability.js';

// REGRESSION: fails if requestDeploymentUrl uses platform validation instead of the injected guard.
it('refuses through the injected policy before opening the transport', async () => {
  const fetch = vi.fn(async () => new Response());
  const guard = { assertSafeUrl: vi.fn((): URL => { throw new Error('host policy refused'); }) };
  expect(await checkDeploymentUrl({ url: 'https://example.test', fetch, guard })).toEqual({
    reachable: false, statusMessage: 'Public link is not reachable yet: host policy refused',
  });
  expect(guard.assertSafeUrl).toHaveBeenCalledWith({ raw: 'https://example.test', label: 'deployment url' });
  expect(fetch).not.toHaveBeenCalled();
});

// REGRESSION: fails if checkDeploymentUrl does not require a runtime guard.
it('fails closed when an untyped host omits the required guard', async () => {
  const fetch = vi.fn(async () => new Response());
  // @ts-expect-error exercise JavaScript callers that omitted a required port.
  const result = await checkDeploymentUrl({ url: 'https://example.test', fetch });
  expect(result.reachable).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});

// REGRESSION: fails if waitForReachableDeploymentUrl drops guard when forwarding to checkDeploymentUrl.
it('passes the same guard through the polling API', async () => {
  const guard = { assertSafeUrl: vi.fn(({ raw }: { raw: string; label: string }) => new URL(raw)) };
  const fetch = vi.fn(async () => new Response(null, { status: 200 }));
  const result = await waitForReachableDeploymentUrl({ urls: ['example.test'], fetch, guard, now: () => 100, sleep: async () => {} });
  expect(result.status).toBe('ready');
  expect(guard.assertSafeUrl).toHaveBeenCalledTimes(1);
});

// PARITY
it('requires HTTPS even if the supplied public URL guard permits HTTP', async () => {
  const fetch = vi.fn(async () => new Response());
  const guard = { assertSafeUrl: ({ raw }: { raw: string; label: string }) => new URL(raw) };
  const result = await checkDeploymentUrl({ url: 'http://example.test', fetch, guard });
  expect(result.statusMessage).toContain('deployment url must use https');
  expect(fetch).not.toHaveBeenCalled();
});

// A provider preview may be protected while its public alias is already ready.
it.each([200, 503])('tries a public candidate after a protected one (public status %s)', async (status) => {
  const visited: string[] = [];
  const fetch = vi.fn(async ({ url }: { url: string }) => {
    visited.push(url);
    if (url.includes('preview')) return new Response('auth wall', { status: 401 });
    return new Response(null, { status });
  });
  const result = await waitForReachableDeploymentUrl({
    urls: ['preview.example', 'public.example'], fetch,
    guard: { assertSafeUrl: ({ raw }) => new URL(raw) },
    now: () => 100, sleep: vi.fn(async () => {}),
  }, { detectProtected: ({ body }) => body.includes('auth wall'), protectedMessage: 'preview gated' });
  expect(visited).toContain('https://public.example/');
  expect(result).toEqual(status === 200
    ? { status: 'ready', url: 'https://public.example', statusMessage: 'Public link is ready.', reachableAt: 100 }
    : { status: 'protected', url: 'https://preview.example', statusMessage: 'preview gated' });
});
