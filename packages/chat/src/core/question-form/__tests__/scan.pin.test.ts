import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parsePartialQuestionForm } from '../scan.js';

// Labels carry escaped quotes and braces embedded in strings; none has an
// `id`, so a question surfaces only once its closing brace has streamed —
// which makes the closed-object count (balancedObjectEnd) observable.
const FORM = '<question-form>{"questions":[{"label":"say \\"}\\" {x"},{"label":"plain } {"},{"label":"third"}]}</question-form>';

const labels = (input: string) => (parsePartialQuestionForm({ input })?.questions ?? []).map((q) => q.label);

describe('balancedObjectEnd pin (via parsePartialQuestionForm)', () => {
  it('a brace inside a string is not structure: an unclosed object stays hidden', () => {
    const cut = FORM.indexOf('"plain } {"') + '"plain } {"'.length; // inside object 2, after its in-string braces
    expect(labels(FORM.slice(0, cut))).toEqual(['say "}" {x']);
  });

  it('an object closes only at its real closing brace', () => {
    const cut = FORM.indexOf('"plain } {"}') + '"plain } {"}'.length;
    expect(labels(FORM.slice(0, cut))).toEqual(['say "}" {x', 'plain } {']);
  });

  it('a truncated string literal leaves the trailing object unclosed', () => {
    expect(labels(FORM.slice(0, FORM.indexOf('"third"') + 4))).toEqual(['say "}" {x', 'plain } {']);
  });

  it('every prefix of the form matches the recorded baseline', () => {
    const rows = Array.from({ length: FORM.length + 1 }, (_, i) => labels(FORM.slice(0, i)));
    const digest = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
    expect(digest).toBe('5f71f0b7059817203012595bef83d808410702c7765a07f3f0ef26076bc03ad0');
  });
});
