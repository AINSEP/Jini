/**
 * @file Request-ID resolution for inbound HTTP (Reliability: structured logging + request IDs).
 * Pure rules only; the host's request-tracking middleware applies them, because that middleware is
 * registered first in the host app and so sees every request — including ones the serving gate
 * rejects and 404s — that a log/trace join would need.
 */
import { randomUUID } from "node:crypto";

/** The header read from the request and echoed on the response (the de-facto proxy convention). */
export const REQUEST_ID_HEADER = "x-request-id";

/**
 * A proxy's or caller's id is reused only when it is short and log-safe: anything else could forge
 * or split a log line keyed on it, or blow up the cardinality of whatever stores it. Bounded at 128,
 * which fits UUIDs, ULIDs and the common edge-proxy formats.
 */
const SAFE_INBOUND_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/** Reuses a safe inbound `x-request-id`, else mints one (UUID v4 by default). */
export function resolveRequestId(
  required: { header: string | string[] | undefined },
  { mint = randomUUID }: { mint?: () => string } = {},
): string {
  const { header } = required;
  return typeof header === "string" && SAFE_INBOUND_REQUEST_ID.test(header) ? header : mint();
}
