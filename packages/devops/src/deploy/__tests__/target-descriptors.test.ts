import { describe, expect, it } from 'vitest';
import { asDeployTargetModule, parseDeployTargetsFile } from '../index.js';

const file = (targets: unknown) => JSON.stringify({ schemaVersion: 1, targets });

describe('parseDeployTargetsFile', () => {
  it('parses a target with config, env, credential, project-name copy and i18n', () => {
    const result = parseDeployTargetsFile({ raw: file([{
      id: 'static-host', label: 'Static host', module: 'targets/static-host.mjs',
      config: [{ name: 'bucket', label: 'Bucket', required: true, help: 'Where files go' }],
      projectName: { label: 'Site name' },
      env: { tokenVars: ['HOST_TOKEN'], fields: { accountId: 'HOST_ACCOUNT' } },
      credential: { vendorId: 'static-host', tokenPageUrl: 'https://host.example/tokens', fields: [{ name: 'token', label: 'Token', required: true, secret: true }, { name: 'accountId', label: 'Account', required: true }] },
      i18n: { es: { 'Static host': 'Alojamiento estático' } },
    }]) });
    expect(result).toEqual({ ok: true, descriptors: [{
      id: 'static-host', label: 'Static host', module: 'targets/static-host.mjs',
      configFields: [{ name: 'bucket', label: 'Bucket', required: true, help: 'Where files go' }],
      projectName: { label: 'Site name' },
      env: { tokenVars: ['HOST_TOKEN'], fields: { accountId: 'HOST_ACCOUNT' } },
      credential: { vendorId: 'static-host', tokenPageUrl: 'https://host.example/tokens', tokenField: 'token', fields: [{ name: 'token', label: 'Token', required: true, secret: true }, { name: 'accountId', label: 'Account', required: true }] },
      i18n: { es: { 'Static host': 'Alojamiento estático' } },
    }] });
  });

  it('refuses invalid JSON, a wrong schema, duplicates, secret config and a bad i18n block, naming the cause', () => {
    const entry = { id: 'a', label: 'A', module: 'a.mjs' };
    expect(parseDeployTargetsFile({ raw: '{' })).toEqual({ ok: false, reason: 'not valid JSON' });
    expect(parseDeployTargetsFile({ raw: JSON.stringify({ schemaVersion: 2, targets: [] }) })).toEqual({ ok: false, reason: 'schemaVersion must be 1' });
    expect(parseDeployTargetsFile({ raw: file([entry, entry]) })).toEqual({ ok: false, reason: "targets[1].id 'a' is declared twice" });
    expect(parseDeployTargetsFile({ raw: file([{ ...entry, module: '/abs/a.mjs' }]) })).toEqual({ ok: false, reason: 'targets[0].module must be a relative path ending in .mjs' });
    expect(parseDeployTargetsFile({ raw: file([{ ...entry, config: [{ name: 'key', label: 'Key', secret: true }] }]) }))
      .toEqual({ ok: false, reason: 'targets[0].config[0] is marked secret; config is passed in the clear, so declare it under credential.fields' });
    expect(parseDeployTargetsFile({ raw: file([{ ...entry, i18n: { 'NOT A LOCALE': {} } }]) })).toEqual({ ok: false, reason: "targets[0].i18n has an invalid locale 'NOT A LOCALE'" });
  });
});

describe('asDeployTargetModule', () => {
  it('accepts an export with create() and refuses anything else', () => {
    const module = { create: () => ({}) };
    expect(asDeployTargetModule({ exported: module })).toBe(module);
    expect(asDeployTargetModule({ exported: {} })).toBe('its module has no create() function');
    expect(asDeployTargetModule({ exported: [] })).toBe('its module has no create() function');
  });
});

describe('descriptor guidance validation', () => {
  const host = { id: 'host', label: 'Static host', module: 'host.mjs' };
  const credential = { vendorId: 'vendor', fields: [{ name: 'token', label: 'Token', required: true }] };

  it('refuses a malformed token link with the exact field path', () => {
    expect(parseDeployTargetsFile({ raw: file([{ ...host, credential: { ...credential, tokenPageUrl: 'https://' } }]) }))
      .toEqual({ ok: false, reason: 'targets[0].credential.tokenPageUrl must be an https URL' });
  });

  it('requires an explicit boolean opt-in for public account labels', () => {
    expect(parseDeployTargetsFile({ raw: file([{ ...host, credential: { ...credential, yieldsAccountLabel: 'true' } }]) }))
      .toEqual({ ok: false, reason: 'targets[0].credential.yieldsAccountLabel must be a boolean' });
    expect(parseDeployTargetsFile({ raw: file([{ ...host, credential: { ...credential, yieldsAccountLabel: true } }]) }))
      .toEqual({ ok: true, descriptors: [{ ...host, configFields: [], credential: { ...credential, tokenField: 'token', yieldsAccountLabel: true } }] });
  });

  it('rejects malformed help before projecting a credential form', () => {
    expect(parseDeployTargetsFile({ raw: file([{ ...host, credential: { ...credential, userHelp: 'x'.repeat(501) } }]) }))
      .toEqual({ ok: false, reason: 'targets[0].credential.userHelp must be a string of at most 500 characters' });
  });
});

it('rejects each malformed environment token list without accepting a valid neighbour', () => {
  const host = { id: 'host', label: 'Host', module: 'host.mjs' };
  for (const tokenVars of ['TOKEN', [], Array.from({ length: 17 }, (_, i) => `TOKEN_${i}`), ['FIRST_TOKEN', 'bad-token', 'LAST_TOKEN']]) {
    expect(parseDeployTargetsFile({ raw: file([{ ...host, env: { tokenVars } }]) }))
      .toEqual({ ok: false, reason: 'targets[0].env.tokenVars must be a non-empty array of env var names' });
  }
});

it('rejects invalid environment field names and values independently', () => {
  const host = { id: 'host', label: 'Host', module: 'host.mjs' };
  for (const fields of [[], { 'bad-name': 'HOST_ACCOUNT' }, { account: 'bad-env' }, Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`field${i}`, `VAR_${i}`]))]) {
    expect(parseDeployTargetsFile({ raw: file([{ ...host, env: { tokenVars: ['HOST_TOKEN'], fields } }]) }))
      .toEqual({ ok: false, reason: 'targets[0].env.fields must map field names to env var names' });
  }
});
