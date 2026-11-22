/** The observability domain's provider contract descriptor: the port check plus the helper values every
 * observability provider receives as its factory's `optional.context`. Hosts register it with their
 * provider host; plugins never supply or replace the validator. */
import { resolveObservabilityConfig } from './config.js';
import { describeTelemetryFailure } from './delivery.js';
import { describeReportedError } from './errors.js';
import { errorType, redactLabel, redactOperationAttributes } from './otel.js';

const PORT_METHODS = ['trackRequest', 'trackDbQuery', 'trackOutboundCall', 'trackAgentRun', 'trackOperation', 'reportError'] as const;

/** `metric` is not required: contract v1 providers predate it, and callers route a missing method to the noop. */
function observabilityPortProblem({ provider }: { provider: unknown }, _optional: Record<string, never> = {}): string | undefined {
  const record = typeof provider === 'object' && provider !== null ? provider as Record<string, unknown> : undefined;
  return record && PORT_METHODS.every(name => typeof record[name] === 'function') ? undefined : 'not an ObservabilityPort';
}

export const observabilityProviderContract: {
  readonly contract: 'observability';
  readonly validate: (required: { provider: unknown }, optional?: Record<string, never>) => string | undefined;
  readonly context: {
    readonly redactOperationAttributes: typeof redactOperationAttributes;
    readonly errorType: typeof errorType;
    readonly redactLabel: typeof redactLabel;
    readonly describeReportedError: typeof describeReportedError;
    readonly describeTelemetryFailure: typeof describeTelemetryFailure;
    readonly resolveObservabilityConfig: typeof resolveObservabilityConfig;
  };
} = {
  contract: 'observability',
  validate: observabilityPortProblem,
  context: { redactOperationAttributes, errorType, redactLabel, describeReportedError, describeTelemetryFailure, resolveObservabilityConfig },
};
