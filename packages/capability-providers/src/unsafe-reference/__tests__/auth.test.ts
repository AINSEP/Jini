import { describe, expect, it } from 'vitest';
import { createInMemoryAuthProvider } from '../auth.js';

describe('createInMemoryAuthProvider — signUp/signIn/signOut/verifySession', () => {
  it('signs up a new user', async () => {
    const auth = createInMemoryAuthProvider({}, {});
    const user = await auth.signUp({ email: 'a@example.com', password: 'hunter2' });
    expect(user.email).toBe('a@example.com');
    expect(user.id).toBeTypeOf('string');
    expect(user.createdAt).toBeTypeOf('number');
  });

  it('rejects signUp with an already-registered email', async () => {
    const auth = createInMemoryAuthProvider({}, {});
    await auth.signUp({ email: 'a@example.com', password: 'hunter2' });
    await expect(auth.signUp({ email: 'a@example.com', password: 'other' })).rejects.toThrow(/already registered/);
  });

  it('signs in with correct credentials and returns a session', async () => {
    const auth = createInMemoryAuthProvider({}, {});
    await auth.signUp({ email: 'a@example.com', password: 'hunter2' });
    const session = await auth.signIn({ email: 'a@example.com', password: 'hunter2' });
    expect(session.token).toBeTypeOf('string');
    expect(session.expiresAt).toBeGreaterThan(Date.now());
  });

  it('rejects signIn for an unknown email', async () => {
    const auth = createInMemoryAuthProvider({}, {});
    await expect(auth.signIn({ email: 'nope@example.com', password: 'x' })).rejects.toThrow(/invalid email or password/);
  });

  it('rejects signIn for a wrong password', async () => {
    const auth = createInMemoryAuthProvider({}, {});
    await auth.signUp({ email: 'a@example.com', password: 'hunter2' });
    await expect(auth.signIn({ email: 'a@example.com', password: 'wrong' })).rejects.toThrow(/invalid email or password/);
  });

  it('verifySession resolves a valid token to its user', async () => {
    const auth = createInMemoryAuthProvider({}, {});
    const user = await auth.signUp({ email: 'a@example.com', password: 'hunter2' });
    const session = await auth.signIn({ email: 'a@example.com', password: 'hunter2' });
    const verified = await auth.verifySession({ token: session.token });
    expect(verified).toEqual(user);
  });

  it('verifySession returns null for an unknown token', async () => {
    const auth = createInMemoryAuthProvider({}, {});
    expect(await auth.verifySession({ token: 'nope' })).toBeNull();
  });

  it('verifySession returns null and forgets an expired session', async () => {
    let clock = 1000;
    const auth = createInMemoryAuthProvider({}, { sessionTtlMs: 10, now: () => clock });
    await auth.signUp({ email: 'a@example.com', password: 'hunter2' });
    const session = await auth.signIn({ email: 'a@example.com', password: 'hunter2' });
    clock += 100;
    expect(await auth.verifySession({ token: session.token })).toBeNull();
    // Second call proves it was actually forgotten, not just re-evaluated as expired each time.
    clock = 1000;
    expect(await auth.verifySession({ token: session.token })).toBeNull();
  });

  it('signOut invalidates a session', async () => {
    const auth = createInMemoryAuthProvider({}, {});
    await auth.signUp({ email: 'a@example.com', password: 'hunter2' });
    const session = await auth.signIn({ email: 'a@example.com', password: 'hunter2' });
    await auth.signOut({ token: session.token });
    expect(await auth.verifySession({ token: session.token })).toBeNull();
  });

  it('signOut on an unknown token is a silent no-op', async () => {
    const auth = createInMemoryAuthProvider({}, {});
    await expect(auth.signOut({ token: 'nope' })).resolves.toBeUndefined();
  });

  it('defaults sessionTtlMs and now when not supplied', async () => {
    const auth = createInMemoryAuthProvider({}, {});
    await auth.signUp({ email: 'a@example.com', password: 'hunter2' });
    const session = await auth.signIn({ email: 'a@example.com', password: 'hunter2' });
    expect(session.expiresAt - Date.now()).toBeGreaterThan(59 * 60 * 1000);
  });
});
