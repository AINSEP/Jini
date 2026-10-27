import { expect, it } from "vitest";
import type { ProviderTelemetryReport } from "@jini-ai/diagnostics/observability";
import { createProviderTelemetryReporter } from "../telemetry-reporter.js";
import { createSentryObservabilityAdapter } from "../observability-sentry/sentry.js";

it.each(["", "not-a-dsn"])("a borrowed Sentry client tolerates malformed DSN %j without exposing it or advertising crash upload", async dsn => {
  const reports: ProviderTelemetryReport[] = [];
  const logs: string[] = [];
  let closed = false;
  const reporter = createProviderTelemetryReporter({ endpoint: dsn }, { reportTelemetry: report => { reports.push(report); } });
  reporter.result({ phase: "export", outcome: "ok" });
  const resource = createSentryObservabilityAdapter({ config: { enabled: true, dsn, tracesSampleRate: 0 } }, {
    client: { close: async () => { closed = true; return true; }, getOptions: () => ({}) },
    info: message => { logs.push(message); },
  });
  try {
    expect(Object.hasOwn(resource.port, "crashUpload")).toBe(false);
    expect(reports).toEqual([{ phase: "export", outcome: "ok", host: "invalid-endpoint" }]);
    expect(logs).toEqual(["observability: Sentry reporting to invalid-endpoint"]);
  } finally { await resource.dispose(); }
  expect(closed).toBe(false);
});
