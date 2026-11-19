import { describe, expect, it, vi } from 'vitest';
import { createReactRootErrorHandlers } from '../react-root-errors.js';

describe('createReactRootErrorHandlers', () => {
  it.each(['onCaughtError', 'onUncaughtError'] as const)('%s reports before telemetry with the same error and component stack', (handler) => {
    const calls: unknown[] = [];
    const error = new Error('render failed');
    const report = vi.fn((input: { error: unknown }) => { calls.push(['report', input]); });
    const reportError = vi.fn((input: { error: unknown; componentStack?: string | undefined }) => { calls.push(['telemetry', input]); });
    const handlers = createReactRootErrorHandlers({ report, telemetry: { reportError } });
    handlers[handler](error, { componentStack: 'Panel' });
    expect(calls).toEqual([['report', { error }], ['telemetry', { error, componentStack: 'Panel' }]]);
    expect(report.mock.calls[0]?.[0].error).toBe(error);
    expect(reportError.mock.calls[0]?.[0].error).toBe(error);
  });

  it.each(['onCaughtError', 'onUncaughtError'] as const)('%s still calls telemetry when report throws', (handler) => {
    const error = new Error('render failed');
    const reportError = vi.fn();
    const reportFailure = new Error('report failed');
    const handlers = createReactRootErrorHandlers({
      report: () => { throw reportFailure; }, telemetry: { reportError },
    });
    expect(() => handlers[handler](error, {})).toThrow(reportFailure);
    expect(reportError.mock.calls).toEqual([[{ error, componentStack: undefined }]]);
  });
});
