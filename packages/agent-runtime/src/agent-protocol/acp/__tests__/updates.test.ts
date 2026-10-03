import { describe, expect, it } from 'vitest';
import {
  acpRawEventShape,
  acpUpdateStatus,
  isAcpCompletedStatus,
  isAcpTerminalFailureStatus,
  isAcpRetryStatus,
  acpUpdateDiagnosticText,
  promotedAmrRetryStatusPayload,
  promotedAmrStderrPayload,
  acpToolCallId,
  isAcpArtifactWriteLabel,
  isAcpArtifactWriteUpdate,
  acpArtifactWritePath,
} from '../updates.js';
import type { AccountFailureClassifier } from '../account-failure.js';

describe('acpRawEventShape', () => {
  it('summarises a rich update object', () => {
    const shape = acpRawEventShape({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'hi' },
      rawInput: { path: 'a.txt' },
      locations: [{ path: 'a.txt' }],
      text: 'hi',
      delta: 'd',
      message: {},
      toolCallId: 'tc-1',
      status: 'completed',
      title: 'Edit file',
    });
    expect(shape.sessionUpdate).toBe('agent_message_chunk');
    expect(shape.contentKind).toBe('object');
    expect(shape.hasText).toBe(true);
    expect(shape.hasTopLevelText).toBe(true);
    expect(shape.hasTopLevelDelta).toBe(true);
    expect(shape.hasTopLevelMessage).toBe(true);
    expect(shape.hasToolCallId).toBe(true);
    expect(shape.hasRawInput).toBe(true);
    expect(shape.rawInputKind).toBe('object');
    expect(shape.locationsKind).toBe('array');
    expect(shape.locationsCount).toBe(1);
    expect(shape.status).toBe('completed');
    expect(shape.titlePresent).toBe(true);
  });

  it('handles a minimal/empty update', () => {
    const shape = acpRawEventShape({});
    expect(shape.sessionUpdate).toBeNull();
    expect(shape.hasText).toBe(false);
    expect(shape.hasTopLevelText).toBe(false);
    expect(shape.hasTopLevelDelta).toBe(false);
    expect(shape.hasTopLevelMessage).toBe(false);
    expect(shape.hasToolCallId).toBe(false);
    expect(shape.hasRawInput).toBe(false);
    expect(shape.locationsCount).toBeUndefined();
    expect(shape.status).toBeUndefined();
    expect(shape.titlePresent).toBe(false);
  });
});

describe('acpUpdateStatus', () => {
  it('normalises status to a lowercase token', () => {
    expect(acpUpdateStatus({ status: '  In Progress ' })).toBe('inprogress');
    expect(acpUpdateStatus({ status: 'in_progress-now' })).toBe('inprogressnow');
  });

  it('returns "" when status is absent or not a string', () => {
    expect(acpUpdateStatus({})).toBe('');
    expect(acpUpdateStatus({ status: 42 })).toBe('');
  });
});

describe('isAcpCompletedStatus', () => {
  it('recognises all completed synonyms', () => {
    for (const status of ['completed', 'complete', 'succeeded', 'success']) {
      expect(isAcpCompletedStatus({ status })).toBe(true);
    }
  });
  it('rejects other statuses', () => {
    expect(isAcpCompletedStatus({ status: 'pending' })).toBe(false);
  });
});

describe('isAcpTerminalFailureStatus', () => {
  it('recognises all failure synonyms', () => {
    for (const status of ['failed', 'failure', 'error', 'cancelled', 'canceled']) {
      expect(isAcpTerminalFailureStatus({ status })).toBe(true);
    }
  });
  it('rejects other statuses', () => {
    expect(isAcpTerminalFailureStatus({ status: 'completed' })).toBe(false);
  });
});

describe('isAcpRetryStatus', () => {
  it('matches only "retry"', () => {
    expect(isAcpRetryStatus({ status: 'retry' })).toBe(true);
    expect(isAcpRetryStatus({ status: 'other' })).toBe(false);
  });
});

describe('acpUpdateDiagnosticText', () => {
  it('collects trimmed non-empty strings', () => {
    expect(acpUpdateDiagnosticText('  hi  ')).toEqual(['  hi  ']);
    expect(acpUpdateDiagnosticText('   ')).toEqual([]);
  });

  it('stringifies numbers and booleans', () => {
    expect(acpUpdateDiagnosticText(42)).toEqual(['42']);
    expect(acpUpdateDiagnosticText(true)).toEqual(['true']);
  });

  it('returns [] for null/undefined/non-plain values', () => {
    expect(acpUpdateDiagnosticText(null)).toEqual([]);
    expect(acpUpdateDiagnosticText(undefined)).toEqual([]);
  });

  it('flattens arrays', () => {
    expect(acpUpdateDiagnosticText(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('walks known diagnostic keys on an object, skipping unknown keys', () => {
    expect(
      acpUpdateDiagnosticText({
        type: 'x',
        status: 'retry',
        code: 'E1',
        message: 'm',
        detail: 'd1',
        details: 'd2',
        error: 'e',
        recovery: 'r',
        pauseReason: 'p',
        content: 'c',
        text: 't',
        rawInput: 'ri',
        unrelatedKey: 'should not appear',
      }),
    ).toEqual(['x', 'retry', 'E1', 'm', 'd1', 'd2', 'e', 'r', 'p', 'c', 't', 'ri']);
  });

  it('stops recursing past depth 4', () => {
    const deep = { message: { message: { message: { message: { message: 'too deep' } } } } };
    expect(acpUpdateDiagnosticText(deep)).toEqual([]);
  });
});

const matchingClassifier: AccountFailureClassifier = {
  classify: ({ text }) =>
    text.includes('insufficient')
      ? { code: 'INSUFFICIENT_BALANCE', message: 'Please recharge.', action: 'recharge', actionUrl: 'https://example.com/wallet' }
      : null,
};

describe('promotedAmrRetryStatusPayload', () => {
  it('returns null when the update is not a retry status', () => {
    expect(promotedAmrRetryStatusPayload({ status: 'completed' })).toBeNull();
  });

  it('returns null under the default no-op classifier even for retry status', () => {
    expect(promotedAmrRetryStatusPayload({ status: 'retry', message: 'insufficient balance' })).toBeNull();
  });

  it('returns null when a real classifier is injected but finds no match', () => {
    expect(
      promotedAmrRetryStatusPayload({ status: 'retry', message: 'unrelated' }, matchingClassifier),
    ).toBeNull();
  });

  it('promotes a retry status to a structured payload when the injected classifier matches', () => {
    const payload = promotedAmrRetryStatusPayload(
      { status: 'retry', message: 'insufficient balance detected' },
      matchingClassifier,
    );
    expect(payload).toEqual({
      message: 'Please recharge.',
      error: {
        code: 'INSUFFICIENT_BALANCE',
        message: 'Please recharge.',
        retryable: false,
        details: {
          kind: 'account_failure',
          action: 'recharge',
          actionUrl: 'https://example.com/wallet',
          promoted_by: 'agent_runtime_acp_retry_status',
        },
      },
    });
  });
});

describe('promotedAmrStderrPayload', () => {
  it('returns null when the chunk lacks the expected marker phrases', () => {
    expect(promotedAmrStderrPayload('just some noise', matchingClassifier)).toBeNull();
  });

  it('returns null when the marker is present but "retry" is not', () => {
    expect(promotedAmrStderrPayload('opencode_event_stream_failure happened', matchingClassifier)).toBeNull();
  });

  it('returns null under the default no-op classifier', () => {
    expect(
      promotedAmrStderrPayload('opencode_event_stream_failure retry insufficient balance'),
    ).toBeNull();
  });

  it('returns null when the classifier finds no match despite the markers', () => {
    expect(
      promotedAmrStderrPayload('session.status retry unrelated text', matchingClassifier),
    ).toBeNull();
  });

  it('promotes a matching stderr chunk using either marker phrase', () => {
    const payload = promotedAmrStderrPayload(
      'opencode_event_stream_failure: retry — insufficient balance',
      matchingClassifier,
    );
    expect(payload?.error.code).toBe('INSUFFICIENT_BALANCE');
    expect(payload?.error.details.promoted_by).toBe('agent_runtime_acp_stderr_retry_status');

    const payload2 = promotedAmrStderrPayload(
      'session.status: retry due to insufficient balance',
      matchingClassifier,
    );
    expect(payload2?.error.code).toBe('INSUFFICIENT_BALANCE');
  });
});

describe('acpToolCallId', () => {
  it('returns a trimmed id when present', () => {
    expect(acpToolCallId({ toolCallId: '  tc-1  ' })).toBe('tc-1');
  });
  it('returns null when absent, blank, or not a string', () => {
    expect(acpToolCallId({})).toBeNull();
    expect(acpToolCallId({ toolCallId: '   ' })).toBeNull();
    expect(acpToolCallId({ toolCallId: 42 })).toBeNull();
  });
});

describe('isAcpArtifactWriteLabel', () => {
  it('matches known write verbs in title or name', () => {
    for (const verb of ['edit', 'write', 'create', 'update', 'save', 'patch', 'replace']) {
      expect(isAcpArtifactWriteLabel({ title: `${verb} file` })).toBe(true);
      expect(isAcpArtifactWriteLabel({ name: verb })).toBe(true);
    }
  });
  it('does not match unrelated labels', () => {
    expect(isAcpArtifactWriteLabel({ title: 'read file' })).toBe(false);
    expect(isAcpArtifactWriteLabel({})).toBe(false);
  });
});

describe('isAcpArtifactWriteUpdate', () => {
  it('requires completed status', () => {
    expect(isAcpArtifactWriteUpdate({ status: 'in_progress', title: 'write x' }, new Set())).toBe(false);
  });

  it('matches when completed and the label looks like a write', () => {
    expect(isAcpArtifactWriteUpdate({ status: 'completed', title: 'write x' }, new Set())).toBe(true);
  });

  it('matches when completed and the toolCallId is tracked as a write', () => {
    expect(
      isAcpArtifactWriteUpdate({ status: 'completed', toolCallId: 'tc-1', title: 'read x' }, new Set(['tc-1'])),
    ).toBe(true);
  });

  it('returns false when completed but neither the label nor a tracked id matches', () => {
    expect(isAcpArtifactWriteUpdate({ status: 'completed', title: 'read x' }, new Set())).toBe(false);
  });

  it('returns false when completed, label is not a write, and toolCallId is absent', () => {
    expect(isAcpArtifactWriteUpdate({ status: 'completed' }, new Set())).toBe(false);
  });
});

describe('acpArtifactWritePath', () => {
  it('extracts a path from the locations array', () => {
    expect(acpArtifactWritePath({ locations: [{ path: 'a.txt' }] })).toBe('a.txt');
  });

  it('extracts a path from the content array', () => {
    expect(acpArtifactWritePath({ content: [{ type: 'diff', path: 'b.txt' }] })).toBe('b.txt');
  });

  it('skips array entries without a usable path', () => {
    expect(acpArtifactWritePath({ locations: [{}, { path: '  ' }, { path: 'c.txt' }] })).toBe('c.txt');
  });

  it('falls back to rawInput.path/file_path/filename', () => {
    expect(acpArtifactWritePath({ rawInput: { path: 'd.txt' } })).toBe('d.txt');
    expect(acpArtifactWritePath({ rawInput: { file_path: 'e.txt' } })).toBe('e.txt');
    expect(acpArtifactWritePath({ rawInput: { filename: 'f.txt' } })).toBe('f.txt');
  });

  it('falls back to a filename token embedded in the title', () => {
    expect(acpArtifactWritePath({ title: 'Write index.html please' })).toBe('index.html');
  });

  it('returns null when nothing usable is present', () => {
    expect(acpArtifactWritePath({ title: 'edit the config' })).toBeNull();
    expect(acpArtifactWritePath({})).toBeNull();
  });

  it('ignores non-array locations/content fields', () => {
    expect(acpArtifactWritePath({ locations: 'nope', content: 'nope', rawInput: {} })).toBeNull();
  });

  it('treats an empty locations/content array as no match and continues to the next source', () => {
    expect(acpArtifactWritePath({ locations: [], content: [], rawInput: { path: 'g.txt' } })).toBe('g.txt');
  });
});
