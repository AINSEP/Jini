import { describe, it, expect, expectTypeOf, vi } from 'vitest';
import { RouteRefusalError } from '@jini-ai/core/errors/route-refusal';
import {
  passwordLoginRoute, mfaLoginRoute, logoutRoute, bootSessionRoute, localBootSessionRoute, currentUserRoute, createPasswordStatusRoute,
  type AuthRequest, type CurrentPrincipalAuth, type SignInAuth, type LogoutAuth, type BootSessionAuth, type LocalBootSessionAuth,
} from '../index.js';

/** The context a route's `handle` accepts. */
type ContextOf<Route extends { handle: (args: never) => unknown }> = NonNullable<Parameters<Route['handle']>[0] extends { context?: infer C } ? C : never>;

describe('K1: each owner-auth route names only the auth operations it uses (rv1123c FIX 4)', () => {
  it('binds each route to its narrowed context type', () => {
    expectTypeOf<ContextOf<typeof passwordLoginRoute>>().toEqualTypeOf<SignInAuth>();
    expectTypeOf<ContextOf<typeof mfaLoginRoute>>().toEqualTypeOf<SignInAuth>();
    expectTypeOf<ContextOf<typeof logoutRoute>>().toEqualTypeOf<LogoutAuth>();
    expectTypeOf<ContextOf<typeof bootSessionRoute>>().toEqualTypeOf<BootSessionAuth>();
    expectTypeOf<ContextOf<typeof localBootSessionRoute>>().toEqualTypeOf<LocalBootSessionAuth>();
    expectTypeOf<ContextOf<typeof currentUserRoute>>().toEqualTypeOf<CurrentPrincipalAuth>();
    expectTypeOf<ContextOf<ReturnType<typeof createPasswordStatusRoute>>>().toEqualTypeOf<CurrentPrincipalAuth>();
  });
  it('the host\'s full AuthRequest still satisfies every view, so one binding serves the registration', () => {
    for (const view of [expectTypeOf<AuthRequest>()]) {
      view.toMatchTypeOf<SignInAuth>(); view.toMatchTypeOf<LogoutAuth>(); view.toMatchTypeOf<BootSessionAuth>();
      view.toMatchTypeOf<LocalBootSessionAuth>(); view.toMatchTypeOf<CurrentPrincipalAuth>();
    }
    // A view does not drag in operations its route never calls.
    expectTypeOf<LogoutAuth>().not.toHaveProperty('currentPrincipal');
    expectTypeOf<CurrentPrincipalAuth>().not.toHaveProperty('revokeSessions');
    expectTypeOf<LogoutAuth['cookies']>().not.toHaveProperty('replaceSession');
  });
  it('password-status runs with a context holding only currentPrincipal', async () => {
    const context: CurrentPrincipalAuth = { currentPrincipal: vi.fn(async () => ({ id: 'p1' })) };
    const deps = { workspaceId: 'w1', findUserByPrincipalId: vi.fn(async () => null), verifyPassword: vi.fn(async () => true), defaultOwnerPassword: 'fixture' };
    expect(await createPasswordStatusRoute().handle({ input: {}, deps, context })).toEqual({ ok: true, value: { usesDefaultPassword: false } });
  });
  it('logout runs with a context holding only revocation and cookie clearing', async () => {
    const events: string[] = [];
    const context: LogoutAuth = { revokeSessions: async () => { events.push('revoke'); }, cookies: { clearSessions: () => { events.push('clear'); return []; } } };
    expect(await logoutRoute.handle({ input: {}, deps: { identityReady: Promise.resolve() }, context })).toEqual({ ok: true, value: { ok: true } });
    expect(events).toEqual(['revoke', 'clear']);
  });
  it('/auth/me refuses 401 from a principal-only context', async () => {
    const context: CurrentPrincipalAuth = { currentPrincipal: async () => null };
    const deps = { workspaceId: 'w1', findUserByPrincipalId: vi.fn(), effectivePermissions: vi.fn(), callerMayManageUserTrash: vi.fn(), canPublishToLive: () => true };
    await expect(currentUserRoute.handle({ input: {}, deps, context })).rejects.toBeInstanceOf(RouteRefusalError);
  });
});
