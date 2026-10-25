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
    expect(() => new JwtAuthProvider({ secret: '' }, {})).toThrow(/secret/);
  });

  it('signUp creates a user and returns no password material', async () => {
    const auth = new JwtAuthProvider({ secret: 's3cr3t' }, {});
    const user = await auth.signUp({ email: 'ada@example.com', password: 'hunter2' });
    expect(user.email).toBe('ada@example.com');
    expect(user.id).toBeTruthy();
    expect((user as unknown as { passwordHash?: string }).passwordHash).toBeUndefined();
  });

  it('signUp rejects a duplicate email', async () => {
    const auth = new JwtAuthProvider({ secret: 's3cr3t' }, {});
    await auth.signUp({ email: 'ada@example.com', password: 'hunter2' });
    await expect(auth.signUp({ email: 'ada@example.com', password: 'other' })).rejects.toThrow(/already registered/);
  });

  it('signIn returns a session token for correct credentials', async () => {
    const auth = new JwtAuthProvider({ secret: 's3cr3t' }, {});
    const user = await auth.signUp({ email: 'ada@example.com', password: 'hunter2' });
    const session = await auth.signIn({ email: 'ada@example.com', password: 'hunter2' });
    expect(session.userId).toBe(user.id);
    expect(typeof session.token).toBe('string');
    expect(session.token.split('.')).toHaveLength(3);
  });

  it('signIn rejects an unknown email', async () => {
    const auth = new JwtAuthProvider({ secret: 's3cr3t' }, {});
    await expect(auth.signIn({ email: 'nope@example.com', password: 'x' })).rejects.toThrow(/invalid email or password/);
  });

  it('signIn rejects a wrong password', async () => {
    const auth = new JwtAuthProvider({ secret: 's3cr3t' }, {});
    await auth.signUp({ email: 'ada@example.com', password: 'hunter2' });
    await expect(auth.signIn({ email: 'ada@example.com', password: 'wrong' })).rejects.toThrow(/invalid email or password/);
  });

  it('verifySession resolves a valid, unexpired session token to its user', async () => {
    const auth = new JwtAuthProvider({ secret: 's3cr3t' }, {});
    const user = await auth.signUp({ email: 'ada@example.com', password: 'hunter2' });
    const session = await auth.signIn({ email: 'ada@example.com', password: 'hunter2' });
    expect(await auth.verifySession({ token: session.token })).toEqual(user);
  });

  it('verifySession returns null for a token with the wrong number of segments', async () => {
    const auth = new JwtAuthProvider({ secret: 's3cr3t' }, {});
    expect(await auth.verifySession({ token: 'not-a-jwt' })).toBeNull();
    expect(await auth.verifySession({ token: 'a.b' })).toBeNull();
  });

  it('verifySession returns null for a token signed with a different secret (same-length, wrong-bytes signature)', async () => {
    const authA = new JwtAuthProvider({ secret: 'secret-a' }, {});
    const authB = new JwtAuthProvider({ secret: 'secret-b' }, {});
    await authB.signUp({ email: 'ada@example.com', password: 'hunter2' });
    const session = await authB.signIn({ email: 'ada@example.com', password: 'hunter2' });
    expect(await authA.verifySession({ token: session.token })).toBeNull();
  });

  it('verifySession returns null for a token with a truncated (wrong-length) signature', async () => {
    const auth = new JwtAuthProvider({ secret: 's3cr3t' }, {});
    const token = craftToken(JSON.stringify({ sub: 'u1', jti: 'j1', iat: 0, exp: 9_999_999_999 }), 's3cr3t');
    const [headerPart, payloadPart] = token.split('.');
    const short = `${headerPart}.${payloadPart}.YQ`;
    expect(await auth.verifySession({ token: short })).toBeNull();
  });

  it('verifySession returns null when the signed payload is not valid JSON', async () => {
    const auth = new JwtAuthProvider({ secret: 's3cr3t' }, {});
    const token = craftToken('not json {{', 's3cr3t');
    expect(await auth.verifySession({ token })).toBeNull();
  });

  it('verifySession returns null when the signed payload JSON is not an object (e.g. null or a number)', async () => {
    const auth = new JwtAuthProvider({ secret: 's3cr3t' }, {});
    expect(await auth.verifySession({ token: craftToken('null', 's3cr3t') })).toBeNull();
    expect(await auth.verifySession({ token: craftToken('42', 's3cr3t') })).toBeNull();
  });

  it('verifySession returns null when required claims (sub/jti/exp) are missing', async () => {
    const auth = new JwtAuthProvider({ secret: 's3cr3t' }, {});
    expect(await auth.verifySession({ token: craftToken('{}', 's3cr3t') })).toBeNull();
    expect(await auth.verifySession({ token: craftToken(JSON.stringify({ sub: 'u1' }), 's3cr3t') })).toBeNull();
  });

  it('verifySession returns null once a session has expired', async () => {
    let clock = 1_000_000;
    const auth = new JwtAuthProvider({ secret: 's3cr3t' }, { sessionTtlMs: 1000, now: () => clock });
    await auth.signUp({ email: 'ada@example.com', password: 'hunter2' });
    const session = await auth.signIn({ email: 'ada@example.com', password: 'hunter2' });
    expect(await auth.verifySession({ token: session.token })).not.toBeNull();
    clock += 1001;
    expect(await auth.verifySession({ token: session.token })).toBeNull();
  });

  it('signOut revokes a session; verifySession returns null afterward', async () => {
    const auth = new JwtAuthProvider({ secret: 's3cr3t' }, {});
    await auth.signUp({ email: 'ada@example.com', password: 'hunter2' });
    const session = await auth.signIn({ email: 'ada@example.com', password: 'hunter2' });
    await auth.signOut({ token: session.token });
    expect(await auth.verifySession({ token: session.token })).toBeNull();
  });

  it('signOut on an unknown/garbage token is a silent no-op', async () => {
    const auth = new JwtAuthProvider({ secret: 's3cr3t' }, {});
    await expect(auth.signOut({ token: 'garbage' })).resolves.toBeUndefined();
  });

  it('signOut only revokes the targeted session — a second session for the same user stays valid', async () => {
    const auth = new JwtAuthProvider({ secret: 's3cr3t' }, {});
    await auth.signUp({ email: 'ada@example.com', password: 'hunter2' });
    const sessionA = await auth.signIn({ email: 'ada@example.com', password: 'hunter2' });
    const sessionB = await auth.signIn({ email: 'ada@example.com', password: 'hunter2' });
    await auth.signOut({ token: sessionA.token });
    expect(await auth.verifySession({ token: sessionA.token })).toBeNull();
    expect(await auth.verifySession({ token: sessionB.token })).not.toBeNull();
  });

  it('verifySession returns null for a validly-signed, unexpired token whose user is unknown to this instance (process-restart / different-instance scenario)', async () => {
    const provider1 = new JwtAuthProvider({ secret: 'shared-secret' }, {});
    await provider1.signUp({ email: 'ada@example.com', password: 'hunter2' });
    const session = await provider1.signIn({ email: 'ada@example.com', password: 'hunter2' });

    const provider2 = new JwtAuthProvider({ secret: 'shared-secret' }, {});
    expect(await provider2.verifySession({ token: session.token })).toBeNull();
  });

  // Security guard (index.ts verifySessionJwt length check): `timingSafeEqual` throws RangeError on
  // unequal buffer lengths, so the length guard is the only thing turning a short/long forged
  // signature into a plain rejection. Removing the guard makes every case below reject/throw.
  describe('forged signature of the wrong length', () => {
    const secret = 's3cr3t';
    const payload = JSON.stringify({ sub: 'user-1', jti: 'j1', iat: 0, exp: 4_102_444_800 });
    it.each([
      ['empty', 0],
      ['one byte', 1],
      ['31 bytes (one short)', 31],
      ['33 bytes (one long)', 33],
      ['64 bytes (double)', 64],
    ])('%s signature → verifySession resolves null, never RangeError', async (_label, length) => {
      const auth = new JwtAuthProvider({ secret }, { now: () => 0 });
      await auth.signUp({ email: 'ada@example.com', password: 'hunter2' });
      const token = craftToken(payload, secret, Buffer.alloc(length, 7));
      await expect(auth.verifySession({ token })).resolves.toBeNull();
    });

    it.each([0, 31, 33])('%i-byte signature → signOut is a no-op that does not revoke the real session', async (length) => {
      const auth = new JwtAuthProvider({ secret }, {});
      await auth.signUp({ email: 'ada@example.com', password: 'hunter2' });
      const session = await auth.signIn({ email: 'ada@example.com', password: 'hunter2' });
      const [h, p] = session.token.split('.');
      const forged = `${h}.${p}.${base64url(Buffer.alloc(length, 1))}`;
      await expect(auth.signOut({ token: forged })).resolves.toBeUndefined();
      expect(await auth.verifySession({ token: session.token })).toMatchObject({ id: session.userId });
    });

    it('a correct-length signature with a truncated-then-padded real signature is still rejected', async () => {
      const auth = new JwtAuthProvider({ secret }, {});
      await auth.signUp({ email: 'ada@example.com', password: 'hunter2' });
      const session = await auth.signIn({ email: 'ada@example.com', password: 'hunter2' });
      const [h, p, sig] = session.token.split('.');
      // Drop the last base64url char: decodes to 31 or 32 bytes of mostly-real signature.
      await expect(auth.verifySession({ token: `${h}.${p}.${sig!.slice(0, -1)}` })).resolves.toBeNull();
      await expect(auth.verifySession({ token: `${h}.${p}.${sig}AA` })).resolves.toBeNull();
    });
  });

  it('accepts its own tokens for payloads of every base64 padding residue (0/1/2 pad chars stripped)', async () => {
    // Different email lengths → different `sub`/`jti` sizes don't vary, so vary the user id length via many sign-ups.
    const auth = new JwtAuthProvider({ secret: 's3cr3t' }, {});
    const seenResidues = new Set<number>();
    for (let i = 0; i < 12; i++) {
      await auth.signUp({ email: `u${i}@example.com`, password: 'pw' });
      const session = await auth.signIn({ email: `u${i}@example.com`, password: 'pw' });
      seenResidues.add(session.token.split('.')[1]!.length % 4);
      expect(await auth.verifySession({ token: session.token })).toMatchObject({ id: session.userId });
    }
    expect(seenResidues.size).toBeGreaterThan(1);
  });

  describe('claim shape, header, timing and ids (Stryker L6 survivors)', () => {
    const secret = 's3cr3t';
    const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

    it.each([
      ['non-JSON payload', 'not json'],
      ['JSON null', 'null'],
      ['JSON number', '7'],
      ['missing sub', JSON.stringify({ jti: 'j', exp: 4_102_444_800 })],
      ['numeric sub', JSON.stringify({ sub: 1, jti: 'j', exp: 4_102_444_800 })],
      ['missing jti', JSON.stringify({ sub: 'user-1', exp: 4_102_444_800 })],
      ['numeric jti', JSON.stringify({ sub: 'user-1', jti: 2, exp: 4_102_444_800 })],
      ['string exp', JSON.stringify({ sub: 'user-1', jti: 'j', exp: '4102444800' })],
      ['missing exp', JSON.stringify({ sub: 'user-1', jti: 'j' })],
    ])('a correctly signed token with %s verifies to null and signOut ignores it', async (_label, payload) => {
      const auth = new JwtAuthProvider({ secret }, { now: () => 0 });
      await auth.signUp({ email: 'ada@example.com', password: 'hunter2' });
      const token = craftToken(payload, secret);
      await expect(auth.verifySession({ token })).resolves.toBeNull();
      await expect(auth.signOut({ token })).resolves.toBeUndefined();
    });

    it('a well-formed hand-signed token for a known user verifies (the shape checks are not over-strict)', async () => {
      const auth = new JwtAuthProvider({ secret }, { now: () => 0 });
      const user = await auth.signUp({ email: 'ada@example.com', password: 'hunter2' });
      const token = craftToken(JSON.stringify({ sub: user.id, jti: 'j', iat: 0, exp: 4_102_444_800 }), secret);
      expect(await auth.verifySession({ token })).toEqual(user);
    });

    it('issues an HS256/JWT header, iat/exp in Unix seconds, and a 1-hour default TTL', async () => {
      const now = 1_700_000_123_456;
      const auth = new JwtAuthProvider({ secret }, { now: () => now });
      await auth.signUp({ email: 'ada@example.com', password: 'hunter2' });
      const session = await auth.signIn({ email: 'ada@example.com', password: 'hunter2' });
      const [header, payload] = session.token.split('.');
      expect(decode(header!)).toEqual({ alg: 'HS256', typ: 'JWT' });
      expect(decode(payload!)).toMatchObject({ sub: session.userId, iat: Math.floor(now / 1000), exp: Math.floor((now + 3_600_000) / 1000) });
      expect(session.expiresAt).toBe(now + 3_600_000);
    });

    it('a session is valid one ms before exp and invalid exactly at exp', async () => {
      let now = 1_000_000;
      const auth = new JwtAuthProvider({ secret }, { now: () => now, sessionTtlMs: 10_000 });
      await auth.signUp({ email: 'ada@example.com', password: 'hunter2' });
      const session = await auth.signIn({ email: 'ada@example.com', password: 'hunter2' });
      now = 1_010_000 - 1;
      expect(await auth.verifySession({ token: session.token })).not.toBeNull();
      now = 1_010_000;
      expect(await auth.verifySession({ token: session.token })).toBeNull();
    });

    it('user ids are sequential and distinct', async () => {
      const auth = new JwtAuthProvider({ secret }, {});
      const a = await auth.signUp({ email: 'a@example.com', password: 'x' });
      const b = await auth.signUp({ email: 'b@example.com', password: 'x' });
      expect([a.id, b.id]).toEqual(['user-1', 'user-2']);
    });
  });
});
