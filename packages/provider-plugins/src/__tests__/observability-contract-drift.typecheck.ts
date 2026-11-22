/**
 * Two-way drift guard (a type-level check; `tsc` runs it through `pnpm typecheck`). The observability providers'
 * structural copies (`observability-opentelemetry/contract.ts`, `observability-sentry/contract.ts`,
 * `telemetry-reporter.ts`) must neither be narrower nor wider than diagnostics': each member is asserted
 * `Local extends Domain` AND `Domain extends Local`. A plugin cannot import the domain, so the proof lives here, in a
 * test file, which may. It is not runtime code and nothing imports it. It sits beside R12a's payments half
 * (`payments-stripe/__tests__/contract-drift.typecheck.ts`); both move into `packages/integration-tests` when that
 * package can be created (the install trap lifts 2026-11-19).
 */
import type * as DomainObservability from "@jini-ai/diagnostics/observability";
import type { ProviderTelemetryReport as DomainReport, observabilityProviderContract } from "@jini-ai/diagnostics/observability";
import type * as LocalOtel from "../observability-opentelemetry/contract.js";
import type * as LocalSentry from "../observability-sentry/contract.js";
import type * as LocalReporter from "../telemetry-reporter.js";

type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
type DomainContext = typeof observabilityProviderContract.context;

export type ObservabilityContractDrift = [
  Assert<Mutual<LocalOtel.ObservabilityProviderContext, DomainContext>>,
  Assert<Mutual<LocalSentry.SentryProviderContext, Pick<DomainContext, "describeReportedError" | "describeTelemetryFailure" | "redactOperationAttributes">>>,
  Assert<Mutual<LocalOtel.ObservabilityHelpers, Pick<DomainContext, "redactOperationAttributes" | "errorType" | "redactLabel">>>,
  Assert<Mutual<LocalReporter.ProviderTelemetryReport, DomainReport>>,
  Assert<Mutual<LocalReporter.DescribeTelemetryFailure, DomainContext["describeTelemetryFailure"]>>,
  Assert<Mutual<LocalOtel.ObservabilityConfigEnabled, DomainObservability.ObservabilityConfigEnabled>>,
  Assert<Mutual<LocalOtel.TraceSpanPort, DomainObservability.TraceSpanPort>>,
  Assert<Mutual<LocalOtel.SpanScopePort, DomainObservability.SpanScopePort>>,
];
