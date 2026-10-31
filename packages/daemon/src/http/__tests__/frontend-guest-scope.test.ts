import { expect, it } from 'vitest';
import type { Request, Response } from 'express';
import { createFrontendGuestScope } from '../frontend-guest-scope.js';

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
