import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createSiteKeySources, isSafeSiteKeyId, isSiteIdToken } from "../sources.js";

describe("configured site key sources", () => {
  it("preserves local and production order, blank env, blank file and legacy read-only status", () => {
    const reads = createSiteKeySources({ envName: "HOST_KEY", metadataFilename: ".meta.json", fields: { siteId: "siteId", siteKeyId: "siteKeyId", fingerprint: "fingerprint" },
      localSegments: [".host", "site-keys"], sharedSegments: [".host", "legacy.hex"], volumeSegments: ["sites", ".host", "key.hex"], legacyVolumeSegments: ["sites", ".host", "legacy.hex"],
      assertHomeIsolation: () => {}, fs: { existsSync: () => true, readFileSync: () => "" } });
    expect(reads.siteKeySources({ mode: "local", env: {}, home: "/home", cwd: "/work", siteKeyId: "id" })).toEqual([
      { kind: "per-site-file", path: "/home/.host/site-keys/id.hex" }, { kind: "env" }, { kind: "legacy-shared-file", path: "/home/.host/legacy.hex" },
    ]);
    expect(reads.siteKeySources({ mode: "production", env: {}, home: "/home", cwd: "/work" })).toEqual([
      { kind: "env" }, { kind: "volume-file", path: "/work/sites/.host/key.hex" }, { kind: "legacy-volume-file", path: "/work/sites/.host/legacy.hex" },
    ]);
    expect(reads.readSiteKeySourceMaterial({ source: { kind: "env" }, env: { HOST_KEY: " \n" } })).toBeUndefined();
    expect(reads.readSiteKeySourceMaterial({ source: { kind: "volume-file", path: "/key" }, env: {} })).toEqual({ raw: "" });
    expect(reads.siteKeyFilePathFrom({ sources: [{ kind: "legacy-shared-file", path: "/old" }] })).toBeUndefined();
  });

  it("never falls back from a present unsafe key ID to the site ID", () => {
    const reads = createSiteKeySources({ envName: "KEY", metadataFilename: ".meta.json", fields: { siteId: "id", siteKeyId: "keyId", fingerprint: "fingerprint" },
      localSegments: [], sharedSegments: [], volumeSegments: [], legacyVolumeSegments: [], assertHomeIsolation: () => {},
      fs: { existsSync: () => true, readFileSync: () => JSON.stringify({ keyId: "../bad", id: "safe" }) } });
    expect(reads.resolveSiteKeyId({ siteDir: "/site" })).toBeUndefined();
    expect(isSafeSiteKeyId({ id: "../bad" })).toBe(false);
    expect(isSafeSiteKeyId({ id: "safe-id" })).toBe(true);
    expect(isSiteIdToken({ value: "safe-id" })).toBe(true);
    expect(isSiteIdToken({ value: "bad\nvalue" })).toBe(false);
  });

  it("keeps both readers independent of the ensure writer", () => {
    for (const file of ["sources.ts", "ordered-keyring.ts"]) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      expect(source).not.toMatch(/(?:from\s*|import\s*\()["'][^"']*ensure(?:\.js)?["']/);
    }
  });
});

it('resolves local sources from configured metadata fields without reading an unrelated default file', () => {
  const metadata = '/site/custom.json';
  const reads: Array<[string, string]> = [];
  const paths = createSiteKeySources({ envName: 'HOST_KEY', metadataFilename: 'custom.json',
    fields: { siteId: 'identity', siteKeyId: 'keyIdentity', fingerprint: 'stamp' },
    localSegments: ['keys'], sharedSegments: ['legacy.hex'], volumeSegments: ['volume.hex'], legacyVolumeSegments: ['old.hex'],
    assertHomeIsolation: ({ homeDir }) => expect(homeDir).toBe('/home'),
    fs: { existsSync: () => { throw new Error('source resolution does not open keys'); }, readFileSync: (path, encoding) => {
      reads.push([path, encoding]);
      if (path !== metadata) throw new Error('unexpected metadata path');
      return '{"identity":"site-a","keyIdentity":"rotated","stamp":"e0e77a507412"}';
    } },
  });
  expect(paths.siteKeySourcesForSiteDir({ siteDir: '/site', mode: 'local', env: {}, home: '/home', cwd: '/work' })).toEqual([
    { kind: 'per-site-file', path: '/home/keys/rotated.hex' }, { kind: 'env' }, { kind: 'legacy-shared-file', path: '/home/legacy.hex' },
  ]);
  expect(paths.readSiteMetaId({ siteDir: '/site' })).toBe('site-a');
  expect(paths.resolveSiteKeyFingerprint({ siteDir: '/site' })).toBe('e0e77a507412');
  expect(paths.siteKeyEnvOnlySources()).toEqual([{ kind: 'env' }]);
  expect(reads).toEqual([[metadata, 'utf8'], [metadata, 'utf8'], [metadata, 'utf8']]);
});
