import { describe, expect, it } from 'vitest';
import { asDeployOpsModule, parseDeployOpsFile } from '../index.js';

const file = (platforms: unknown) => JSON.stringify({ schemaVersion: 1, platforms });
const entry = { id: 'app-host', label: 'App host', module: 'ops/app-host.mjs', hosts: ['api.host.example'] };

describe('parseDeployOpsFile', () => {
  it('keeps only the declared descriptor fields', () => {
    expect(parseDeployOpsFile({ raw: file([{ ...entry, extra: true }]) })).toEqual({ ok: true, descriptors: [entry] });
  });

  it('refuses escaping modules, bad hosts, duplicates and oversized manifests', () => {
    expect(parseDeployOpsFile({ raw: 'nope' })).toEqual({ ok: false, reason: 'not valid JSON' });
    expect(parseDeployOpsFile({ raw: file([{ ...entry, module: 'ops/../x.mjs' }]) })).toEqual({ ok: false, reason: 'platforms[0].module must be a contained relative .mjs path' });
    expect(parseDeployOpsFile({ raw: file([{ ...entry, hosts: ['http://x'] }]) })).toEqual({ ok: false, reason: 'platforms[0].hosts must be a non-empty array of HTTPS hostnames' });
    expect(parseDeployOpsFile({ raw: file([entry, entry]) })).toEqual({ ok: false, reason: "platforms[1].id 'app-host' is declared twice" });
    expect(parseDeployOpsFile({ raw: file(Array.from({ length: 33 }, () => entry)) })).toEqual({ ok: false, reason: 'platforms must be an array of at most 32 entries' });
  });
});

describe('asDeployOpsModule', () => {
  const base = { status: async () => ({}), logs: async () => ({}) };
  const secrets = { listSecrets: async () => ({}), setSecret: async () => ({}), unsetSecret: async () => ({}) };

  it('accepts status/logs, and a complete secrets adapter with its capabilities', () => {
    expect(asDeployOpsModule({ exported: base })).toBe(base);
    const full = { ...base, ...secrets, secretCapabilities: { appliesOn: 'next-deploy', supportsStaging: true } };
    expect(asDeployOpsModule({ exported: full })).toBe(full);
  });

  it('refuses a missing verb, a half secrets adapter and missing capabilities', () => {
    expect(asDeployOpsModule({ exported: { status: base.status } })).toBe('module must export status() and logs()');
    expect(asDeployOpsModule({ exported: { ...base, deploy: 'x' } })).toBe('module must export status() and logs()');
    expect(asDeployOpsModule({ exported: { ...base, listSecrets: secrets.listSecrets } })).toBe('a secrets adapter must export listSecrets(), setSecret() and unsetSecret() together');
    expect(asDeployOpsModule({ exported: { ...base, ...secrets } })).toBe('secretCapabilities must declare appliesOn and supportsStaging');
    expect(asDeployOpsModule({ exported: { ...base, readSecret: async () => ({}) } })).toBe('secretCapabilities and readSecret need listSecrets(), setSecret() and unsetSecret()');
  });
});
