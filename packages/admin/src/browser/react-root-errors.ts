import type { BrowserTelemetry } from './telemetry.js';

/**
 * Preserves the host's error reporting when overriding React's root handlers, then sends telemetry.
 * The telemetry call runs even if reporting throws; reporting errors still propagate to the caller.
 */
export function createReactRootErrorHandlers(
  { telemetry, report }: {
    telemetry: Pick<BrowserTelemetry, 'reportError'>;
    report: (required: { error: unknown }, optional?: Record<string, never>) => void;
  },
  _optional: Record<string, never> = {},
): {
  onCaughtError: (error: unknown, info: { componentStack?: string }) => void;
  onUncaughtError: (error: unknown, info: { componentStack?: string }) => void;
} {
  const handle = (error: unknown, info: { componentStack?: string }): void => {
    try {
      report({ error });
    } finally {
      telemetry.reportError({ error, componentStack: info.componentStack });
    }
  };
  return { onCaughtError: handle, onUncaughtError: handle };
}
