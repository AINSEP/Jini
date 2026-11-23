/** Mirrors provider selection and delivery evidence, flattened for the wire the same way
 *  {@link AdminDeploymentOverview} flattens its own source config.
 *  `serviceName` is `null` whenever `enabled` is `false` — there is no service name to report for
 *  a port that never loads the OTel SDK. Deliberately does NOT carry the OTLP endpoint itself: that
 *  can embed a credential. Delivery evidence exposes only a hostname, fixed error class and HTTP
 *  status so an enabled port cannot be mistaken for proof that an export succeeded. */
export interface AdminObservabilityStatus {
  enabled: boolean;
  serviceName: string | null;
  canSendTestError?: boolean;
  providers?: { providerId: string; exportEnabled?: boolean; lastExport: AdminTelemetryDeliveryStatus | null; lastShutdown: AdminTelemetryDeliveryStatus | null }[];
}
/** Sanitized delivery DTO from the server; status carries no destination path or credential. */
export interface AdminTelemetryDeliveryStatus {
  phase: "export" | "shutdown";
  outcome: "ok" | "failed";
  host: string;
  at: string;
  errorClass?: string;
  statusCode?: number;
}
export interface AdminTelemetryTestResult {
  providers: { providerId: string; signals: ("error" | "span" | "analytics" | "metric")[] }[];
}

/** One captured server log line — mirrors `ServerLogEntry` in `@jini-ai/core/contracts/site/platform-server-logs`
 *  (used by the host's server-log buffer). `message` is already secret-redacted. */
export interface AdminServerLogEntry {
  seq: number;
  at: string;
  level: "debug" | "info" | "warn" | "error";
  source: "server" | "daemon";
  message: string;
}

/** `GET /system/server-logs` — mirrors `ServerLogsResult` in
 *  the host's server-log reader. `capturing: false` means nothing is
 *  recording lines, so an empty list is not proof of no errors. */
export interface AdminServerLogs {
  entries: AdminServerLogEntry[];
  matched: number;
  buffered: number;
  truncated: boolean;
  capturing: boolean;
}

/** Filters for {@link AdminServerLogs}; the same ones the `system_read_server_logs` chat tool takes. */
export interface AdminServerLogsQuery {
  level?: AdminServerLogEntry["level"];
  sinceIso?: string;
  contains?: string;
  limit?: number;
}
