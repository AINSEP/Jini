import { describe, expect, it, vi } from "vitest";
import { createSiteImportUploadLane, registerSiteImportRoutes } from "../system/site-imports.js";

function fixture() {
  const mounted = new Map<string, Parameters<Parameters<typeof registerSiteImportRoutes>[0]["mount"]>[0]["handle"]>();
  const backend = { get: vi.fn(), upload: vi.fn(), completeOwner: vi.fn(), importBackup: vi.fn(), listPage: vi.fn() };
  const config = { workspaceId: "ws", mount: ({ method, path, handle }: Parameters<Parameters<typeof registerSiteImportRoutes>[0]["mount"]>[0]) => { mounted.set(`${method} ${path}`, handle); }, backend: () => backend,
    parseInput: vi.fn(), refusal: (input: { code: "INVALID_INPUT"; message: string }) => Object.assign(new Error(input.message), { code: input.code }),
    mapHistoryError: vi.fn(), historyUnavailable: class extends Error {}, failureCollaborators: { asRefusal: () => undefined, formatByteSize: ({ bytes }: { bytes: number }) => String(bytes) },
    steps: { list: "history", import: "import", upload: "upload", ownerGet: "read owner", ownerPost: "write owner" }, ownerSessionMessage: "session required", originRefusalMessage: "same origin required", maxArchiveBytes: 1024,
    uploadDeadlineMs: 120000, uploadIdleMs: 30000, setTimeout, clearTimeout,
  } as unknown as Parameters<typeof registerSiteImportRoutes>[0];
  registerSiteImportRoutes(config);
  const request = { workspaceId: () => "ws", principalId: () => "owner", authorize: vi.fn(async () => false), requireSession: vi.fn(() => false),
    noStore: vi.fn(), json: vi.fn(), failure: vi.fn<(error: unknown, options: unknown) => void>(), body: vi.fn(), query: vi.fn(() => ({})), importId: vi.fn(() => "import"), origin: vi.fn(() => "https://host"), protocol: () => "https", host: () => "host",
    parseZip: vi.fn(async () => {}), parseForm: vi.fn(async () => {}), isBuffer: Buffer.isBuffer,
    onClose: vi.fn(), onAborted: vi.fn(), writableEnded: () => false, destroy: vi.fn(), setIdleTimeout: vi.fn(),
  };
  return { mounted, request, backend };
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
