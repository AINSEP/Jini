import { expect, it, vi } from 'vitest';
import { bindSiteKeyrings } from '../ordered-keyring.js';
import { FixedRootKeyKeyring, UnusableRootKeyError, RootKeyFileAlreadyExistsError, parseRootKeyHex, fingerprintRootKeyHex } from '../../keyring.env.js';

function fixture() {
  const env: Record<string, string | undefined> = { KEY: 'aa'.repeat(32) };
  const reads: string[] = [];
  const order: string[] = [];
  const writer = vi.fn(({ keyFilePath }: { keyFilePath: string }) => { order.push('write'); return { keyFilePath, hex: env.KEY!, fingerprint: fingerprintRootKeyHex({ hex: env.KEY! }) }; });
  const required: Parameters<typeof bindSiteKeyrings>[0] = {
    env: () => ({ ...env }), hkdfSalt: 'fixed-host-salt', defaultKeyId: 'v1',
    readSourceMaterial: ({ source, env }) => { reads.push(source.kind); return source.kind === 'env' ? env.KEY === undefined ? undefined : { raw: env.KEY, envVarName: 'KEY' } : { raw: 'bb'.repeat(32) }; },
    siteKeyFilePathFrom: () => '/key.hex', describeSource: source => source.kind === 'env' ? 'env var KEY' : 'the site key file at ' + source.path,
    FixedSiteKeyKeyring: FixedRootKeyKeyring, InMemoryKeyring: class InMemoryKeyring extends FixedRootKeyKeyring {
      constructor(required: { hkdfSalt: string | Uint8Array }, optional: { keyId?: string } = {}) { super({ hex: 'aa'.repeat(32), ...required }, optional); }
    }, UnusableSiteKeyError: UnusableRootKeyError, SiteKeyFileAlreadyExistsError: RootKeyFileAlreadyExistsError,
    parseSiteKeyHex: parseRootKeyHex, fingerprintSiteKeyHex: fingerprintRootKeyHex,
    generateFileSiteKey: writer, prepareDirectory: () => { order.push('directory'); },
    copy: { envVarName: 'KEY', fileWarningSubject: 'this file', envWarningSubject: 'this value',
      rejectionDetail: { empty: () => 'empty', 'not-hex': () => 'not hex', 'odd-length': ({ hexDigits }) => 'odd ' + hexDigits, 'too-short': ({ hexDigits }) => 'short ' + hexDigits },
      refusal: ({ subject, detail }) => subject + ': ' + detail, sealedWarning: ({ subject }) => ' sealed with ' + subject,
      alreadyExists: ({ keyFilePath }) => 'exists: ' + keyFilePath, rootRefusal: 'The keyring refuses', siteRefusal: 'Site refuses',
    },
  };
  const bound = bindSiteKeyrings(required);
  return { bound, required, env, reads, order, writer };
}

it('refuses first-present invalid material, never reads the lower-priority file and refreshes env', async () => {
  const f = fixture(); const sources = [{ kind: 'env' }, { kind: 'file', path: '/key.hex' }];
  const ring = new f.bound.EnvOrFileKeyring({ sources });
  expect(await ring.activeKey({})).toEqual({ keyId: 'v1' }); expect(f.reads).toEqual([]);
  const input = { workspaceId: 'ws', purpose: 'vault', info: 'v1' };
  const first = await ring.derive(input);
  f.env.KEY = 'invalid';
  await expect(ring.derive(input)).rejects.toBeInstanceOf(f.bound.UnusableSiteKeyError);
  expect(f.reads).toEqual(['env', 'env']);
  f.env.KEY = 'bb'.repeat(32);
  expect(await ring.derive(input)).not.toEqual(first);
  expect(f.bound.EnvOrFileKeyring.name).toBe('EnvOrFileKeyring');
});

it('derives byte-identical signing and purpose secrets through all three configured constructors', async () => {
  const f = fixture();
  const memory = new f.bound.InMemoryKeyring();
  expect(memory.constructor.name).toBe('InMemoryKeyring');
  const fixed = new f.bound.FixedSiteKeyKeyring({ hex: f.env.KEY! });
  const ordered = new f.bound.EnvOrFileKeyring({ sources: [{ kind: 'env' }] });
  const base = new FixedRootKeyKeyring({ hex: f.env.KEY!, hkdfSalt: 'fixed-host-salt' });
  const signing = { workspaceId: 'ws', subscriptionId: 'sub', version: 2 };
  const input = { workspaceId: 'ws', purpose: 'vault', info: 'v1' };
  expect(await memory.deriveSigningSecret(signing)).toEqual(await base.deriveSigningSecret(signing));
  expect(await memory.derive(input)).toEqual(await base.derive(input));
  expect(await fixed.deriveSigningSecret(signing)).toEqual(await base.deriveSigningSecret(signing));
  expect(await ordered.deriveSigningSecret(signing)).toEqual(await fixed.deriveSigningSecret(signing));
  expect(await ordered.derive(input)).toEqual(await fixed.derive(input));
});

it('preserves status and reveal field order and reader override signatures', () => {
  const f = fixture(); const options = { sources: [{ kind: 'env' }] };
  const status = f.bound.inspectSiteKeyMaterial(options);
  expect(Object.keys(status)).toEqual(['active', 'source', 'fingerprint', 'keyFilePath', 'envVarName']);
  const reveal = f.bound.revealSiteKeyMaterial(options);
  expect(Object.keys(reveal)).toEqual(['active', 'source', 'hex', 'fingerprint', 'keyFilePath', 'envVarName']);
  expect(reveal.hex).toBe(f.env.KEY);
  expect(f.bound.inspectSiteKeyMaterial(options, { env: () => ({ KEY: '' }) })).toEqual({ active: false, source: 'env', invalid: true, reason: 'empty', keyFilePath: '/key.hex', envVarName: 'KEY' });
});

it('prepares directories before the real writer, maps typed/raw collisions and propagates impostors', () => {
  const f = fixture();
  f.bound.generateFileSiteKey({ keyFilePath: '/key.hex' });
  expect(f.order).toEqual(['directory', 'write']);
  for (const error of [new RootKeyFileAlreadyExistsError({ keyFilePath: '/key.hex' }), { code: 'EEXIST' }, { code: 'ELOOP' }]) {
    f.writer.mockImplementationOnce(() => { throw error; });
    expect(() => f.bound.generateFileSiteKey({ keyFilePath: '/key.hex' })).toThrow(f.bound.SiteKeyFileAlreadyExistsError);
  }
  const impostor = Object.assign(new Error('impostor'), { name: 'RootKeyFileAlreadyExistsError' });
  f.writer.mockImplementationOnce(() => { throw impostor; });
  expect(() => f.bound.generateFileSiteKey({ keyFilePath: '/key.hex' })).toThrow(impostor);
});

it('translates only the real underlying unusable-key identity', async () => {
  const f = fixture();
  const error = new UnusableRootKeyError({ source: 'env', reason: 'too-short', message: 'The keyring refuses this material' });
  const impostor = Object.assign(new Error('impostor'), { name: error.name });
  for (const failure of [error, impostor]) {
    const FixedSiteKeyKeyring = new Proxy(FixedRootKeyKeyring, { construct: () => { throw failure; } });
    const bound = bindSiteKeyrings({ ...f.required, FixedSiteKeyKeyring });
    const deriving = new bound.EnvOrFileKeyring({ sources: [{ kind: 'env' }] }).derive({ workspaceId: 'ws', purpose: 'vault', info: 'v1' });
    if (failure === error) await expect(deriving).rejects.toMatchObject({ name: 'UnusableSiteKeyError', message: 'Site refuses this material' });
    else await expect(deriving).rejects.toBe(impostor);
  }
});
