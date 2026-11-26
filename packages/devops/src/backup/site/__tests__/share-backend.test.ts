import { describe, it, expect } from "vitest";
import { createSiteShareBackend, type SiteShareHost, type SiteShareRecord, type SiteShareContent } from "../share-backend.js";
import { SiteShareRefusal } from "../share-refusal.js";
import { SiteShareExportFailure } from "../share-export-failure.js";

const SEALED = { keyId: "k1", ciphertext: "c2VhbGVk", iv: "aXY=", alg: "aes-256-gcm" } as unknown as NonNullable<SiteShareRecord["sealedPassword"]>;
const row = (overrides: Partial<SiteShareRecord> = {}): SiteShareRecord => ({ shareId: "share-1", token: "TOKENTOKENTOKENA", site: "site-a", file: "site.zip", bytes: 3, sha256: "a".repeat(64), url: null,
  status: "active", createdAt: "2026-01-01T00:00:00Z", revokedAt: null, hasEncryptedKeys: true, sealedPassword: SEALED, ...overrides });
/** A neutral expiry policy: the host's day choices, wording and expired-link message. */
const EXPIRY = { choices: [7, 30, 90], copy: { choices: "7, 30 or 90 days, or never.", notHostedHere: "Only own-folder links can expire.", remote: ({ provider }: { provider: string }) => `${provider} links cannot expire.` },
  expiredMessage: ({ row }: { row: { expiresAt?: string | null | undefined } }) => `Expired ${row.expiresAt ?? "?"}.` } as const;
const unused = (): never => { throw new Error("unused host collaborator"); };

function host(overrides: Partial<SiteShareHost> = {}): SiteShareHost {
  return { redact: ({ text }) => ({ text: text.replaceAll("SECRET-VALUE", "[REDACTED]") }), isClosedFailure: () => false, noThemeId: "none",
    zipOnlyMessage: "ZIP only.", downloadUrl: ({ site, shareId }) => `/download/${site}/${shareId}`, appVersionOf: () => "1.2.3",
    checkShareLimits: () => undefined, newShareIdentity: () => ({ shareId: "share-new", token: "TOKENTOKENTOKENB" }), allocateStaticExportThemes: () => [],
    parseStaticExportInput: () => ({}), captureStaticSite: unused, buildShareZip: async () => Buffer.from("zip"), buildStaticSiteZip: unused,
    createSiteShare: async ({ site }) => { const { sealedPassword: _sealed, ...plain } = row({ shareId: "share-new", site, hasEncryptedKeys: false }); return plain; },
    acknowledgeSiteShare: unused, revokeSiteShare: unused, isOwnShareFolder: () => true, ownFolderProvider: "local-fs", expiry: EXPIRY, ...overrides };
}

function content(overrides: Partial<SiteShareContent> = {}): SiteShareContent {
  return { files: [], bufferedFiles: [{ path: "settings.json" }], scopeNotes: {}, totalBytes: 2, site: { folderName: "site-a" }, ...overrides };
}

function backend(options: { rows?: SiteShareRecord[]; reveal?: (input: { sealedPassword: unknown; shareId: string; workspaceId: string }) => Promise<{ password: string }>; host?: Partial<SiteShareHost>; prepare?: () => Promise<SiteShareContent> } = {}) {
  const rows = options.rows ?? [row()];
  const registry = { get: async ({ site, shareId }: { site: string; shareId: string }) => rows.find(r => r.site === site && r.shareId === shareId) ?? null, list: async () => rows };
  return createSiteShareBackend({ registry, site: "site-a", zip: {}, delivery: async () => undefined, ownerPrincipalId: Promise.resolve("owner"),
    prepare: options.prepare ?? (async () => content()), host: host(options.host),
    ...(options.reveal ? { savedKeys: { reveal: options.reveal as never } } : {}) });
}
const code = (expected: string) => (error: unknown) => error instanceof SiteShareRefusal && error.code === expected;

describe("share backend password reveal", () => {
  it("opens the row's sealed password for the owner, bound to the share identity", async () => {
    const seen: unknown[] = [];
    const b = backend({ reveal: async input => { seen.push(input); return { password: "pw" }; } });
    await expect(b.revealPassword({ principalId: "owner", shareId: "share-1" })).resolves.toEqual({ password: "pw" });
    expect(seen).toEqual([{ sealedPassword: SEALED, shareId: "share-1", workspaceId: "site-a" }]);
  });
  it("refuses a non-owner FORBIDDEN without opening anything", async () => {
    let opened = 0;
    const b = backend({ reveal: async () => { opened++; return { password: "pw" }; } });
    await expect(b.revealPassword({ principalId: "someone-else", shareId: "share-1" })).rejects.toSatisfy(code("FORBIDDEN"));
    expect(opened).toBe(0);
  });
  it("treats revoked, keyless and unknown rows as NOT_FOUND", async () => {
    const b = backend({ rows: [row({ shareId: "revoked", status: "revoked" }), row({ shareId: "keyless", hasEncryptedKeys: false })], reveal: async () => ({ password: "pw" }) });
    for (const shareId of ["revoked", "keyless", "missing"]) await expect(b.revealPassword({ principalId: "owner", shareId })).rejects.toSatisfy(code("NOT_FOUND"));
  });
  it("refuses an ended share EXPIRED (tombstoned, or past its expiresAt before the sweep) without opening anything", async () => {
    let opened = 0;
    const b = backend({ rows: [row({ shareId: "tombstoned", status: "expired", expiresAt: "2999-01-01T00:00:00Z" }), row({ shareId: "lapsed", expiresAt: "2000-01-01T00:00:00Z" }), row({ shareId: "current", expiresAt: "2999-01-01T00:00:00Z" })],
      reveal: async () => { opened++; return { password: "pw" }; } });
    for (const shareId of ["tombstoned", "lapsed"]) await expect(b.revealPassword({ principalId: "owner", shareId })).rejects.toSatisfy(code("EXPIRED"));
    expect(opened).toBe(0);
    await expect(b.revealPassword({ principalId: "owner", shareId: "current" })).resolves.toEqual({ password: "pw" });
  });
  it("is UNAVAILABLE when no saved-keys port is wired", async () => {
    await expect(backend().revealPassword({ principalId: "owner", shareId: "share-1" })).rejects.toSatisfy(code("UNAVAILABLE"));
  });
});

describe("share backend host injection", () => {
  it("redacts scope notes through the injected redactor and returns them to the exporter", async () => {
    const b = backend({ prepare: async () => content({ scopeNotes: { extension: "left out: SECRET-VALUE" } }) });
    const result = await b.create({ principalId: "owner", signal: new AbortController().signal }, { waitMs: 5000 }) as { notes?: string[]; message?: string; downloadUrl: string };
    expect(result.notes).toEqual(["left out: [REDACTED]"]);
    expect(result.message).toBe("ZIP only.");
    expect(result.downloadUrl).toBe("/download/site-a/share-new");
  });
  it("lists views with the host download URL and never the token, storage or sealed password", async () => {
    const [listed] = await backend().list({});
    expect(listed).toMatchObject({ shareId: "share-1", downloadUrl: "/download/site-a/share-1", credentialWarnings: [], needsAcknowledgement: false });
    expect(Object.keys(listed!)).not.toEqual(expect.arrayContaining(["token"]));
    expect(JSON.stringify(listed)).not.toContain(SEALED.ciphertext);
  });
  it("passes a host closed failure through unwrapped and wraps any other failure with the injected app version", async () => {
    class ClosedFailure extends Error {}
    const closed = backend({ prepare: async () => { throw new ClosedFailure("disk full"); }, host: { isClosedFailure: ({ cause }) => cause instanceof ClosedFailure } });
    await expect(closed.create({ principalId: "owner", signal: new AbortController().signal }, { waitMs: 5000 })).rejects.toBeInstanceOf(ClosedFailure);
    const open = backend({ host: { buildShareZip: async () => { throw new Error("zip broke"); } } });
    await expect(open.create({ principalId: "owner", signal: new AbortController().signal }, { waitMs: 5000 })).rejects.toSatisfy((error: unknown) =>
      error instanceof SiteShareExportFailure && (error as SiteShareExportFailure & { step: string; appVersion?: string }).step === "archive" && (error as { appVersion?: string }).appVersion === "1.2.3");
  });
});
