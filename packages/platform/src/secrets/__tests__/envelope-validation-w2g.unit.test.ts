import { expect, test } from 'vitest';
import { openWithPassphrase, sealWithPassphrase } from '../passphrase-envelope.js';

function envelope(_required = {}, _optional = {}) {
  return { header: { format: 'jini-passphrase-envelope', version: 1,
    kdf: { name: 'scrypt', salt: 'ab'.repeat(16), N: 32768, r: 8, p: 1 } },
    sealed: { alg: 'aes-256-gcm', keyId: 'v1', nonce: Buffer.alloc(12).toString('base64'), ciphertext: Buffer.alloc(16).toString('base64') } };
}

test.each([null, [], 4, 'ciphertext'])('refuses non-record sealed payload %j before decrypting', async sealed => {
  await expect(openWithPassphrase({ envelope: JSON.stringify({ ...envelope(), sealed }), passphrase: 'fixture' })).rejects.toThrow('invalid or unsupported envelope');
});

test('refuses a non-text salt and noncanonical base64 instead of accepting decoder normalization', async () => {
  const value = envelope();
  await expect(openWithPassphrase({ envelope: JSON.stringify({ ...value,
    header: { ...value.header, kdf: { ...value.header.kdf, salt: 123 } } }), passphrase: 'fixture' })).rejects.toThrow('invalid or unsupported envelope');
  await expect(openWithPassphrase({ envelope: JSON.stringify({ ...value,
    sealed: { ...value.sealed, nonce: value.sealed.nonce + '\n' } }), passphrase: 'fixture' })).rejects.toThrow('invalid or unsupported envelope');
});

test('runtime non-string input is refused by both seal and open boundaries', async () => {
  await expect(sealWithPassphrase({ payload: null as unknown as string, passphrase: 'fixture' })).rejects.toThrow('expected a string');
  await expect(openWithPassphrase({ envelope: null as unknown as string, passphrase: 'fixture' })).rejects.toThrow('expected a string');
  await expect(openWithPassphrase({ envelope: JSON.stringify(envelope()), passphrase: 123 as unknown as string })).rejects.toThrow('expected a string');
});
