import { expect, it } from "vitest";
import { defaultStackParser, makeNodeTransport } from "@sentry/node";
import type { ProviderTelemetryReport } from "../telemetry-reporter.js";
import { createProviderTelemetryReporter as rawReporter } from "../telemetry-reporter.js";
import { OBSERVABILITY_CONTEXT, describeTelemetryFailure, hostScope } from "./observability-host.js";
/** The host binds diagnostics' failure classifier; these tests bind the real one the same way. */
const createProviderTelemetryReporter = (required: { endpoint: string }, options?: Parameters<typeof rawReporter>[1]) => rawReporter({ ...required, describeTelemetryFailure }, options);
import { createSentryObservabilityAdapter } from "../observability-sentry/sentry.js";

it.each(["", "not-a-dsn"])("a borrowed Sentry client tolerates malformed DSN %j without exposing it or advertising crash upload", async dsn => {
  const reports: ProviderTelemetryReport[] = [];
  const logs: string[] = [];
  let closed = false;
  const reporter = createProviderTelemetryReporter({ endpoint: dsn }, { reportTelemetry: report => { reports.push(report); } });
  reporter.result({ phase: "export", outcome: "ok" });
  const resource = createSentryObservabilityAdapter({ context: OBSERVABILITY_CONTEXT, config: { enabled: true, dsn, tracesSampleRate: 0 } }, { exportEnabled: true,
    client: { close: async () => { closed = true; return true; },
      getOptions: () => ({ integrations: [], stackParser: defaultStackParser, transport: makeNodeTransport }) },
    info: message => { logs.push(message); },
  });
  try {
    expect(Object.hasOwn(resource.port, "crashUpload")).toBe(false);
    expect(reports).toEqual([{ phase: "export", outcome: "ok", host: "invalid-endpoint" }]);
    expect(logs).toEqual(["observability: Sentry reporting to invalid-endpoint"]);
  } finally { await resource.dispose(); }
  expect(closed).toBe(false);
});
