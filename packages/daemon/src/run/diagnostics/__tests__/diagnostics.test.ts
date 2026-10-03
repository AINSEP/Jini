import { describe, expect, it } from 'vitest';
import {
  collectStderrTailSummary,
  collectStdoutTailSummary,
  stderrLineCountBucket,
  summarizeRunDiagnosticsForAnalytics,
} from '../diagnostics.js';
import type { RunEventForDiagnostics } from '../diagnostics.js';

describe('stderrLineCountBucket', () => {
  it('maps line counts to low-cardinality buckets across every boundary', () => {
    expect(stderrLineCountBucket({ count: 0 })).toBe('none');
    expect(stderrLineCountBucket({ count: -1 })).toBe('none');
    expect(stderrLineCountBucket({ count: 5 })).toBe('1_5');
    expect(stderrLineCountBucket({ count: 6 })).toBe('6_20');
    expect(stderrLineCountBucket({ count: 20 })).toBe('6_20');
    expect(stderrLineCountBucket({ count: 21 })).toBe('21_100');
    expect(stderrLineCountBucket({ count: 100 })).toBe('21_100');
    expect(stderrLineCountBucket({ count: 101 })).toBe('gt_100');
  });
});

describe('collectStderrTailSummary', () => {
  it('returns undefined when called with no events and when no stderr was recorded', () => {
    expect(collectStderrTailSummary({  })).toBeUndefined();
    expect(collectStderrTailSummary({  }, { events: [{ event: 'stdout', data: 'x\n' }] })).toBeUndefined();
  });

  it('accumulates stderr chunks from string, {chunk}, and {text} shapes, ignoring other data', () => {
    const events: RunEventForDiagnostics[] = [
      { event: 'stderr', data: 'a line\n' },
      { event: 'stderr', data: { chunk: 'b line\n' } },
      { event: 'stderr', data: { text: 'c line\n' } },
      { event: 'stderr', data: {} }, // yields null chunk → skipped
      { event: 'stderr', data: null }, // falsy → null chunk → skipped
      { event: 'stderr', data: ['nope'] }, // array → null chunk → skipped
      { event: 'agent', data: 'ignored' },
    ];
    const summary = collectStderrTailSummary({  }, { events: events });
    expect(summary).toEqual({ tail: 'a line\nb line\nc line', lineCount: 3, truncated: false });
  });

  it('applies the injected redactor to the collected tail', () => {
    const summary = collectStderrTailSummary({  }, { events: [{ event: 'stderr', data: 'token=SECRET-VALUE now\n' }], redact: ({ text }) => text.replace(/SECRET-\w+/g, '[REDACTED]') }
    );
    expect(summary?.tail).toBe('token=[REDACTED] now');
  });

  it('keeps only the last 20 lines and flags line truncation', () => {
    const data = Array.from({ length: 25 }, (_, i) => `line-${i}`).join('\n') + '\n';
    const summary = collectStderrTailSummary({  }, { events: [{ event: 'stderr', data }] });
    expect(summary?.lineCount).toBe(25);
    expect(summary?.truncated).toBe(true);
    expect(summary?.tail.split('\n')).toHaveLength(20);
    expect(summary?.tail.startsWith('line-5')).toBe(true);
  });

  it('byte-caps a single oversized line and flags truncation', () => {
    const summary = collectStderrTailSummary({  }, { events: [{ event: 'stderr', data: 'x'.repeat(5000) + '\n' }] });
    expect(summary?.lineCount).toBe(1);
    expect(summary?.truncated).toBe(true);
    expect(Buffer.byteLength(summary?.tail ?? '', 'utf8')).toBeLessThanOrEqual(4 * 1024);
  });
});

describe('collectStdoutTailSummary', () => {
  it('reads stdout chunks from every recognized shape and ignores the rest', () => {
    const events: RunEventForDiagnostics[] = [
      { event: 'stdout', data: 'out-1\n' },
      { event: 'stdout', data: { chunk: 'out-2\n' } },
      { event: 'stdout', data: { text: 'out-3\n' } },
      { event: 'stdout', data: {} },
      { event: 'stdout', data: null },
      { event: 'stdout', data: [1, 2] },
    ];
    expect(collectStdoutTailSummary({  }, { events: events })).toEqual({
      tail: 'out-1\nout-2\nout-3',
      lineCount: 3,
      truncated: false,
    });
    expect(collectStdoutTailSummary({  })).toBeUndefined();
  });
});

const BASE = {
  diagnostic_source: 'unknown',
  stderr_present: false,
  stderr_line_count_bucket: 'none',
  stdout_present: false,
  stdout_line_count_bucket: 'none',
  rpc_close_reason: 'unknown',
  first_token_seen: false,
  user_visible_output_seen: false,
  tool_call_seen: false,
  artifact_write_seen: false,
  live_artifact_seen: false,
  resume_auto_reseeded: false,
} as const;

describe('summarizeRunDiagnosticsForAnalytics', () => {
  it('returns all-default diagnostics for an empty (undefined-events) run', () => {
    expect(summarizeRunDiagnosticsForAnalytics({})).toEqual(BASE);
  });

  it('prefers an error event as the diagnostic source', () => {
    const out = summarizeRunDiagnosticsForAnalytics({ events: [{ event: 'error', data: {} }] });
    expect(out.diagnostic_source).toBe('error_event');
  });

  it('falls back to stderr, then signal, then exit code for the diagnostic source', () => {
    expect(
      summarizeRunDiagnosticsForAnalytics({ events: [{ event: 'stderr', data: 'boom\n' }] }),
    ).toMatchObject({ diagnostic_source: 'stderr', stderr_present: true, stderr_line_count_bucket: '1_5' });
    expect(summarizeRunDiagnosticsForAnalytics({ signal: 'SIGTERM' })).toMatchObject({
      diagnostic_source: 'signal',
    });
    expect(summarizeRunDiagnosticsForAnalytics({ exitCode: 2 })).toMatchObject({
      diagnostic_source: 'exit_code',
    });
  });

  it('derives the rpc close reason from process-level signals in priority order', () => {
    expect(summarizeRunDiagnosticsForAnalytics({ cancelRequested: true }).rpc_close_reason).toBe(
      'cancel_requested',
    );
    expect(summarizeRunDiagnosticsForAnalytics({ fatalRpcErrorSeen: true }).rpc_close_reason).toBe(
      'fatal_rpc_error',
    );
    expect(summarizeRunDiagnosticsForAnalytics({ streamErrorSeen: true }).rpc_close_reason).toBe(
      'stream_error',
    );
    expect(summarizeRunDiagnosticsForAnalytics({ emptyOutputFailure: true }).rpc_close_reason).toBe(
      'empty_output',
    );
    expect(summarizeRunDiagnosticsForAnalytics({ signal: 'SIGKILL' }).rpc_close_reason).toBe('signal');
    expect(summarizeRunDiagnosticsForAnalytics({ exitCode: 0 }).rpc_close_reason).toBe('exit_0');
    expect(summarizeRunDiagnosticsForAnalytics({ exitCode: 3 }).rpc_close_reason).toBe('exit_nonzero');
  });

  it('lets a recorded runtime_close reason win over derived signals', () => {
    const out = summarizeRunDiagnosticsForAnalytics({
      cancelRequested: true,
      events: [{ event: 'diagnostic', data: { type: 'runtime_close', rpc_close_reason: 'stream_error' } }],
    });
    expect(out.rpc_close_reason).toBe('stream_error');
  });

  it('ignores an unrecognized or non-string runtime_close reason', () => {
    expect(
      summarizeRunDiagnosticsForAnalytics({
        exitCode: 4,
        events: [{ event: 'diagnostic', data: { type: 'runtime_close', rpc_close_reason: 'bogus' } }],
      }).rpc_close_reason,
    ).toBe('exit_nonzero');
    expect(
      summarizeRunDiagnosticsForAnalytics({
        exitCode: 4,
        events: [{ event: 'diagnostic', data: { type: 'runtime_close', rpc_close_reason: 5 } }],
      }).rpc_close_reason,
    ).toBe('exit_nonzero');
  });

  it('flags user-visible output from stdout chunks and text/thinking deltas', () => {
    const stdout = summarizeRunDiagnosticsForAnalytics({
      events: [
        { event: 'stdout', data: 'visible\n' },
        { event: 'stdout', data: {} }, // null chunk → not accumulated
      ],
    });
    expect(stdout).toMatchObject({ user_visible_output_seen: true, stdout_present: true });

    const delta = summarizeRunDiagnosticsForAnalytics({
      events: [{ event: 'agent', data: { type: 'text_delta', delta: 'hi' } }],
    });
    expect(delta.user_visible_output_seen).toBe(true);
  });

  it('does not flag user-visible output for an empty or non-string thinking delta', () => {
    const out = summarizeRunDiagnosticsForAnalytics({
      events: [
        { event: 'agent', data: { type: 'thinking_delta', delta: '' } },
        { event: 'agent', data: { type: 'text_delta', delta: 42 } },
      ],
    });
    expect(out.user_visible_output_seen).toBe(false);
  });

  it('detects tool calls, artifact writes, live artifacts, and resume auto-reseed from events', () => {
    const out = summarizeRunDiagnosticsForAnalytics({
      events: [
        { event: 'agent', data: { type: 'tool_use' } },
        { event: 'agent', data: { type: 'artifact' } },
        { event: 'agent', data: { type: 'live_artifact' } },
        { event: 'diagnostic', data: { type: 'agent_resume_auto_reseed' } },
      ],
    });
    expect(out).toMatchObject({
      tool_call_seen: true,
      artifact_write_seen: true,
      live_artifact_seen: true,
      resume_auto_reseeded: true,
    });
  });

  it('detects a live artifact from a bare live_artifact event and honors caller-supplied flags', () => {
    const fromEvent = summarizeRunDiagnosticsForAnalytics({ events: [{ event: 'live_artifact', data: {} }] });
    expect(fromEvent.live_artifact_seen).toBe(true);

    const fromArgs = summarizeRunDiagnosticsForAnalytics({
      artifactWriteSeen: true,
      liveArtifactSeen: true,
      firstTokenSeen: true,
    });
    expect(fromArgs).toMatchObject({
      artifact_write_seen: true,
      live_artifact_seen: true,
      first_token_seen: true,
    });
  });
});
