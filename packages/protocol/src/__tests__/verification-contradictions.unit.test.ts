import { expect, it } from 'vitest';
import { ResolvedRegistryEntrySchema } from '../registry.js';

const resolved = { backendId: 'fixture', backendKind: 'local', trust: 'official',
  entry: { name: 'vendor/example', version: '1.0.0', source: 'github:vendor/example' },
  version: { version: '1.0.0', source: 'github:vendor/example' }, source: 'github:vendor/example' };

it.each([false, undefined])('rejects verification metadata when verified is %s', verified => {
  for (const metadata of [{ verifiedIssuer: 'issuer' }, { verifiedSubject: 'subject' }, { verifiedIssuer: '', verifiedSubject: '' }]) {
    expect(ResolvedRegistryEntrySchema.safeParse({ ...resolved, verified, ...metadata }).success).toBe(false);
  }
  expect(ResolvedRegistryEntrySchema.parse({ ...resolved, verified }).verified).toBe(false);
});

it('preserves verified identities and the independently configured trust level', () => {
  expect(ResolvedRegistryEntrySchema.parse({ ...resolved, verified: true, verifiedIssuer: 'issuer', verifiedSubject: 'subject' }))
    .toMatchObject({ verified: true, verifiedIssuer: 'issuer', verifiedSubject: 'subject', trust: 'official' });
});
