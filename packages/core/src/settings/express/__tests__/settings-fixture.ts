import { EventEmitter } from "node:events";
import type { Request, Response } from "express";
import { vi } from "vitest";
import type { SettingsHttpRequired, SettingsPermissions } from "../index.js";

export const permissions: SettingsPermissions = {
  read: "prefs.read", readRaw: "prefs.raw", readDefinitions: "prefs.list", readOtherUser: "prefs.other.read",
  manageDefinitions: "prefs.manage", writeGlobal: "prefs.global", writeWorkspace: "prefs.workspace",
  writeUserSelf: "prefs.self", writeUserOther: "prefs.other", reset: { global: "reset.all", workspace: "reset.workspace", user: "reset.self" },
};
export function createCapturingResponse() {
  const capture = { statusCode: 200, jsonBody: undefined as unknown, frames: "", headers: {} as Record<string, string> };
  const emitter = new EventEmitter();
  const res = Object.assign(emitter, {
    headersSent: false, destroyed: false, writableEnded: false,
    status(code: number) { capture.statusCode = code; return this; },
    json(body: unknown) { capture.jsonBody = body; return this; },
    writeHead(code: number, headers: Record<string, string>) { capture.statusCode = code; capture.headers = headers; this.headersSent = true; return this; },
    write(frame: string) { capture.frames += frame; return true; },
    end: vi.fn(function (this: { writableEnded: boolean }) { this.writableEnded = true; }),
  });
  return { res: res as unknown as Response, capture };
}
type Handler = (request: Request, response: Response) => Promise<void>;
interface SettingsFixture {
  deps: SettingsHttpRequired;
  handlers: Map<string, Handler>;
  scheduled: Map<number, () => void>;
  cancelled: number[];
  invoke(method: string, path: string, fields?: Record<string, unknown>): Promise<{
    req: Request;
    res: Response;
    capture: ReturnType<typeof createCapturingResponse>["capture"];
  }>;
}

/** Name the fixture's public Express types so declarations never expose pnpm's internal paths. */
export function fixture(): SettingsFixture {
  const handlers = new Map<string, Handler>();
  const scheduled = new Map<number, () => void>();
  const cancelled: number[] = [];
  const mount = (method: string) => (path: string, handler: Handler) => { handlers.set(`${method} ${path}`, handler); };
  const deps: SettingsHttpRequired = {
    app: { get: mount("GET"), post: mount("POST"), put: mount("PUT"), delete: mount("DELETE") } as unknown as SettingsHttpRequired["app"],
    workspaceId: "workspace-a", ready: Promise.resolve(),
    routes: { definitions: "/prefs/definitions", effective: "/prefs/effective", raw: "/prefs/raw", value: "/prefs/value", reset: "/prefs/reset", events: "/prefs/events", workspaceParam: "tenant" },
    permissions,
    principalResolver: vi.fn(() => ({ id: "me" })),
    authorize: vi.fn(async () => ({ allowed: true, reason: "allowed" })),
    scheduler: { every: ({ intervalMs, callback }) => { scheduled.set(intervalMs, callback); return () => { cancelled.push(intervalMs); scheduled.delete(intervalMs); }; } },
    changeFeed: {
      head: vi.fn(async () => 0), collect: vi.fn(async () => ({ cursor: 0, namespaces: [], examinedCount: 0 })),
    },
    service: {
      listDefinitions: vi.fn(async () => []), effective: vi.fn(async () => []), raw: vi.fn(async () => null),
      set: vi.fn(async () => ({ value: "saved", revisionSeq: 7 })), clear: vi.fn(async () => ({ revisionSeq: 8 })),
      reset: vi.fn(async () => ({ clearedCount: 1, revisionSeqs: [9] })), definitions: vi.fn(async () => ({ applied: [] })),
    },
  };
  async function invoke(method: string, path: string, fields: Record<string, unknown> = {}) {
    const req = Object.assign(new EventEmitter(), { params: { tenant: "workspace-a" }, headers: {}, query: {}, body: {}, httpVersionMajor: 1 }, fields) as unknown as Request;
    const { res, capture } = createCapturingResponse();
    const handler = handlers.get(`${method} ${path}`);
    if (!handler) throw new Error(`missing route ${method} ${path}`);
    await handler(req, res);
    return { req, res, capture };
  }
  return { deps, handlers, scheduled, cancelled, invoke };
}
/** Drain asynchronous fake scheduler callbacks without running real timers or binding ports. */
export async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
