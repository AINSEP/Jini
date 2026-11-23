import { describe, expect, it } from "vitest";

import { sniffContentType } from "../../../../media/content-type-sniffer.js";
import {
  CHAT_ATTACHMENT_READ_PATH, createChatAttachmentReadRoute,
  type ChatAttachmentRange, type ChatAttachmentReadRouteDeps,
} from "../get-chat-attachment.js";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);
const HTML = new TextEncoder().encode("<!doctype html><html><body>x</body></html>");
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox";
const REF = "attachment:11111111-2222-3333-4444-555555555555";

/** A minimal single-range parser standing in for the host's (`bytes=a-b` and `bytes=a-` only). */
function fakeParseRange({ header, totalLength }: { header: string | undefined; totalLength: number }): ChatAttachmentRange {
  const match = header ? /^bytes=(\d+)-(\d*)$/.exec(header) : null;
  if (!match) return { kind: "none" };
  const start = Number(match[1]);
  const end = match[2] === "" ? totalLength - 1 : Math.min(Number(match[2]), totalLength - 1);
  return start > end ? { kind: "unsatisfiable" } : { kind: "range", start, end };
}

/** Recording deps around one stored attachment; each collaborator can be replaced per test. */
function makeDeps(overrides: Partial<ChatAttachmentRouteFakes> = {}): { deps: ChatAttachmentReadRouteDeps; calls: { reads: unknown[]; ranges: unknown[]; failures: unknown[] } } {
  const calls = { reads: [] as unknown[], ranges: [] as unknown[], failures: [] as unknown[] };
  const bytes = overrides.bytes ?? PNG;
  const deps: ChatAttachmentReadRouteDeps = {
    readAttachment: overrides.readAttachment ?? (async (input) => { calls.reads.push(input); return { ok: true, bytes }; }),
    ownerIdOf: overrides.ownerIdOf ?? (({ locals }) => (locals.principal as { id: string }).id),
    sniffContentType: ({ bytes: sniffed }) => sniffContentType({ bytes: sniffed }),
    parseRangeHeader: (input) => { calls.ranges.push(input); return fakeParseRange(input); },
    disallowedInlineContentTypes: overrides.disallowedInlineContentTypes ?? new Set(["text/html", "application/xhtml+xml"]),
    svgContentSecurityPolicy: SVG_CSP,
    failureResponse: ({ error, request, locals }) => {
      calls.failures.push({ error, method: request.method, locals });
      return new Response("host failure", { status: 500, headers: { "x-host-failure": "1" } });
    },
  };
  return { deps, calls };
}

interface ChatAttachmentRouteFakes {
  bytes: Uint8Array;
  readAttachment: ChatAttachmentReadRouteDeps["readAttachment"];
  ownerIdOf: ChatAttachmentReadRouteDeps["ownerIdOf"];
  disallowedInlineContentTypes: ReadonlySet<string>;
}

/** Calls the route the way an adapter would, with an authenticated principal in `locals` unless told otherwise. */
async function call({ deps, headers = {}, ref = REF, locals = { principal: { id: "uploader-7" } } }: { deps: ChatAttachmentReadRouteDeps; headers?: Record<string, string>; ref?: string; locals?: Record<string, unknown> }): Promise<Response> {
  const route = createChatAttachmentReadRoute({ deps });
  const request = new Request(`http://localhost/api/attachments/${encodeURIComponent(ref)}`, { headers });
  return route.handler({ request, params: { ref }, locals });
}

/** Every response header, sorted, so a stray or missing header fails the comparison. */
function headerList(response: Response): string[] {
  return [...response.headers.entries()].map(([name, value]) => `${name}: ${value}`).sort();
}

const INLINE_HEADERS = [
  "accept-ranges: bytes",
  "cache-control: private, no-store",
  "content-security-policy: default-src 'none'; sandbox",
  "cross-origin-resource-policy: same-origin",
  "x-content-type-options: nosniff",
];

describe("chat attachment read route", () => {
  it("is GET /api/attachments/:ref", () => {
    const route = createChatAttachmentReadRoute({ deps: makeDeps().deps });
    expect(route.method).toBe("GET");
    expect(route.path).toBe("/api/attachments/:ref");
    expect(CHAT_ATTACHMENT_READ_PATH).toBe("/api/attachments/:ref");
  });

  it("serves the owner's bytes under the sniffed type with the full safe header set", async () => {
    const { deps, calls } = makeDeps();
    const response = await call({ deps });
    expect(calls.reads).toEqual([{ ref: REF, ownerId: "uploader-7" }]);
    expect(calls.ranges).toEqual([{ header: undefined, totalLength: PNG.byteLength }]);
    expect(response.status).toBe(200);
    expect(headerList(response)).toEqual([...INLINE_HEADERS, "content-length: 16", "content-type: image/png"].sort());
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
  });

  it("answers every refusal with the one non-disclosing 404", async () => {
    const { deps } = makeDeps({ readAttachment: async () => ({ ok: false }) });
    const response = await call({ deps });
    expect(response.status).toBe(404);
    expect(headerList(response)).toEqual(["cache-control: private, no-store", "content-length: 55", "content-type: application/json; charset=utf-8"]);
    expect(await response.text()).toBe('{"error":"attachment was not found","code":"NOT_FOUND"}');
  });

  it("never serves sniffed HTML as HTML: octet-stream plus a forced download", async () => {
    const { deps } = makeDeps({ bytes: HTML });
    const response = await call({ deps });
    expect(response.status).toBe(200);
    expect(headerList(response)).toEqual([...INLINE_HEADERS, "content-disposition: attachment", `content-length: ${HTML.byteLength}`, "content-type: application/octet-stream"].sort());
  });

  it("serves SVG inline under the injected SVG policy", async () => {
    const { deps } = makeDeps({ bytes: SVG });
    const response = await call({ deps });
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    expect(response.headers.get("content-security-policy")).toBe(SVG_CSP);
    expect(response.headers.get("content-disposition")).toBeNull();
  });

  it("uses the host's disallowed-inline set, not a built-in one", async () => {
    const { deps } = makeDeps({ disallowedInlineContentTypes: new Set(["image/png"]) });
    const response = await call({ deps });
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(response.headers.get("content-disposition")).toBe("attachment");
  });

  it("honours a Range request with an inclusive end", async () => {
    const { deps, calls } = makeDeps();
    const response = await call({ deps, headers: { range: "bytes=2-5" } });
    expect(calls.ranges).toEqual([{ header: "bytes=2-5", totalLength: 16 }]);
    expect(response.status).toBe(206);
    expect(headerList(response)).toEqual([...INLINE_HEADERS, "content-length: 4", "content-range: bytes 2-5/16", "content-type: image/png"].sort());
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG.slice(2, 6));
  });

  it("serves an open-ended range through the last byte", async () => {
    const { deps } = makeDeps();
    const response = await call({ deps, headers: { range: "bytes=10-" } });
    expect(response.headers.get("content-range")).toBe("bytes 10-15/16");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG.slice(10));
  });

  it("answers an unsatisfiable range with a bodiless 416 naming the full length", async () => {
    const { deps } = makeDeps();
    const response = await call({ deps, headers: { range: "bytes=100-200" } });
    expect(response.status).toBe(416);
    expect(headerList(response)).toEqual([...INLINE_HEADERS, "content-range: bytes */16", "content-type: image/png"].sort());
    expect(response.body).toBeNull();
  });

  it("hands an unexpected read failure to the host's failure response, unchanged", async () => {
    const failure = new Error("filesystem failure /private/uploads");
    const { deps, calls } = makeDeps({ readAttachment: async () => { throw failure; } });
    const response = await call({ deps });
    expect(calls.failures).toEqual([{ error: failure, method: "GET", locals: { principal: { id: "uploader-7" } } }]);
    expect(response.status).toBe(500);
    expect(response.headers.get("x-host-failure")).toBe("1");
    expect(await response.text()).toBe("host failure");
  });

  it("fails closed through the host's failure response when no principal is known, before any read", async () => {
    const missing = new Error("no principal");
    const { deps, calls } = makeDeps({ ownerIdOf: () => { throw missing; } });
    const response = await call({ deps, locals: {} });
    expect(calls.reads).toEqual([]);
    expect(calls.failures).toEqual([{ error: missing, method: "GET", locals: {} }]);
    expect(response.status).toBe(500);
  });
});
