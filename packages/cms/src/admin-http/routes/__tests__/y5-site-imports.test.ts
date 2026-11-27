import type { SiteImportView } from "@jini-ai/core/contracts/site/site-import-history";
import { describe, expect, it, vi } from "vitest";
import { createSiteImportUploadLane, registerSiteImportRoutes } from "../system/site-imports.js";

class Refusal extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

class HistoryUnavailable extends Error {
  readonly code = "HISTORY_OFFLINE";
  readonly status = 503;
}

function fixture() {
  const mounted = new Map<string, Parameters<Parameters<typeof registerSiteImportRoutes>[0]["mount"]>[0]["handle"]>();
  const backend = { get: vi.fn(), upload: vi.fn(), completeOwner: vi.fn(), importBackup: vi.fn(), listPage: vi.fn() };
  const backendBinding = vi.fn((): typeof backend | undefined => backend);
  const mapHistoryError = vi.fn((_error: unknown) => {});
  const deadlineHandle = { unref: vi.fn() };
  const deadline = vi.fn().mockReturnValue(deadlineHandle);
  const cancelDeadline = vi.fn();
  const config: Parameters<typeof registerSiteImportRoutes>[0] = { workspaceId: "ws", mount: ({ method, path, handle }: Parameters<Parameters<typeof registerSiteImportRoutes>[0]["mount"]>[0]) => { mounted.set(`${method} ${path}`, handle); }, backend: backendBinding,
    parseInput: vi.fn<Parameters<typeof registerSiteImportRoutes>[0]["parseInput"]>(), refusal: ({ code, message }) => new Refusal(code, message),
    mapHistoryError, historyUnavailable: HistoryUnavailable, failureCollaborators: { asRefusal: ({ error }) => error instanceof Refusal ? error : undefined, formatByteSize: ({ bytes }: { bytes: number }) => String(bytes) },
    steps: { list: "history", import: "import", upload: "upload", ownerGet: "read owner", ownerPost: "write owner" }, ownerSessionMessage: "session required", originRefusalMessage: "same origin required", maxArchiveBytes: 1024,
    uploadDeadlineMs: 120000, uploadIdleMs: 30000, setTimeout: deadline as unknown as typeof setTimeout, clearTimeout: cancelDeadline,
  };
  registerSiteImportRoutes(config);
  const request = { workspaceId: () => "ws", principalId: () => "owner", authorize: vi.fn(async () => false), requireSession: vi.fn(() => false),
    noStore: vi.fn(), json: vi.fn(), failure: vi.fn<(error: unknown, options: unknown) => void>(), body: vi.fn(), query: vi.fn(() => ({})), importId: vi.fn(() => "import"), origin: vi.fn(() => "https://host"), protocol: () => "https", host: () => "host",
    parseZip: vi.fn(async () => {}), parseForm: vi.fn(async () => {}), isBuffer: Buffer.isBuffer,
    onClose: vi.fn(), onAborted: vi.fn(), writableEnded: () => false, destroy: vi.fn(), setIdleTimeout: vi.fn(),
  };
  return { mounted, request, backend, backendBinding, parseInput: vi.mocked(config.parseInput), mapHistoryError, deadline, deadlineHandle, cancelDeadline };
}

describe("site import admission and lifetime", () => {
  it("releases an interrupted upload on close so the next authorized request can acquire the lane", () => {
    const setDeadline = vi.fn().mockReturnValue({ unref: vi.fn() });
    const clearDeadline = vi.fn();
    const lane = createSiteImportUploadLane({ uploadDeadlineMs: 120000, uploadIdleMs: 30000, setTimeout: setDeadline as unknown as typeof setTimeout, clearTimeout: clearDeadline });
    let close!: () => void;
    const first = { json: vi.fn(), destroy: vi.fn(), setIdleTimeout: vi.fn(), onClose: (callback: () => void) => { close = callback; } };
    expect(lane.admit(first)).toBe(true);
    expect(lane.admit({ ...first, onClose: vi.fn() })).toBe(false);
    close();
    expect(clearDeadline).toHaveBeenCalledTimes(1);
    expect(lane.admit({ ...first, onClose: vi.fn() })).toBe(true);
    expect(first.setIdleTimeout).toHaveBeenCalledWith(30000, first.destroy);
  });

  it("reads neither ZIP nor owner form when admission is denied", async () => {
    const f = fixture();
    const root = "/api/admin/v1/workspaces/:workspaceId/site-imports";
    await f.mounted.get(`post ${root}/uploads`)!(f.request);
    await f.mounted.get(`post ${root}/:importId/owner`)!(f.request);
    expect(f.request.parseZip).not.toHaveBeenCalled();
    expect(f.request.parseForm).not.toHaveBeenCalled();
    expect(f.request.body).not.toHaveBeenCalled();
    expect(f.backend.get).not.toHaveBeenCalled();
  });

  it("requires a browser session for owner reads and reports an unknown fault once", async () => {
    const f = fixture();
    const root = "/api/admin/v1/workspaces/:workspaceId/site-imports";
    await f.mounted.get(`get ${root}/:importId/owner`)!(f.request);
    expect(f.request.authorize).not.toHaveBeenCalled();
    f.request.requireSession.mockReturnValue(true);
    f.request.authorize.mockResolvedValue(true);
    f.backend.get.mockImplementation(() => { throw new Error("private storage failure"); });
    await f.mounted.get(`get ${root}/:importId/owner`)!(f.request);
    expect(f.request.failure).toHaveBeenCalledTimes(1);
    expect(f.request.json).not.toHaveBeenCalled();
    expect(JSON.stringify(f.request.failure.mock.calls[0]?.[1])).not.toContain("private storage failure");
  });
});

const ROOT = "/api/admin/v1/workspaces/:workspaceId/site-imports";
const IMPORTED: SiteImportView = {
  importId: "import", source: { uploadId: "upload-8" }, newSiteId: null, newSiteName: null,
  state: "needs-owner", status: "needs-owner", createdAt: "2026-11-26T15:00:00Z",
  credentialWarnings: [], hasEncryptedKeys: true, instructions: "Set up the owner.",
};
const HEADERS = {
  "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer",
};

it("lists only the admitted owner's imports at the requested cursor and never reads a malformed cursor", async () => {
  const f = fixture();
  const run = f.mounted.get(`get ${ROOT}`)!;
  f.request.authorize.mockResolvedValue(true);
  const page = { imports: [IMPORTED], nextCursor: "page-19" };
  f.backend.listPage.mockResolvedValue(page);

  await run({ ...f.request, query: () => ({ cursor: "invalid=" }) });
  expect(f.request.json.mock.calls).toEqual([[{ code: "INVALID_CURSOR", message: "Import history failed: This list of imports changed. Reload it to see the newest imports." }, 400]]);
  expect(f.backend.listPage.mock.calls).toEqual([]);
  await run({ ...f.request, query: () => ({ cursor: "page-18" }) });
  expect(f.request.json.mock.calls.at(-1)).toEqual([page, 200]);
  expect(f.backend.listPage.mock.calls).toEqual([[{ principalId: "owner", cursor: "page-18" }]]);
  expect(f.request.authorize.mock.calls).toEqual(Array.from({ length: 2 }, () => [{
    principalId: "owner", workspaceId: "ws", entityType: "site-registry", permission: "system.read",
  }]));
  expect(f.request.noStore.mock.calls).toEqual([[HEADERS], [HEADERS]]);
});

it("maps history-store unavailability through the dedicated incident policy", async () => {
  const f = fixture();
  f.request.authorize.mockResolvedValue(true);
  const upstream = new Error("private SQL diagnostic");
  const unavailable = new HistoryUnavailable("Import history is temporarily offline.");
  f.backend.listPage.mockRejectedValue(upstream);
  f.mapHistoryError.mockImplementation((error) => { if (error === upstream) throw unavailable; });

  await f.mounted.get(`get ${ROOT}`)!(f.request);
  expect(f.mapHistoryError.mock.calls).toEqual([[upstream]]);
  expect(f.request.failure.mock.calls).toEqual([[unavailable, {
    code: "HISTORY_OFFLINE", message: "Import history is temporarily offline.", status: 503, field: "message",
  }]]);
  expect(f.request.json.mock.calls).toEqual([]);
});

it("passes a parsed backup request to the backend and cancels it on an unfinished disconnect", async () => {
  const f = fixture();
  f.request.authorize.mockResolvedValue(true);
  const parsed = { source: { uploadId: "upload-8" }, displayName: "Restored newsletter", requestId: "request-4" };
  f.request.body.mockReturnValue(parsed);
  f.parseInput.mockReturnValue(parsed);
  f.backend.importBackup.mockResolvedValue(IMPORTED);
  let close: (() => void) | undefined;
  let aborted: (() => void) | undefined;
  let ended = true;
  const run = f.mounted.get(`post ${ROOT}`)!;
  const request = {
    ...f.request, writableEnded: () => ended,
    onClose: (callback: () => void) => { close = callback; },
    onAborted: (callback: () => void) => { aborted = callback; },
  };
  await run(request);
  expect(f.parseInput.mock.calls).toEqual([[{ input: parsed }]]);
  expect(f.backend.importBackup).toHaveBeenCalledWith({ ...parsed, principalId: "owner" }, { signal: expect.any(AbortSignal) });
  expect(f.request.json.mock.calls).toEqual([[IMPORTED, 200]]);
  const first = f.backend.importBackup.mock.calls[0]?.[1]?.signal as AbortSignal;
  expect(first.aborted).toBe(false);
  expect(close).toEqual(expect.any(Function));
  close!();
  expect(first.aborted).toBe(false);
  ended = false;
  close!();
  expect(first.aborted).toBe(true);
  await run(request);
  const second = f.backend.importBackup.mock.calls[1]?.[1]?.signal as AbortSignal;
  expect(second.aborted).toBe(false);
  expect(aborted).toEqual(expect.any(Function));
  aborted!();
  expect(second.aborted).toBe(true);
});

it("protects the single upload lane, forwards raw bytes only and releases its deadline on close", async () => {
  const f = fixture();
  const upload = f.mounted.get(`post ${ROOT}/uploads`)!;
  f.request.authorize.mockResolvedValue(true);
  f.request.body.mockReturnValue(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  f.backend.upload.mockResolvedValue({ uploadId: "upload-8" });
  await upload(f.request);
  expect(f.request.parseZip.mock.calls).toEqual([[{ type: "application/zip", limit: 1024, inflate: false }]]);
  expect(f.backend.upload.mock.calls).toEqual([[{ archive: Buffer.from([0x50, 0x4b, 0x03, 0x04]), principalId: "owner" }]]);
  expect(f.request.json.mock.calls).toEqual([[{ uploadId: "upload-8" }, 201]]);
  expect(f.deadline.mock.calls).toEqual([[f.request.destroy, 120000]]);
  expect(f.deadlineHandle.unref).toHaveBeenCalledTimes(1);

  await upload(f.request);
  expect(f.request.json.mock.calls.at(-1)).toEqual([{ code: "BUSY", message: "Another ZIP upload is running." }, 409]);
  expect(f.request.parseZip).toHaveBeenCalledTimes(1);
  const onClose = f.request.onClose.mock.calls[0]?.[0] as () => void;
  onClose();
  expect(f.cancelDeadline.mock.calls).toEqual([[f.deadlineHandle]]);

  f.request.body.mockReturnValue({ path: "/archive.zip" });
  await upload(f.request);
  expect(f.request.parseZip).toHaveBeenCalledTimes(2);
  expect(f.request.json.mock.calls.at(-1)).toEqual([{ code: "INVALID_INPUT", message: "upload failed: Upload raw application/zip bytes, not a filesystem path or base64 JSON." }, 400]);
  expect(f.backend.upload).toHaveBeenCalledTimes(1);
});

it("returns owner setup instructions for the selected import and checks origin before parsing the form", async () => {
  const f = fixture();
  f.request.requireSession.mockReturnValue(true);
  f.request.authorize.mockResolvedValue(true);
  f.backend.get.mockReturnValue(IMPORTED);
  const path = `${ROOT}/:importId/owner`;
  await f.mounted.get(`get ${path}`)!(f.request);
  expect(f.backend.get.mock.calls).not.toEqual([]);
  expect(f.backend.get).toHaveBeenCalledWith({ principalId: "owner", importId: "import" });
  expect(f.request.json.mock.calls).toEqual([[{
    ...IMPORTED, ownerSetup: { method: "POST", field: "adminPassword", username: "admin", sessionRequired: true, savedKeysPasswordField: "savedKeysPassword" },
  }, 200]]);

  const write = f.mounted.get(`post ${path}`)!;
  await write({ ...f.request, origin: () => "https://other-host" });
  expect(f.request.json.mock.calls.at(-1)).toEqual([{ code: "FORBIDDEN", message: "same origin required" }, 403]);
  expect(f.request.parseForm.mock.calls).toEqual([]);
  expect(f.backend.completeOwner.mock.calls).toEqual([]);
  f.request.body.mockReturnValue({ adminPassword: "fixture-owner", savedKeysPassword: "fixture-saved" });
  f.backend.completeOwner.mockResolvedValue({ ...IMPORTED, state: "ready", status: "ready", newSiteId: "site-3" });
  await write(f.request);
  expect(f.request.parseForm.mock.calls).toEqual([[{ extended: false, limit: "8kb" }]]);
  expect(f.backend.completeOwner.mock.calls).toEqual([[{
    principalId: "owner", importId: "import", adminPassword: "fixture-owner", savedKeysPassword: "fixture-saved",
  }, { signal: expect.any(AbortSignal) }]]);
  expect(f.request.json.mock.calls.at(-1)).toEqual([{ ...IMPORTED, state: "ready", status: "ready", newSiteId: "site-3" }, 200]);
});

it("answers a withdrawn ZIP backend as an incident after parse instead of calling a stale binding", async () => {
  const f = fixture();
  f.request.authorize.mockResolvedValue(true);
  f.request.body.mockReturnValue(Buffer.from([0x50, 0x4b]));
  f.backendBinding.mockReturnValueOnce(f.backend).mockReturnValueOnce(undefined);
  await f.mounted.get(`post ${ROOT}/uploads`)!(f.request);
  expect(f.backend.upload.mock.calls).toEqual([]);
  expect(f.request.failure.mock.calls).toEqual([[expect.objectContaining({ message: "site import ZIP upload has no import backend" }), {
    operation: "site-import:upload", code: "IMPORT_FAILED", message: "upload failed. No existing site was changed.", field: "message",
  }]]);
});
