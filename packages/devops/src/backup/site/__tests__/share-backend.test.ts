import { describe, it, expect, vi } from "vitest";
import { createSiteShareBackend, type SiteShareHost, type SiteShareRecord, type SiteShareContent, type SiteShareBackendRequired } from "../share-backend.js";
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

function backend(options: { rows?: SiteShareRecord[]; reveal?: (input: { sealedPassword: unknown; shareId: string; workspaceId: string }) => Promise<{ password: string }>; host?: Partial<SiteShareHost>; prepare?: () => Promise<SiteShareContent>; staticSite?: SiteShareBackendRequired["staticSite"]; delivery?: SiteShareBackendRequired["delivery"] } = {}) {
  const rows = options.rows ?? [row()];
  const registry = { get: async ({ site, shareId }: { site: string; shareId: string }) => rows.find(r => r.site === site && r.shareId === shareId) ?? null, list: async () => rows };
  return createSiteShareBackend({ registry, site: "site-a", zip: {}, delivery: options.delivery ?? (async () => undefined), ownerPrincipalId: Promise.resolve("owner"),
    ...(options.staticSite ? { staticSite: options.staticSite } : {}), prepare: options.prepare ?? (async () => content()), host: host(options.host),
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

const fixedTime = new Date("2026-11-09T11:00:00Z");
const captureContext: NonNullable<SiteShareBackendRequired["staticSite"]> = {
  now: () => fixedTime,
  context: async () => ({ name: "Gallery", slug: "gallery", theme: "Gallery A", themeId: "a" }),
  themes: () => [{ themeId: "a", title: "Gallery A" }, { themeId: "b", title: "Gallery B" }],
};

it("captures selected themes in order, accounts for shared media once, and returns the static-download instructions", async () => {
  const capture = vi.fn<SiteShareHost["captureStaticSite"]>(async (ports, { themeId, publicUrl }) => {
    const snapshot = await ports.context();
    if (snapshot.themeId !== themeId || ports.now() !== fixedTime || publicUrl !== "https://gallery.example") throw new Error("Lost capture context");
    return { filename: `theme-${themeId}.zip`, themeId, files: [
      { path: "index.html", content: Buffer.from(snapshot.theme) },
      { path: "m/photo/cover.webp", content: Buffer.from(themeId === "b" ? "first bytes" : "other bytes") },
    ], metadata: { exportedAt: fixedTime.toISOString(), theme: snapshot.theme, routes: ["/"], failed: { routes: [], assets: [] }, skipped: { routes: [], assets: [], references: [] } } };
  });
  const allocate = vi.fn<SiteShareHost["allocateStaticExportThemes"]>(({ themeIds }) => themeIds.map(id => ({ themeId: id, name: `theme-${id}` })));
  const limits: Array<Array<{ path: string; bytes: number }>> = [];
  const build = vi.fn<SiteShareHost["buildStaticSiteZip"]>(async () => Buffer.from("zip"));
  const create = vi.fn<SiteShareHost["createSiteShare"]>(async ({ site, name }, options) => row({
    shareId: "static-share", site, file: name, ...(options.notices ? { notices: options.notices } : {}),
  }));
  const b = backend({ staticSite: captureContext, host: {
    allocateStaticExportThemes: allocate, buildStaticSiteZip: build, captureStaticSite: capture, createSiteShare: create,
    checkShareLimits: ({ files }) => { limits.push(files.map(file => ({ ...file }))); },
    parseStaticExportInput: () => ({ themeIds: ["b", "a"], publicUrl: "https://gallery.example" }),
  } });

  expect(await b.staticOptions({})).toEqual({ activeThemeId: "a", themes: [{ themeId: "a", name: "Gallery A" }, { themeId: "b", name: "Gallery B" }] });
  const result = await b.create({ principalId: "owner", format: "static", signal: new AbortController().signal }, { waitMs: 5000 });
  expect(capture.mock.calls.map(([, options]) => options)).toEqual([
    { themeId: "b", publicUrl: "https://gallery.example" }, { themeId: "a", publicUrl: "https://gallery.example" },
  ]);
  expect(allocate.mock.calls).toEqual(Array(2).fill([{ themeIds: ["a", "b"], siteSlug: "gallery" }]));
  expect(limits.at(-1)).toEqual([
    { path: "index.html", bytes: 9 }, { path: "m/photo/cover.webp", bytes: 11 }, { path: "index.html", bytes: 9 },
  ]);
  const packaged = build.mock.calls[0]![0];
  expect(packaged.copy.themeId).toBe("b");
  expect(packaged.activeThemeId).toBe("a");
  expect(packaged.copies.map(copy => [copy.themeId, copy.files.find(file => file.path === "m/photo/cover.webp")?.content.toString()])).toEqual([
    ["b", "first bytes"], ["a", "first bytes"],
  ]);
  expect(create.mock.calls.map(([args]) => [args.site, args.name, args.archive.toString()])).toEqual([["site-a", "theme-b.zip", "zip"]]);
  expect(result).toMatchObject({
    downloadUrl: "/download/site-a/static-share",
    message: "No domain was given, so sitemap.xml and feed.xml were left out. Extract the ZIP, then open index.html inside the extracted folder in your browser; it lists every exported theme and page. No local server is needed to view the exported pages. README.txt lists features that need a server.",
  });
  expect(b.hasWork?.({})).toBe(false);
});

it("refuses unavailable, unknown and failed static captures before packaging and releases the export lane", async () => {
  const signal = new AbortController().signal;
  const args = { principalId: "owner", format: "static" as const, signal };
  await expect(backend().staticOptions({})).rejects.toMatchObject({ code: "UNAVAILABLE", message: "Static exporter is unavailable in this context." });
  await expect(backend().create(args, { waitMs: 5000 })).rejects.toMatchObject({ code: "UNAVAILABLE", message: "Static exporter is unavailable in this context." });
  const capture = vi.fn<SiteShareHost["captureStaticSite"]>(async () => ({ reason: "render down" }));
  const zip = vi.fn<SiteShareHost["buildStaticSiteZip"]>();
  let selected = ["retired"];
  const b = backend({ staticSite: captureContext, host: {
    captureStaticSite: capture, buildStaticSiteZip: zip, parseStaticExportInput: () => ({ themeIds: selected }),
  } });
  await expect(b.create(args, { waitMs: 5000 })).rejects.toMatchObject({ code: "INVALID_INPUT", message: "Every selected theme must be installed and valid." });
  expect(capture).not.toHaveBeenCalled();
  selected = ["b"];
  await expect(b.create(args, { waitMs: 5000 })).rejects.toMatchObject({ code: "UNAVAILABLE", message: "b: render down" });
  expect(capture.mock.calls.map(([, options]) => options)).toEqual([{ themeId: "b", publicUrl: undefined }]);
  expect(zip).not.toHaveBeenCalled();
  expect(b.hasWork?.({})).toBe(false);
});

it("uses only the unstyled site when the theme is off and only offers expiry for local storage", async () => {
  const local = { provider: "local-fs", binding: "/catalog" };
  const resolve = vi.fn<SiteShareBackendRequired["delivery"]>()
    .mockResolvedValueOnce(local).mockRejectedValueOnce(new Error("storage discovery failed")).mockResolvedValueOnce({ provider: "remote" });
  const listThemes = vi.fn(captureContext.themes!);
  const b = backend({ staticSite: { ...captureContext, context: async () => ({ name: "Gallery", slug: "gallery", theme: "No theme", themeId: "none" }), themes: listThemes },
    delivery: resolve, host: { isOwnShareFolder: ({ storage }) => storage.provider === "local-fs" && storage.binding === "/catalog" },
  });
  expect(await b.staticOptions({})).toEqual({ activeThemeId: "none", themes: [{ themeId: "none", name: "Current site" }] });
  expect(listThemes).not.toHaveBeenCalled();
  expect(await b.expiryChoices({})).toEqual([7, 30, 90]);
  expect(await b.expiryChoices({})).toEqual([]);
  expect(await b.expiryChoices({})).toEqual([]);
  expect(resolve.mock.calls).toEqual([[{}], [{}], [{}]]);
});

it("acknowledges through the saved binding and still delegates revoke when remote storage resolution throws", async () => {
  const storage = { provider: "remote", binding: "previous-bucket", key: "key" };
  const rows = [row({ shareId: "retained", storage, needsAcknowledgement: true, credentialWarnings: [] })];
  const resolvedStore = { kind: "fixture" };
  const resolve = vi.fn<SiteShareBackendRequired["delivery"]>()
    .mockResolvedValueOnce(resolvedStore).mockRejectedValueOnce(new Error("provider offline"));
  const acknowledge = vi.fn<SiteShareHost["acknowledgeSiteShare"]>(async ({ site, shareId }) => {
    const existing = rows.find(item => item.site === site && item.shareId === shareId)!;
    const acknowledged = { ...existing, needsAcknowledgement: false };
    rows.splice(rows.indexOf(existing), 1, acknowledged);
    return acknowledged;
  });
  const revoke = vi.fn<SiteShareHost["revokeSiteShare"]>(async () => ({ ...rows[0]!, status: "revoked" }));
  const b = backend({ rows, delivery: resolve, host: { acknowledgeSiteShare: acknowledge, revokeSiteShare: revoke, isOwnShareFolder: () => false } });

  expect(await b.acknowledge({ shareId: "retained" })).toMatchObject({ needsAcknowledgement: false, downloadUrl: "/download/site-a/retained" });
  expect((await b.list({})).find(item => item.shareId === "retained")?.needsAcknowledgement).toBe(false);
  expect(await b.revoke({ shareId: "retained" })).toMatchObject({ status: "revoked", downloadUrl: "/download/site-a/retained" });
  expect(resolve.mock.calls).toEqual(Array(2).fill([{ provider: "remote", binding: "previous-bucket" }]));
  const request = { registry: b.registry, site: "site-a", shareId: "retained" };
  expect(acknowledge.mock.calls).toEqual([[request, { delivery: resolvedStore }]]);
  expect(revoke.mock.calls).toEqual([[request, { delivery: undefined }]]);
});

it("reports in-flight progress, blocks concurrent work and resumes only for the job owner", async () => {
  let release!: (value: SiteShareContent) => void;
  const held = new Promise<SiteShareContent>(resolve => { release = resolve; });
  const prepare = vi.fn(() => held);
  const b = backend({ prepare });
  const args = { principalId: "owner", signal: new AbortController().signal };
  const progress = await b.create(args, { waitMs: 0 }) as { jobId: string; phase: string; progress: unknown };
  const { jobId } = progress;
  expect(progress).toEqual({ jobId: expect.stringMatching(/^[a-f\d-]{36}$/), phase: "preparing", progress: {
    filesDone: 0, filesTotal: 0, bytesDone: 0, bytesTotal: 0,
  } });
  expect(b.hasWork?.({})).toBe(true);
  try {
    await expect(b.create({ ...args, jobId, principalId: "other" }, { waitMs: 0 })).rejects.toMatchObject({
      code: "JOB_NOT_FOUND", message: "Share job expired or belongs to another principal. Create a new export.",
    });
    await expect(b.create(args, { waitMs: 0 })).rejects.toMatchObject({
      code: "BUSY", message: "Another share export is running for this site. Wait for it to finish.",
    });
    expect(await b.create({ ...args, jobId }, { waitMs: 0 })).toEqual(progress);
  } finally { release(content()); }
  expect(await b.create({ ...args, jobId }, { waitMs: 5000 })).toMatchObject({
    downloadUrl: "/download/site-a/share-new", message: "ZIP only.",
  });
  expect(prepare).toHaveBeenCalledOnce();
  expect(b.hasWork?.({})).toBe(false);
});
