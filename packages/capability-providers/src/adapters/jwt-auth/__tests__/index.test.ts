import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { JwtAuthProvider } from '../index.js';

function base64url(input: Buffer): string {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/** Hand-signs a JWT-shaped token with an arbitrary raw (not necessarily well-formed) payload string, for exercising `verifySessionJwt`'s claim-validation branches without going through `JwtAuthProvider`'s own (always-well-formed) `signIn`. */
function craftToken(payloadRaw: string, secret: string, signatureOverride?: Buffer): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const headerPart = base64url(Buffer.from(JSON.stringify(header)));
  const payloadPart = base64url(Buffer.from(payloadRaw));
  const signingInput = `${headerPart}.${payloadPart}`;
  const signature = signatureOverride ?? createHmac('sha256', secret).update(signingInput).digest();
  return `${signingInput}.${base64url(signature)}`;
}

describe('JwtAuthProvider', () => {
  it('throws at construction when secret is empty', () => {
    expect(() => new JwtAuthProvider({ secret: '' })).toThrow(/secret/);
  });

  it('signUp creates a user and returns no password material', async () => {
    const auth = new JwtAuthProvider({ secret: 's3cr3t' });
    const user = await auth.signUp({ email: 'ada@example.com', password: 'hunter2' });
    expect(user.email).toBe('ada@example.com');
    expect(user.id).toBeTruthy();
    expect((user as unknown as { passwordHash?: string }).passwordHash).toBeUndefined();
  });

  it('signUp rejects a duplicate email', async () => {
    const auth = new JwtAuthProvider({ secret: 's3cr3t' });
    await auth.signUp({ email: 'ada@example.com', password: 'hunter2' });
    await expect(auth.signUp({ email: 'ada@example.com', password: 'other' })).rejects.toThrow(/already registered/);
  });

  it('signIn returns a session token for correct credentials', async () => {
    const auth = new JwtAuthProvider({ secret: 's3cr3t' });
    const user = await auth.signUp({ email: 'ada@example.com', password: 'hunter2' });
    const session = await auth.signIn({ email: 'ada@example.com', password: 'hunter2' });
    expect(session.userId).toBe(user.id);
    expect(typeof session.token).toBe('string');
    expect(session.token.split('.')).toHaveLength(3);
  });

  it('signIn rejects an unknown email', async () => {
    const auth = new JwtAuthProvider({ secret: 's3cr3t' });
    await expect(auth.signIn({ email: 'nope@example.com', password: 'x' })).rejects.toThrow(/invalid email or password/);
  });

  it('signIn rejects a wrong password', async () => {
    const auth = new JwtAuthProvider({ secret: 's3cr3t' });
    await auth.signUp({ email: 'ada@example.com', password: 'hunter2' });
    await expect(auth.signIn({ email: 'ada@example.com', password: 'wrong' })).rejects.toThrow(/invalid email or password/);
  });

  it('verifySession resolves a valid, unexpired session token to its user', async () => {
    const auth = new JwtAuthProvider({ secret: 's3cr3t' });
    const user = await auth.signUp({ email: 'ada@example.com', password: 'hunter2' });
    const session = await auth.signIn({ email: 'ada@example.com', password: 'hunter2' });
    expect(await auth.verifySession(session.token)).toEqual(user);
  });

  it('verifySession returns null for a token with the wrong number of segments', async () => {
    const auth = new JwtAuthProvider({ secret: 's3cr3t' });
    expect(await auth.verifySession('not-a-jwt')).toBeNull();
    expect(await auth.verifySession('a.b')).toBeNull();
  });

  it('verifySession returns null for a token signed with a different secret (same-length, wrong-bytes signature)', async () => {
    const authA = new JwtAuthProvider({ secret: 'secret-a' });
    const authB = new JwtAuthProvider({ secret: 'secret-b' });
    await authB.signUp({ email: 'ada@example.com', password: 'hunter2' });
    const session = await authB.signIn({ email: 'ada@example.com', password: 'hunter2' });
    expect(await authA.verifySession(session.token)).toBeNull();
  });

  it('verifySession returns null for a token with a truncated (wrong-length) signature', async () => {
    const auth = new JwtAuthProvider({ secret: 's3cr3t' });
    const token = craftToken(JSON.stringify({ sub: 'u1', jti: 'j1', iat: 0, exp: 9_999_999_999 }), 's3cr3t');
    const [headerPart, payloadPart] = token.split('.');
    const short = `${headerPart}.${payloadPart}.YQ`;
    expect(await auth.verifySession(short)).toBeNull();
  });

  it('verifySession returns null when the signed payload is not valid JSON', async () => {
    const auth = new JwtAuthProvider({ secret: 's3cr3t' });
    const token = craftToken('not json {{', 's3cr3t');
    expect(await auth.verifySession(token)).toBeNull();
  });

  it('verifySession returns null when the signed payload JSON is not an object (e.g. null or a number)', async () => {
    const auth = new JwtAuthProvider({ secret: 's3cr3t' });
    expect(await auth.verifySession(craftToken('null', 's3cr3t'))).toBeNull();
    expect(await auth.verifySession(craftToken('42', 's3cr3t'))).toBeNull();
  });

  it('verifySession returns null when required claims (sub/jti/exp) are missing', async () => {
    const auth = new JwtAuthProvider({ secret: 's3cr3t' });
    expect(await auth.verifySession(craftToken('{}', 's3cr3t'))).toBeNull();
    expect(await auth.verifySession(craftToken(JSON.stringify({ sub: 'u1' }), 's3cr3t'))).toBeNull();
  });

  it('verifySession returns null once a session has expired', async () => {
    let clock = 1_000_000;
    const auth = new JwtAuthProvider({ secret: 's3cr3t', sessionTtlMs: 1000, now: () => clock });
    await auth.signUp({ email: 'ada@example.com', password: 'hunter2' });
    const session = await auth.signIn({ email: 'ada@example.com', password: 'hunter2' });
    expect(await auth.verifySession(session.token)).not.toBeNull();
    clock += 1001;
    expect(await auth.verifySession(session.token)).toBeNull();
  });

  it('signOut revokes a session; verifySession returns null afterward', async () => {
    const auth = new JwtAuthProvider({ secret: 's3cr3t' });
    await auth.signUp({ email: 'ada@example.com', password: 'hunter2' });
    const session = await auth.signIn({ email: 'ada@example.com', password: 'hunter2' });
    await auth.signOut(session.token);
    expect(await auth.verifySession(session.token)).toBeNull();
  });

  it('signOut on an unknown/garbage token is a silent no-op', async () => {
    const auth = new JwtAuthProvider({ secret: 's3cr3t' });
    await expect(auth.signOut('garbage')).resolves.toBeUndefined();
  });

  it('signOut only revokes the targeted session — a second session for the same user stays valid', async () => {
    const auth = new JwtAuthProvider({ secret: 's3cr3t' });
    await auth.signUp({ email: 'ada@example.com', password: 'hunter2' });
    const sessionA = await auth.signIn({ email: 'ada@example.com', password: 'hunter2' });
    const sessionB = await auth.signIn({ email: 'ada@example.com', password: 'hunter2' });
    await auth.signOut(sessionA.token);
    expect(await auth.verifySession(sessionA.token)).toBeNull();
    expect(await auth.verifySession(sessionB.token)).not.toBeNull();
  });

  it('verifySession returns null for a validly-signed, unexpired token whose user is unknown to this instance (process-restart / different-instance scenario)', async () => {
    const provider1 = new JwtAuthProvider({ secret: 'shared-secret' });
    await provider1.signUp({ email: 'ada@example.com', password: 'hunter2' });
    const session = await provider1.signIn({ email: 'ada@example.com', password: 'hunter2' });

    const provider2 = new JwtAuthProvider({ secret: 'shared-secret' });
    expect(await provider2.verifySession(session.token)).toBeNull();
  });
});
