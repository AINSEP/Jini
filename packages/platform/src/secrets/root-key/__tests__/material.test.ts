import { expect, it, vi } from "vitest";
import { findFirstPresentMaterial, inspectSiteKeyMaterial, readSiteMetaId, revealSiteKeyMaterial } from "../material.js";

it("an invalid first-present key stops source inspection before a later valid key", () => {
  const readSiteKeySourceMaterial = vi.fn(({ source }: { source: { kind: string } }) => ({ raw: source.kind === "env" ? "invalid" : "aa".repeat(32), envVarName: "HOST_KEY" }));
  const required = { sources: [{ kind: "env" }, { kind: "file", path: "/key" }], env: () => ({}), readSiteKeySourceMaterial, siteKeyFilePathFrom: () => "/key" };
  expect(inspectSiteKeyMaterial(required)).toEqual({ active: false, source: "env", invalid: true, reason: "not-hex", keyFilePath: "/key", envVarName: "HOST_KEY" });
  expect(revealSiteKeyMaterial(required)).toEqual({ active: false, source: "env", invalid: true, reason: "not-hex", keyFilePath: "/key", envVarName: "HOST_KEY" });
  expect(readSiteKeySourceMaterial.mock.calls.map(([input]) => input.source.kind)).toEqual(["env", "env"]);
});

it('first-present lookups skip misses but stop on an empty file rather than another valid key', () => {
  const sources = [{ kind: 'env' }, { kind: 'file', path: '/empty' }, { kind: 'legacy-file', path: '/legacy' }];
  const env = { HOST_KEY: '' };
  const readRawSiteKeyMaterial = vi.fn((source: { kind: string }, _env: Record<string, string | undefined>) => {
    if (source.kind === 'env') return undefined;
    if (source.kind === 'file') return '';
    throw new Error('Lower-priority material must not be read');
  });
  expect(findFirstPresentMaterial({ sources, env, readRawSiteKeyMaterial })).toBe('');
  expect(readRawSiteKeyMaterial.mock.calls).toEqual([[sources[0], env], [sources[1], env]]);
  expect(findFirstPresentMaterial({ sources: [sources[0]!], env, readRawSiteKeyMaterial })).toBeUndefined();
});

it('reports an absent source, and a later valid source reveals only trimmed key material', () => {
  const keyFilePath = '/keys/project.hex';
  const source = { kind: 'file', path: keyFilePath };
  let raw: string | undefined;
  const required = {
    sources: [source], env: () => ({}),
    readSiteKeySourceMaterial: () => raw === undefined ? undefined : { raw },
    siteKeyFilePathFrom: () => keyFilePath,
  };
  expect(inspectSiteKeyMaterial(required)).toEqual({ active: false, source: 'none', keyFilePath });
  raw = ' ' + 'aa'.repeat(32) + '\n';
  expect(inspectSiteKeyMaterial(required)).toEqual({ active: true, source: 'file', fingerprint: 'e0e77a507412', keyFilePath });
  expect(revealSiteKeyMaterial(required)).toEqual({ active: true, source: 'file', fingerprint: 'e0e77a507412', keyFilePath, hex: 'aa'.repeat(32) });
});

it.each([
  { meta: { id: 'site', keyId: 'key' }, id: 'site' },
  { meta: { id: '', keyId: 'key' }, id: 'key' },
  { meta: { id: 4, keyId: 'key' }, id: 'key' },
  { meta: { id: '', keyId: 4 }, id: undefined },
  { meta: undefined, id: undefined },
])('takes a nonempty site ID before the first-boot key ID (%j)', ({ meta, id }) => {
  const readSiteMetaJson = vi.fn(() => meta);
  expect(readSiteMetaId({ siteDir: '/site', readSiteMetaJson, idField: 'id', fallbackIdField: 'keyId' })).toBe(id);
  expect(readSiteMetaJson).toHaveBeenCalledExactlyOnceWith({ siteDir: '/site' });
});
