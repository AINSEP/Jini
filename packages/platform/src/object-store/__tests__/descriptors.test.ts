import { describe, expect, it } from 'vitest';
import { parseObjectStoresFile } from '../index.js';

const file = (providers: unknown) => JSON.stringify({ schemaVersion: 1, providers });
const env = { selector: 's3', settings: { bucket: 'S3_BUCKET' }, credentialFields: { accessKeyId: 'S3_KEY' }, secret: 'S3_SECRET', required: ['S3_BUCKET'] };

describe('parseObjectStoresFile', () => {
  it('keeps id, module, label and env, dropping unknown keys', () => {
    expect(parseObjectStoresFile({ raw: file([{ id: 'blob', module: 'blob.mjs', label: 'Blob', env, extra: true }]) }))
      .toEqual({ ok: true, descriptors: [{ id: 'blob', module: 'blob.mjs', label: 'Blob', env }] });
  });

  it('refuses bad JSON, modules, labels, env declarations and duplicates', () => {
    expect(parseObjectStoresFile({ raw: 'x' })).toEqual({ ok: false, reason: 'not valid JSON' });
    expect(parseObjectStoresFile({ raw: file({}) })).toEqual({ ok: false, reason: 'providers must be an array' });
    expect(parseObjectStoresFile({ raw: file([{ id: 'a', module: '/a.mjs' }]) })).toEqual({ ok: false, reason: 'providers[0].module must be a relative path ending in .mjs' });
    expect(parseObjectStoresFile({ raw: file([{ id: 'a', module: 'a.mjs', label: ' ' }]) })).toEqual({ ok: false, reason: 'providers[0].label must be a non-empty string of at most 100 characters' });
    expect(parseObjectStoresFile({ raw: file([{ id: 'a', module: 'a.mjs', env: { ...env, selector: 'local' } }]) })).toEqual({ ok: false, reason: 'providers[0].env must declare a selector, env maps, secret and ordered required variables' });
    expect(parseObjectStoresFile({ raw: file([{ id: 'a', module: 'a.mjs' }, { id: 'a', module: 'b.mjs' }]) })).toEqual({ ok: false, reason: "providers[1].id 'a' is declared twice" });
  });
});
