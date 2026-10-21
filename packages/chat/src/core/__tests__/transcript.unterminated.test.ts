import { describe, expect, it } from 'vitest';
import { sanitizePriorAssistantTurn } from '../transcript.js';

describe('sanitizePriorAssistantTurn with malformed form markup', () => {
  it('leaves an opener that never closes its tag untouched instead of rescanning it', () => {
    const content = 'Before <question-form id="q" and the text runs on';
    expect(sanitizePriorAssistantTurn({ content })).toBe(content);
  });

  it('still strips a complete form', () => {
    const content = 'Pick: <question-form>{"q":1}</question-form> done';
    expect(sanitizePriorAssistantTurn({ content })).not.toContain('{"q":1}');
  });
});
