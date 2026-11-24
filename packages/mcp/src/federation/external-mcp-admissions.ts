import { readFederationAdmissions, type FederationAdmissionsPorts } from "./admissions.js";
import type { ExternalMcpOperations } from "../external/operations-tools.js";

/** Live in-process accounting. The federation transport owns remote errors and their tracing. */
export type ServerAdmissionsReader = Omit<FederationAdmissionsPorts, "report">;

/** One failure contract for missing composition, a connecting server or a failed read.
 * Keep the legacy code until the admin client's unavailable-state contract migrates too:
 * an unavailable report must never look like an empty admitted roster. */
function unavailable(): Awaited<ReturnType<ExternalMcpOperations["admissions"]>> {
  return { ok: false, body: { error: "the server's external MCP admissions are unavailable — try again shortly", code: "AGENT_DAEMON_UNAVAILABLE" } };
}

/** The host's report of a failed read. Its log line and redacting formatter are the host's: the cause's class and code
 * only, never its message, so an opaque transport failure cannot expose credentials to the log. */
export type ReportReadFailure = (required: { error: unknown }) => void;

/** Binds the host's failure reporter once and returns the admissions reader every caller uses.
 * @param required.reportReadFailure - The host's redacting report for a failed read.
 * @returns `readServerAdmissions`, bound to that reporter.
 * @example export const readServerAdmissions = createServerAdmissionsReader({ reportReadFailure });
 * @complexity O(1).
 */
export function createServerAdmissionsReader({ reportReadFailure }: { reportReadFailure: ReportReadFailure }, _optional = {}) {
  /** Read the server's single federation after its bounded admission wait; never wake a daemon.
   * @param required - The existing surface's wait and live-report ports; absent ports fail closed.
   * @returns Current reports, preserving optional config failures, or the legacy distinguishable failure.
   * @example readServerAdmissions({ awaitFederation: surface.awaitFederation, readAdmissions })
   * @complexity O(1) beyond federation startup and the report reader; the wait is bounded to 5 seconds.
   */
  return async function readServerAdmissions(
    { awaitFederation, readAdmissions }: ServerAdmissionsReader,
    _options: Record<string, never> = {},
  ): ReturnType<ExternalMcpOperations["admissions"]> {
    const result = await readFederationAdmissions({ ports: { awaitFederation, readAdmissions, report: reportReadFailure }, timeoutMs: 5_000 });
    if (!result.ok) return unavailable();
    return result.configFailures === undefined
      ? { ok: true, connections: result.connections }
      : { ok: true, connections: result.connections, configFailures: result.configFailures };
  };
}
