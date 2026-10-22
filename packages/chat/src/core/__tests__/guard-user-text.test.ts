import { describe, expect, it } from 'vitest';
import { guardUserText } from '../user-text-redaction.js';

const modelNote = 'Open the secure credential card and ask the user to rotate the removed key.';
describe('guardUserText model guidance', () => {
  it('redacts first and adds the host note only after a redaction', () => {
    expect(guardUserText({ text: 'Connect api_key=x please' }, { modelNote })).toBe(`Connect api_key=[token removed] please\n\n${modelNote}`);
    expect(guardUserText({ text: 'Connect my account' }, { modelNote })).toBe('Connect my account');
    expect(guardUserText({ text: 'Connect api_key=x' }, {})).toBe('Connect api_key=[token removed]');
    expect(guardUserText({ text: 'Connect api_key=x' }, { modelNote: '' })).toBe('Connect api_key=[token removed]');
  });
  it('uses the signal rather than the placeholder text', () => {
    expect(guardUserText({ text: 'Explain [token removed]' }, { modelNote })).toBe('Explain [token removed]');
    expect(guardUserText({ text: 'host format' }, { modelNote,
      redactUserText: () => ({ text: '<removed>', secretRedacted: true, count: 1 }),
    })).toBe(`<removed>\n\n${modelNote}`);
  });
  it('retains the signal from an earlier boundary and adds a note at most once', () => {
    const once = guardUserText({ text: 'Connect [token removed]' }, { modelNote, secretRedacted: true });
    expect(once).toBe(`Connect [token removed]\n\n${modelNote}`);
    expect(guardUserText({ text: once }, { modelNote, secretRedacted: true })).toBe(once);
    expect(guardUserText({ text: 'Connect [token removed]' }, { modelNote, secretRedacted: false })).toBe('Connect [token removed]');
  });
});
