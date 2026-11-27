import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { expect, test } from 'vitest';
import { createSimpleWebAuthnPasskeys } from '../passkey-adapter.js';

/** A minimal software authenticator ("none" attestation, ES256) so the real verifier runs end to end. */
const site = { origin: 'https://site.example.test', rpId: 'site.example.test', name: 'Example Site' };
const scope = { workspaceId: 'ws', principalId: 'owner' };
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');
const cborBytes = (bytes: Uint8Array) => Buffer.concat([bytes.length < 24 ? Buffer.from([0x40 + bytes.length]) : Buffer.from([0x58, bytes.length]), bytes]);
const cborText = (text: string) => Buffer.concat([Buffer.from([0x60 + text.length]), Buffer.from(text)]);

function authenticator() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const coseKey = Buffer.concat([Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21]), cborBytes(Buffer.from(jwk.x ?? '', 'base64url')), Buffer.from([0x22]), cborBytes(Buffer.from(jwk.y ?? '', 'base64url'))]);
  const credId = Buffer.from('credential-0001');
  const rpIdHash = createHash('sha256').update(site.rpId).digest();
  const clientData = ({ type, challenge }: { type: string; challenge: string }) => Buffer.from(JSON.stringify({ type, challenge, origin: site.origin, crossOrigin: false }));
  const attest = ({ challenge }: { challenge: string }) => {
    const authData = Buffer.concat([rpIdHash, Buffer.from([0x45, 0, 0, 0, 0]), Buffer.alloc(16), Buffer.from([0, credId.length]), credId, coseKey]);
    const attestationObject = Buffer.concat([Buffer.from([0xa3]), cborText('fmt'), cborText('none'), cborText('attStmt'), Buffer.from([0xa0]), cborText('authData'), cborBytes(authData)]);
    return { id: b64(credId), rawId: b64(credId), type: 'public-key', clientExtensionResults: {},
      response: { clientDataJSON: b64(clientData({ type: 'webauthn.create', challenge })), attestationObject: b64(attestationObject), transports: [] } };
  };
  const assertWith = ({ challenge, counter }: { challenge: string; counter: number }) => {
    const authData = Buffer.concat([rpIdHash, Buffer.from([0x05]), Buffer.from([0, 0, 0, counter])]);
    const data = clientData({ type: 'webauthn.get', challenge });
    const signature = sign('sha256', Buffer.concat([authData, createHash('sha256').update(data).digest()]), privateKey);
    return { id: b64(credId), rawId: b64(credId), type: 'public-key', clientExtensionResults: {},
      response: { clientDataJSON: b64(data), authenticatorData: b64(authData), signature: b64(signature) } };
  };
  return { credId: b64(credId), coseKey: b64(coseKey), attest, assertWith };
}

test('registration options name the site, hash the scope into the user id, and exclude saved credentials', async () => {
  const passkeys = createSimpleWebAuthnPasskeys({});
  const saved = [{ ...scope, id: 'AAEC', publicKey: 'x', counter: 0, rpId: site.rpId }];
  const options = await passkeys.registration({ site, scope, credentials: saved });
  expect(options).toMatchObject({ rp: { name: 'Example Site', id: 'site.example.test' }, attestation: 'none',
    user: { name: 'Owner', id: b64(createHash('sha256').update(JSON.stringify(['ws', 'owner'])).digest()) },
    excludeCredentials: [{ id: 'AAEC', type: 'public-key' }], authenticatorSelection: { userVerification: 'required', residentKey: 'discouraged' } });
  const other = await passkeys.registration({ site, scope: { ...scope, principalId: 'staff' }, credentials: [] });
  expect(other.user).not.toEqual(options.user);
  expect(other.challenge).not.toBe(options.challenge);
});

test('authentication options require user verification and allow only the saved credentials', async () => {
  const options = await createSimpleWebAuthnPasskeys({}).authentication({ site, credentials: [{ ...scope, id: 'AAEC', publicKey: 'x', counter: 0, rpId: site.rpId }] });
  expect(options).toMatchObject({ rpId: 'site.example.test', userVerification: 'required', allowCredentials: [{ id: 'AAEC', type: 'public-key' }] });
});

test('a real attestation registers and a signed assertion returns the new counter', async () => {
  const passkeys = createSimpleWebAuthnPasskeys({});
  const device = authenticator();
  const { challenge } = await passkeys.registration({ site, scope, credentials: [] });
  const registered = await passkeys.register({ site, response: device.attest({ challenge: String(challenge) }), challenge: String(challenge) });
  expect(registered).toEqual({ id: device.credId, publicKey: device.coseKey, counter: 0 });
  const login = await passkeys.authentication({ site, credentials: [] });
  const counter = await passkeys.authenticate({ site, challenge: String(login.challenge), response: device.assertWith({ challenge: String(login.challenge), counter: 7 }),
    credential: { ...scope, ...registered, rpId: site.rpId } });
  expect(counter).toBe(7);
});

test('a response for another challenge is rejected by the verifier', async () => {
  const passkeys = createSimpleWebAuthnPasskeys({});
  const device = authenticator();
  await expect(passkeys.register({ site, response: device.attest({ challenge: 'other' }), challenge: 'expected' })).rejects.toThrow(/challenge/i);
  await expect(passkeys.authenticate({ site, challenge: 'expected', response: device.assertWith({ challenge: 'other', counter: 1 }),
    credential: { ...scope, id: device.credId, publicKey: device.coseKey, counter: 0, rpId: site.rpId } })).rejects.toThrow(/challenge/i);
});

test('an assertion signed by a different key is not verified', async () => {
  const passkeys = createSimpleWebAuthnPasskeys({});
  const saved = authenticator();
  const impostor = authenticator();
  await expect(passkeys.authenticate({ site, challenge: 'c1', response: impostor.assertWith({ challenge: 'c1', counter: 2 }),
    credential: { ...scope, id: saved.credId, publicKey: saved.coseKey, counter: 0, rpId: site.rpId } })).rejects.toThrow('Passkey assertion was not verified');
});
