/** Sanitized adapter diagnostics. No raw errors, URLs, headers or credentials cross this boundary. */
export interface ProviderTelemetryReport {
  phase: "export" | "shutdown";
  outcome: "ok" | "failed";
  host: string;
  errorClass?: string;
  statusCode?: number;
}
export interface ProviderTelemetryStatus extends ProviderTelemetryReport { at: string; }
export interface ProviderDeliveryStatus {
  providerId: string;
  lastExport: ProviderTelemetryStatus | null;
  lastShutdown: ProviderTelemetryStatus | null;
}
export interface TelemetryDeliveryMonitor {
  register(required: { providerId: string }, optional?: Record<string, never>): void;
  report(required: { providerId: string; report: ProviderTelemetryReport }, optional?: Record<string, never>): void;
  read(required: Record<string, never>, optional?: Record<string, never>): ProviderDeliveryStatus[];
}

const ERROR_CLASSES: ReadonlySet<string> = new Set(["Error", "TypeError", "RangeError", "TimeoutError", "AbortError", "OTLPExporterError", "PluginProviderError"]);
/** HTTP status is numeric and bounded; transport codes and text are deliberately not exposed. */
function httpStatus(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599 ? value : undefined;
}

/** Reduces opaque SDK failures to fixed labels; even an Error's name can contain credentials.
 * @returns Error class and optional HTTP status, never a message, stack, URL or header.
 * @complexity O(1); hostile getters degrade to the fixed Error label.
 */
export function describeTelemetryFailure({ error }: { error: unknown }, _options = {}): Pick<ProviderTelemetryReport, "errorClass" | "statusCode"> {
  if (typeof error !== "object" || error === null) return { errorClass: "Error" };
  try {
    const value = error as { name?: unknown; statusCode?: unknown; status?: unknown; code?: unknown };
    const errorClass = typeof value.name === "string" && ERROR_CLASSES.has(value.name) ? value.name : "Error";
    const statusCode = httpStatus(value.statusCode ?? value.status ?? value.code);
    return { errorClass, ...(statusCode === undefined ? {} : { statusCode }) };
  } catch { return { errorClass: "Error" }; }
}

/** Keeps delivery evidence separate from configuration and logs each distinct failure until recovery.
 * @param required Host warning sink; receives sanitized adapter fields only.
 * @param optional Injected wall clock for status timestamps.
 * @returns Per-provider reporter and detached status reader. @complexity O(p + f) retained state.
 */
export function createTelemetryDeliveryMonitor(
  { warn }: { warn: (message: string) => void },
  { now = () => new Date().toISOString() }: { now?: () => string } = {},
): TelemetryDeliveryMonitor {
  const statuses = new Map<string, { lastExport: ProviderTelemetryStatus | null; lastShutdown: ProviderTelemetryStatus | null }>();
  const logged = new Map<string, Set<string>>();
  return {
    register({ providerId }: { providerId: string }, _options = {}): void {
      statuses.set(providerId, { lastExport: null, lastShutdown: null });
    },
    report({ providerId, report }: { providerId: string; report: ProviderTelemetryReport }, _options = {}): void {
      const state = statuses.get(providerId) ?? { lastExport: null, lastShutdown: null };
      const status = { ...report, at: now() };
      if (report.phase === "export") state.lastExport = status;
      else state.lastShutdown = status;
      statuses.set(providerId, state);
      if (report.outcome !== "failed") { logged.delete(providerId); return; }
      const kind = JSON.stringify([report.phase, report.errorClass, report.statusCode, report.host]);
      const failures = logged.get(providerId) ?? new Set<string>();
      if (failures.has(kind)) return;
      failures.add(kind);
      logged.set(providerId, failures);
      try { warn(`observability: ${providerId} ${report.phase} failed (${report.errorClass ?? "Error"}${report.statusCode === undefined ? "" : `, HTTP ${report.statusCode}`}, host ${report.host})`); }
      catch { /* A broken log sink must not fail an exporter callback or shutdown. */ }
    },
    read(_required: Record<string, never>, _options = {}) {
      return [...statuses].map(([providerId, state]) => ({ providerId,
        lastExport: state.lastExport ? { ...state.lastExport } : null,
        lastShutdown: state.lastShutdown ? { ...state.lastShutdown } : null }));
    },
  };
}
