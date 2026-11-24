import { MAX_CONTAINS_LENGTH, MAX_SERVER_LOG_LIMIT, SERVER_LOG_LEVELS } from "./read-server-logs.js";

/** Catalog for the read-only server-log diagnostic (gap A-04). */
export const serverLogsAgentToolCatalog = [{
  name: "system_read_server_logs",
  description: `Reads this site's recent server log lines: console output of the server and its assistant daemon (source "server" or "daemon"), including errors, warnings and unhandled rejections, kept across restarts. Use when the owner asks what went wrong, for recent server errors, or why something failed on the server. Optional input: level (minimum severity: ${SERVER_LOG_LEVELS.join(", ")}; "warn" returns warnings and errors), sinceIso (ISO-8601 date-time), contains (case-insensitive text, at most ${MAX_CONTAINS_LENGTH} characters), limit (1-${MAX_SERVER_LOG_LIMIT}, default 100). Returns {entries: [{seq, at, level, source, message}], matched, buffered, truncated, capturing}; entries are oldest first and are the newest matching lines. Secret values are redacted. capturing false means no log is being recorded, so an empty list is not proof of no errors. seq restarts at 1 after a server restart. Read-only; requires system.read, like the admin server-logs route.`,
  sideEffects: "none" as const,
  authorization: { permission: "system.read" },
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      level: { type: "string", enum: [...SERVER_LOG_LEVELS] },
      sinceIso: { type: "string", format: "date-time" },
      contains: { type: "string", maxLength: MAX_CONTAINS_LENGTH },
      limit: { type: "integer", minimum: 1, maximum: MAX_SERVER_LOG_LIMIT, clamp: true },
    },
  },
}];
