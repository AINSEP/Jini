import { expect, it } from 'vitest';
import type { Request, Response } from 'express';
import { createFrontendGuestScope } from '../frontend-guest-scope.js';

it('rejects same-character-count non-ASCII signatures in guest cookies and tab credentials without throwing', async () => {
  const scope = createFrontendGuestScope({ workspaceId: 'site', cookieName: 'visitor', cookiePath: '/public', allowsRequest: async () => true });
  let cookie = '';
  const request = (value = '', tab = '') => ({ secure: true, get: (name: string) => ({ cookie: value, 'x-frontend-tab': tab }[name]) }) as Request;
  const res = { cookie: (_name: string, value: string) => { cookie = `visitor=${value}`; }, setHeader() {} } as unknown as Response;
  const issued = await scope.issue({ req: request(), res });
  expect(issued).not.toBeNull();
  const [payload, signature] = issued!.tabCredential.split('.');
  expect(signature).toHaveLength(43);
  // These all retain the HMAC's JS string length but encode to a different UTF-8 byte length.
  for (const character of ['é', '中', '\ud800']) {
    const malformed = `${payload}.${character}${signature!.slice(1)}`;
    await expect(scope.resolveOwner({ req: request(cookie, malformed) })).resolves.toBeNull();
    const badCookie = `visitor=${cookie.slice('visitor='.length).split('.')[0]}.${character}${signature!.slice(1)}`;
    await expect(scope.resolveGuest({ req: request(badCookie) })).resolves.toBeUndefined();
    await expect(scope.resolveOwner({ req: request(badCookie, issued!.tabCredential) })).resolves.toBeNull();
    await expect(scope.issue({ req: request(badCookie), res })).resolves.toHaveProperty('tabCredential');
  }
});

it('guest and tab credentials are independently minted, scoped, expiring and origin-gated', async () => {
  let now = 100; const cookies: string[] = [];
  const scope = createFrontendGuestScope({ workspaceId: 'site', cookieName: 'visitor', cookiePath: '/public', allowsRequest: async ({ req }) => req.get('origin') === 'same' }, { now: () => now, lifetimeMs: 10 });
  const request = (cookie = '', tab = '', origin = 'same') => ({ secure: true, get: (name: string) => ({ cookie, 'x-frontend-tab': tab, origin }[name]) }) as Request;
  const res = { cookie: (_name: string, value: string, options: { httpOnly: boolean; secure: boolean; sameSite: string }) => {
    expect(options).toMatchObject({ httpOnly: true, secure: true, sameSite: 'strict' }); cookies.push(`visitor=${value}`);
  }, setHeader() {} } as unknown as Response;
  const first = await scope.issue({ req: request(), res });
  const firstCookie = cookies.at(-1)!;
  const second = await scope.issue({ req: request(firstCookie), res });
  const owner = await scope.resolveOwner({ req: request(firstCookie, first!.tabCredential) });
  const next = await scope.resolveOwner({ req: request(firstCookie, second!.tabCredential) });
  expect(owner?.principalId).toBe(next?.principalId);
  expect(owner?.tabId).not.toBe(next?.tabId);
  expect(await scope.resolveOwner({ req: request(`visitor=${first!.tabCredential}`, first!.tabCredential) })).toBeNull();
  expect(await scope.resolveOwner({ req: request(firstCookie, firstCookie.slice('visitor='.length)) })).toBeNull();
  await scope.issue({ req: request(`visitor=${first!.tabCredential}`), res });
  expect(cookies.at(-1)).not.toBe(firstCookie);
  await scope.issue({ req: request(), res });
  expect(await scope.resolveOwner({ req: request(cookies.at(-1), first!.tabCredential) })).toBeNull();
  expect(await scope.resolveOwner({ req: request(firstCookie, first!.tabCredential, 'cross') })).toBeNull();
  expect(await scope.resolveOwner({ req: request(firstCookie, first!.tabCredential + 'forged') })).toBeNull();
  now += 11;
  expect(await scope.resolveOwner({ req: request(firstCookie, first!.tabCredential) })).toBeNull();
});
