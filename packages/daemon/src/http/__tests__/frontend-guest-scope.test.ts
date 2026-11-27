import { expect, it } from 'vitest';
import { createFrontendGuestScope } from '../frontend-guest-scope.js';
import type { FrontendHookInput } from '../frontend-hook-input.js';

/** A hook input over a fake of the one `Headers` method the scope reads (a real `Headers` refuses the non-Latin-1 text one test sends). */
const input = ({ cookie = '', tab = '', origin = 'same' }: { cookie?: string; tab?: string; origin?: string } = {}): FrontendHookInput => ({
  request: { method: 'GET', headers: { get: (name: string) => ({ cookie, 'x-frontend-tab': tab, origin })[name] ?? null } as unknown as Headers },
  locals: {},
});
/** The cookie value out of `Set-Cookie` text. */
const cookieOf = (setCookie: string): string => decodeURIComponent(setCookie.split(';')[0]!);

it('rejects same-character-count non-ASCII signatures in guest cookies and tab credentials without throwing', async () => {
  const scope = createFrontendGuestScope({ workspaceId: 'site', cookieName: 'visitor', cookiePath: '/public', allowsRequest: async () => true, isSecureRequest: () => true });
  const issued = await scope.issue(input());
  expect(issued).not.toBeNull();
  const cookie = cookieOf(issued!.setCookie);
  const [payload, signature] = issued!.tabCredential.split('.');
  expect(signature).toHaveLength(43);
  // These all retain the HMAC's JS string length but encode to a different UTF-8 byte length.
  for (const character of ['é', '中', '\ud800']) {
    const malformed = `${payload}.${character}${signature!.slice(1)}`;
    await expect(scope.resolveOwner(input({ cookie, tab: malformed }))).resolves.toBeNull();
    const badCookie = `visitor=${cookie.slice('visitor='.length).split('.')[0]}.${character}${signature!.slice(1)}`;
    await expect(scope.resolveGuest(input({ cookie: badCookie }))).resolves.toBeUndefined();
    await expect(scope.resolveOwner(input({ cookie: badCookie, tab: issued!.tabCredential }))).resolves.toBeNull();
    await expect(scope.issue(input({ cookie: badCookie }))).resolves.toHaveProperty('tabCredential');
  }
});

it('guest and tab credentials are independently minted, scoped, expiring and origin-gated', async () => {
  let now = 100; const cookies: string[] = [];
  const scope = createFrontendGuestScope({ workspaceId: 'site', cookieName: 'visitor', cookiePath: '/public', allowsRequest: async ({ request }) => request.headers.get('origin') === 'same', isSecureRequest: () => true }, { now: () => now, lifetimeMs: 10 });
  const issue = async (cookie = '') => { const issued = await scope.issue(input({ cookie })); cookies.push(cookieOf(issued!.setCookie)); return issued; };
  const first = await issue();
  const firstCookie = cookies.at(-1)!;
  const second = await issue(firstCookie);
  const owner = await scope.resolveOwner(input({ cookie: firstCookie, tab: first!.tabCredential }));
  const next = await scope.resolveOwner(input({ cookie: firstCookie, tab: second!.tabCredential }));
  expect(owner?.principalId).toBe(next?.principalId);
  expect(owner?.tabId).not.toBe(next?.tabId);
  expect(await scope.resolveOwner(input({ cookie: `visitor=${first!.tabCredential}`, tab: first!.tabCredential }))).toBeNull();
  expect(await scope.resolveOwner(input({ cookie: firstCookie, tab: firstCookie.slice('visitor='.length) }))).toBeNull();
  await issue(`visitor=${first!.tabCredential}`);
  expect(cookies.at(-1)).not.toBe(firstCookie);
  await issue();
  expect(await scope.resolveOwner(input({ cookie: cookies.at(-1)!, tab: first!.tabCredential }))).toBeNull();
  expect(await scope.resolveOwner(input({ cookie: firstCookie, tab: first!.tabCredential, origin: 'cross' }))).toBeNull();
  expect(await scope.resolveOwner(input({ cookie: firstCookie, tab: first!.tabCredential + 'forged' }))).toBeNull();
  now += 11;
  expect(await scope.resolveOwner(input({ cookie: firstCookie, tab: first!.tabCredential }))).toBeNull();
});

it('hands the host\'s own answer for "is this HTTPS" to the cookie, and never leaks the cookie into what the caller sends back', async () => {
  const seen: FrontendHookInput[] = [];
  for (const secure of [true, false]) {
    const scope = createFrontendGuestScope({ workspaceId: 'site', cookieName: 'visitor', cookiePath: '/public', allowsRequest: async () => true, isSecureRequest: (hook) => { seen.push(hook); return secure; } }, { now: () => 1_700_000_000_000, lifetimeMs: 30 * 60_000 });
    const issued = await scope.issue(input());
    expect(issued!.setCookie).toMatch(new RegExp(`^visitor=[A-Za-z0-9_.%-]+; Max-Age=1800; Path=/public; Expires=Tue, 14 Nov 2023 22:43:20 GMT; HttpOnly;${secure ? ' Secure;' : ''} SameSite=Strict$`));
    expect(issued!.tabCredential).not.toContain(issued!.setCookie.split(';')[0]!.slice('visitor='.length));
  }
  expect(seen).toHaveLength(2);
});

it('rejects incomplete or oversized tab credentials and does not issue credentials for a refused request', async () => {
  let now = 50;
  const scope = createFrontendGuestScope({
    workspaceId: 'site', cookieName: 'visitor', cookiePath: '/public',
    allowsRequest: async ({ request }) => request.headers.get('origin') === 'same',
    isSecureRequest: () => true,
  }, { now: () => now, lifetimeMs: 1000 });
  const issued = await scope.issue(input());
  if (!issued) throw new Error('same-origin guest must be issued a credential');
  const cookie = cookieOf(issued.setCookie);
  const owner = await scope.resolveOwner(input({ cookie, tab: issued.tabCredential }));
  if (!owner) throw new Error('valid guest and tab must resolve an owner');
  expect(await scope.resolveGuest(input({ cookie }))).toBe(owner.principalId);
  expect(await scope.resolveGuest(input({ cookie, origin: 'cross' }))).toBeUndefined();
  expect(await scope.issue(input({ cookie, origin: 'cross' }))).toBeNull();

  const [payload, signature] = issued.tabCredential.split('.');
  for (const tab of [`.${signature}`, `${payload}.`, 'x'.repeat(1025)]) {
    expect(await scope.resolveOwner(input({ cookie, tab }))).toBeNull();
  }
  now += 1000;
  expect(await scope.resolveGuest(input({ cookie }))).toBeUndefined();
  expect(await scope.resolveOwner(input({ cookie, tab: issued.tabCredential }))).toBeNull();
});
