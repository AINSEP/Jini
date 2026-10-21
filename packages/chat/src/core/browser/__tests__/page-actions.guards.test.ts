import { describe, expect, it } from 'vitest';
import { createBrowserPageActions } from '../page-actions.js';
import { questionTextareaProps, questionTextInputProps } from '../../question-form/secret-answers.js';

describe('createBrowserPageActions deadline guard', () => {
  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('refuses a highlight deadline of %s', (cleanupFallbackMs) => {
    expect(() => createBrowserPageActions({ cleanupFallbackMs } as Parameters<typeof createBrowserPageActions>[0])).toThrow('Invalid highlight deadline');
  });
});

describe('question field presentation', () => {
  it('masks only secret-looking text questions', () => {
    const secret = { id: 'apiKey', label: 'API key', type: 'textarea' as const };
    const plain = { id: 'notes', label: 'Notes', type: 'textarea' as const };
    expect(questionTextareaProps({ question: secret })).toEqual({ autoComplete: 'off', spellCheck: false, style: { WebkitTextSecurity: 'disc', whiteSpace: 'pre-wrap' } });
    expect(questionTextareaProps({ question: plain })).toEqual({});
    expect(questionTextInputProps({ question: { ...plain, type: 'text' } })).toEqual({ type: 'text' });
  });
});
