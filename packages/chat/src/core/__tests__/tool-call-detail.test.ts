import { describe, expect, it } from 'vitest';
import { describeToolCallDetail } from '../index.js';

/**
 * Every tool row in the chat expands to show what the agent sent and what came back — including a
 * call still waiting on its result (an `assistant_ask_choice` waiting on the person's answer), a CLI
 * built-in (WebFetch, Grep, …), and a call whose run ended before it returned.
 */
describe('describeToolCallDetail', () => {
  it('pretty-prints an object input and shows a pending call as waiting', () => {
    const detail = describeToolCallDetail({ input: { title: 'Rebuild', options: [{ value: 'pages' }] } }, { runStreaming: true });
    expect(detail).toEqual({
      inputText: JSON.stringify({ title: 'Rebuild', options: [{ value: 'pages' }] }, null, 2),
      outputText: null,
      noteKey: 'Waiting for the result or answer…',
    });
  });

  it('shows the answer a card tool returned once it has one, re-indented', () => {
    const detail = describeToolCallDetail({ input: { title: 'Pick' }, result: { content: '{"selected":"pages"}', isError: false } }, { runSucceeded: true });
    expect(detail.outputText).toBe(JSON.stringify({ selected: 'pages' }, null, 2));
    expect(detail.noteKey).toBeNull();
  });

  it('keeps an error result visible as the output', () => {
    const detail = describeToolCallDetail({ input: { url: 'https://x.test' }, result: { content: 'fetch failed: 404', isError: true } });
    expect(detail.outputText).toBe('fetch failed: 404');
    expect(detail.noteKey).toBeNull();
  });

  it('notes an error result that carried no message', () => {
    const detail = describeToolCallDetail({ input: {}, result: { content: '  ', isError: true } });
    expect(detail.outputText).toBeNull();
    expect(detail.noteKey).toBe('Failed without an error message.');
  });

  it('notes a successful result that carried no output', () => {
    const detail = describeToolCallDetail({ input: {}, result: { content: '', isError: false } });
    expect(detail.outputText).toBeNull();
    expect(detail.noteKey).toBe('Finished with no output.');
  });

  it('notes a run that ended before the call returned', () => {
    expect(describeToolCallDetail({ input: {} }).noteKey).toBe('The run ended before this call returned a result.');
  });

  it('notes a finished run that recorded no result for the call', () => {
    expect(describeToolCallDetail({ input: {} }, { runSucceeded: true }).noteKey).toBe('No result was recorded for this call.');
  });

  it('prefers the waiting note over the run outcome while the run is still streaming', () => {
    expect(describeToolCallDetail({ input: {} }, { runStreaming: true, runSucceeded: false }).noteKey).toBe('Waiting for the result or answer…');
  });

  it('shows a string input as given, re-indenting it only when it is a JSON object', () => {
    expect(describeToolCallDetail({ input: 'raw text' }).inputText).toBe('raw text');
    expect(describeToolCallDetail({ input: '{"a":1}' }).inputText).toBe(JSON.stringify({ a: 1 }, null, 2));
  });

  it('serializes a scalar input', () => {
    expect(describeToolCallDetail({ input: 42 }).inputText).toBe('42');
    expect(describeToolCallDetail({ input: false }).inputText).toBe('false');
  });

  it('shows no input for a missing or unserializable one', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(describeToolCallDetail({ input: null }).inputText).toBeNull();
    expect(describeToolCallDetail({ input: undefined }).inputText).toBeNull();
    expect(describeToolCallDetail({ input: circular }).inputText).toBeNull();
    expect(describeToolCallDetail({ input: () => 1 }).inputText).toBeNull();
  });

  it('redacts credentials in both the input and the output with the chat text policy', () => {
    const key = 'sk-' + 'AbCdEf0123456789'.repeat(2);
    const detail = describeToolCallDetail({ input: { apiKey: key }, result: { content: `saved ${key}`, isError: false } });
    expect(detail.inputText).not.toContain(key);
    expect(detail.inputText).toContain('[token removed]');
    expect(detail.outputText).toBe('saved [token removed]');
  });

  it('uses an injected redactor instead of the default policy', () => {
    const detail = describeToolCallDetail({ input: 'abc', result: { content: 'def', isError: false } }, { redact: ({ text }) => ({ text: text.toUpperCase(), secretRedacted: false, count: 0 }) });
    expect(detail.inputText).toBe('ABC');
    expect(detail.outputText).toBe('DEF');
  });

  it('truncates an input or output longer than the cap with an ellipsis', () => {
    const detail = describeToolCallDetail({ input: 'x'.repeat(30), result: { content: 'y'.repeat(30), isError: false } }, { maxChars: 10 });
    expect(detail.inputText).toBe('x'.repeat(9) + '…');
    expect(detail.outputText).toBe('y'.repeat(9) + '…');
  });

  it('leaves text at exactly the cap untouched', () => {
    expect(describeToolCallDetail({ input: 'x'.repeat(10) }, { maxChars: 10 }).inputText).toBe('x'.repeat(10));
  });
});
