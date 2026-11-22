/**
 * @file Read one federation's admission report after its bounded startup wait. The essential invariant:
 * an unavailable report (not composed, still connecting, malformed, failed read) is never confused with an
 * available, empty roster. Constructs no runtime and no admission store; the host passes its live ones.
 */

/** @agent-note Host-wired from the running federation. Absent `awaitFederation`/`readAdmissions` = not composed, so the read fails closed. */
export interface FederationAdmissionsPorts {
  readonly awaitFederation?: ((required: { timeoutMs: number }, optional?: Record<string, never>) => Promise<{ readonly settled: boolean }>) | undefined;
  /** Live in-process accounting. The federation transport owns remote errors and their tracing. */
  readonly readAdmissions?: (() => Promise<{ readonly connections: unknown; readonly configFailures?: unknown }>) | undefined;
  /** Receives a wait/read failure. Transport errors can carry credentials: the host redacts before it logs. */
  readonly report: (required: { error: unknown }, optional?: Record<string, never>) => void;
}

export type FederationAdmissionsResult =
  | { readonly ok: true; readonly connections: readonly unknown[]; readonly configFailures?: readonly unknown[] }
  | { readonly ok: false };

const UNAVAILABLE: FederationAdmissionsResult = { ok: false };

/** Accepts a report only when its lists are lists; `configFailures` stays absent when the runtime omitted it. */
function admittedReport(
  { report }: { report: { readonly connections: unknown; readonly configFailures?: unknown } },
  _optional = {},
): FederationAdmissionsResult {
  if (!Array.isArray(report.connections)) return UNAVAILABLE;
  if (report.configFailures !== undefined && !Array.isArray(report.configFailures)) return UNAVAILABLE;
  return report.configFailures === undefined
    ? { ok: true, connections: report.connections }
    : { ok: true, connections: report.connections, configFailures: report.configFailures };
}

/** Waits (bounded by `timeoutMs`) for the federation to settle, then reads its current reports.
 * @complexity O(1) beyond federation startup and the report reader. */
export async function readFederationAdmissions(
  { ports, timeoutMs }: { readonly ports: FederationAdmissionsPorts; readonly timeoutMs: number },
  _optional: Record<string, never> = {},
): Promise<FederationAdmissionsResult> {
  const { awaitFederation, readAdmissions, report } = ports;
  if (!awaitFederation || !readAdmissions) return UNAVAILABLE;
  try {
    if (!(await awaitFederation({ timeoutMs })).settled) return UNAVAILABLE;
    return admittedReport({ report: await readAdmissions() });
  } catch (error) {
    // Only the sink sees the error: an opaque transport failure must not reach the caller.
    report({ error });
    return UNAVAILABLE;
  }
}
