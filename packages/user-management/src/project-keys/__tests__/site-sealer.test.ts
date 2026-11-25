import { expect, it, vi } from 'vitest';
import type { KeyringPort, SecretSealerPort } from '@jini-ai/core/contracts/vault';
import { ownerKeyHandleOnly, siteGrantedSealer } from '../site-sealer.js';

it('revocation during open withholds plaintext', async () => {
  const allowed = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  const sealer: SecretSealerPort = { seal: vi.fn(), open: vi.fn().mockResolvedValue('secret') };
  const fenced = siteGrantedSealer({ allowed, sealer, ownerScope: { workspaceId: 'project', ownerKey: 'owner', kinds: ['custom'] }, accessRefusedMessage: 'refused' });
  const input = { sealed: { keyId: 'key', ciphertext: 'cipher', nonce: 'nonce', alg: 'alg' } };
  const options = { aad: 'secrets-vault:v1:["project","id","custom","owner",null,null]' };
  await expect(fenced.open(input, options)).rejects.toThrow('refused');
  expect(sealer.open).toHaveBeenCalledWith(input, options);
  expect(allowed).toHaveBeenCalledTimes(2);
});

it('wrong scope and non-null tails never reach open', async () => {
  const allowed = vi.fn().mockResolvedValue(true);
  const sealer: SecretSealerPort = { seal: vi.fn(), open: vi.fn() };
  const fenced = siteGrantedSealer({ allowed, sealer, ownerScope: { workspaceId: 'project', ownerKey: 'owner', kinds: ['custom'] }, accessRefusedMessage: 'refused' });
  for (const identity of [
    ['other', 'id', 'custom', 'owner', null, null], ['project', 'id', 'custom', 'other', null, null],
    ['project', 'id', 'vendor', 'owner', null, null], ['project', 'id', 'custom', 'owner', 'principal', null],
    ['project', 'id', 'custom', 'owner', null, 'binding'],
  ]) {
    await expect(fenced.open({ sealed: { keyId: 'key', ciphertext: '', nonce: '', alg: '' } }, { aad: `secrets-vault:v1:${JSON.stringify(identity)}` })).rejects.toThrow('refused');
  }
  expect(sealer.open).not.toHaveBeenCalled();
  expect(allowed).not.toHaveBeenCalled();
});

it('forwards the active handle and never calls derivation', async () => {
  const handle = { keyId: 'key' };
  const keyring: KeyringPort = { activeKey: vi.fn().mockResolvedValue(handle), derive: vi.fn(), deriveSigningSecret: vi.fn() };
  const narrowed = ownerKeyHandleOnly({ keyring, derivationRefusedMessage: 'private' });
  const input = {};
  expect(await narrowed.activeKey(input)).toBe(handle);
  expect(keyring.activeKey).toHaveBeenCalledWith(input);
  await expect(narrowed.derive({ workspaceId: 'project', purpose: 'x', info: 'x' })).rejects.toThrow('private');
  await expect(narrowed.deriveSigningSecret({ workspaceId: 'project', subscriptionId: 'x', version: 1 })).rejects.toThrow('private');
  expect(keyring.derive).not.toHaveBeenCalled();
  expect(keyring.deriveSigningSecret).not.toHaveBeenCalled();
});
