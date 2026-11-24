import { vi } from 'vitest';
import type { AuthRequest, BootRedemption } from '../auth-request.js';

/** A recording AuthRequest: every effect lands in `events`, in order, so a test pins sequencing. */
export function fakeAuthRequest(over: Partial<AuthRequest> & { allowed?: boolean; retryAfterSeconds?: number } = {}) {
  const events: string[] = [];
  const { allowed = true, retryAfterSeconds = 42, ...rest } = over;
  const auth: AuthRequest = {
    clientKey: '203.0.113.7',
    sessionOptions: () => ({ ip: '203.0.113.7', userAgent: 'ua', sessionTtlMs: 1000 }),
    rateLimit: { check: vi.fn(async () => { events.push('rate'); return { allowed, retryAfterSeconds }; }) },
    currentPrincipal: vi.fn(async () => null),
    revokeSessions: vi.fn(async () => { events.push('revoke'); }),
    cookies: {
      replaceSession: vi.fn(({ rawToken }, { name = 'session' } = {}) => { events.push(`cookie:${name}`); return [`${name}=${rawToken}`]; }),
      clearSessions: vi.fn(() => { events.push('clear'); return ['session=; Expires=Thu, 01 Jan 1970 00:00:00 GMT']; }),
    },
    noStore: vi.fn(() => { events.push('no-store'); }),
    retryAfter: vi.fn((seconds: number) => { events.push(`retry-after:${seconds}`); }),
    signedIn: vi.fn(({ principalId }) => { events.push(`signed-in:${principalId}`); }),
    loopback: true,
    localOwnerSignIn: { enabled: false, acceptsCapability: () => false, allowsRequest: () => false },
    redeemBootSession: vi.fn(async (): Promise<BootRedemption> => ({ kind: 'refused' })),
    ...rest,
  };
  return { auth, events };
}
