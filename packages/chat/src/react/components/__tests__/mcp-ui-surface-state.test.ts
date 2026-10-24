import { describe, expect, it, vi } from 'vitest';
import { isDeliveredAnswer, reportDeliveredAnswer } from '../mcp-ui-surface-state.js';

const CALL = { name: 'deployment_execute_static_publish', arguments: { __exchangeId: 'x1', decision: 'confirm' } };

describe('delivered answers (owner, 2026-10-11: "Waiting for your answer" outlived the click)', () => {
  it('reports offered labels before closing a delivered choice, without exposing callback bookkeeping', async () => {
    const reports: string[] = [];
    const handler = reportDeliveredAnswer({
      onToolCall: async () => ({ delivered: true }),
      onAnswerText: text => reports.push(text), onAnswered: () => reports.push('closed'),
      input: { question: 'When?', options: [{ value: 'preview', label: 'Preview the changes' }, { value: 'later', label: 'Remind me later' }] },
    });
    await handler({ name: 'answer', arguments: { __exchangeId: 'private', selections: ['preview', 'later'] } });
    expect(reports).toEqual(['Preview the changes, Remind me later', 'closed']);
  });

  it('reads only the route\'s {delivered: true} receipt as a delivered answer', () => {
    expect(isDeliveredAnswer({ delivered: true })).toBe(true);
    expect(isDeliveredAnswer({ delivered: false })).toBe(false);
    expect(isDeliveredAnswer({ ok: true })).toBe(false);
    expect(isDeliveredAnswer('delivered')).toBe(false);
    expect(isDeliveredAnswer(null)).toBe(false);
  });

  it('reports a delivered answer once and passes the result through unchanged', async () => {
    const onAnswered = vi.fn();
    const handler = reportDeliveredAnswer({ onToolCall: async () => ({ delivered: true }), onAnswered });
    await expect(handler(CALL)).resolves.toEqual({ delivered: true });
    expect(onAnswered).toHaveBeenCalledTimes(1);
  });

  it('reports nothing for an ordinary result or a rejected call', async () => {
    const onAnswered = vi.fn();
    await expect(reportDeliveredAnswer({ onToolCall: () => ({ rows: [] }), onAnswered })(CALL)).resolves.toEqual({ rows: [] });
    const failing = reportDeliveredAnswer({ onToolCall: async () => { throw new Error('expired'); }, onAnswered });
    await expect(failing(CALL)).rejects.toThrow('expired');
    expect(onAnswered).not.toHaveBeenCalled();
  });
});
