import { isSameOriginBrowserWrite } from "@jini-ai/core/contracts/server";

export function savedKeysSameOrigin({ origin, host, fetchSite, protocol }: { origin: string | undefined; host: string | undefined; fetchSite: string | undefined; protocol: string }, _optional = {}): boolean {
  return isSameOriginBrowserWrite({ origin, host, fetchSite }) && origin !== undefined && host !== undefined && origin === `${protocol}://${host}`;
}

export function savedShareRefusalStatus({ code }: { code: string }, _optional = {}): 400 | 403 | 404 {
  return code === "NOT_FOUND" ? 404 : code === "FORBIDDEN" ? 403 : 400;
}

/** Parser errors describe a failed upload, while unexpected storage faults remain incidents. */
export function savedShareUploadRefusal({ error }: { error: unknown }, _optional = {}): { status: 400 | 413; code: "INVALID_INPUT" | "LIMIT_EXCEEDED" } | undefined {
  const type = (error as { type?: string } | null)?.type;
  if (!type || !["entity.too.large", "encoding.unsupported", "entity.parse.failed", "request.aborted", "request.size.invalid"].includes(type)) return undefined;
  return { status: type === "entity.too.large" ? 413 : 400, code: type === "entity.too.large" ? "LIMIT_EXCEEDED" : "INVALID_INPUT" };
}
