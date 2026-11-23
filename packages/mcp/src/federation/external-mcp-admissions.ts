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

/** The host's log formatter: the cause's class and code only, never its message. */
export type DescribeErrorForLog = (required: { err: unknown }) => string;

/** Fixed metadata only: an opaque transport failure must not expose credentials to the client or the log. */
function reportAdmissionsFailure({ error, describeErrorForLog }: { error: unknown; describeErrorForLog: DescribeErrorForLog }, _optional = {}): void {
  console.error("external-mcp server admissions read failed", describeErrorForLog({ err: error }));
}

/** Binds the host's log formatter once and returns the admissions reader every caller uses.
 * @param required.describeErrorForLog - The host's redacting log formatter for a failed read.
 * @returns `readServerAdmissions`, bound to that formatter.
 * @example export const readServerAdmissions = createServerAdmissionsReader({ describeErrorForLog });
 * @complexity O(1).
 */
export function createServerAdmissionsReader({ describeErrorForLog }: { describeErrorForLog: DescribeErrorForLog }, _optional = {}) {
  const report = ({ error }: { error: unknown }): void => reportAdmissionsFailure({ error, describeErrorForLog });
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
    const result = await readFederationAdmissions({ ports: { awaitFederation, readAdmissions, report }, timeoutMs: 5_000 });
    if (!result.ok) return unavailable();
    return result.configFailures === undefined
      ? { ok: true, connections: result.connections }
      : { ok: true, connections: result.connections, configFailures: result.configFailures };
  };
}
