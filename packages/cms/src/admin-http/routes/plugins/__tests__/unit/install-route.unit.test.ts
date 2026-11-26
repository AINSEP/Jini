import { expect, it, vi } from 'vitest';
import { readZipUpload, zipPluginInstallRoute } from '../../install.js';

it('does not parse ZIP bytes before authorization', async () => {
  const parseZip = vi.fn(async () => undefined);
  await expect(zipPluginInstallRoute.handle({ raw: { params: {}, query: { expectedDigest: `sha256-${'a'.repeat(64)}` }, body: undefined }, authorize: async () => { throw new Error('denied'); }, context: { id: 'owner' }, deps: {
    installer: () => ({ preview: async () => { throw new Error('unexpected preview'); }, install: async () => { throw new Error('unexpected install'); } }), onInstalled: () => {},
    readZipUpload: () => readZipUpload({ deps: { isZip: () => true, parseZip, body: () => new Uint8Array(), isBuffer: (value): value is Uint8Array => value instanceof Uint8Array, uploadLimitText: 'limit' } }),
  } })).rejects.toThrow('denied');
  expect(parseZip).not.toHaveBeenCalled();
});
