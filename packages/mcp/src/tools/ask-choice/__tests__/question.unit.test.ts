import { describe, expect, it } from 'vitest';
import { matchesOptions, parseQuestion, QuestionShapeError } from '../question.js';
import type { AskChoiceQuestion } from '../types.js';

const parse = (input: Record<string, unknown>) => parseQuestion({ input, toolId: 'ask' });

describe('parseQuestion flat form', () => {
  it.each([undefined, 7, '', '   '])('refuses a missing or blank question (%j)', (question) => {
    expect(() => parse({ question, options: [{ label: 'One' }] })).toThrow(new QuestionShapeError({ message: "ask: 'question' is required." }));
  });

  it('refuses a non-boolean multiple flag', () => {
    expect(() => parse({ question: 'Pick', options: [{ label: 'One' }], multiple: 'yes' }))
      .toThrow("ask: 'multiple' must be a boolean.");
  });

  it('keeps a string description and an explicit single-select flag', () => {
    expect(parse({ question: 'Pick', description: 'Why', multiple: false, options: [{ label: 'One', value: 'one' }] })).toEqual({
      title: 'Pick', description: 'Why', singleSelect: { label: 'Pick', options: [{ value: 'one', label: 'One' }] },
    });
  });

  it('passes non-array options through so the select shape check names the real problem', () => {
    expect(() => parse({ question: 'Pick', options: 'One, Two' }))
      .toThrow("ask: 'singleSelect' requires a non-empty 'label' and at least one option.");
  });

  it('passes non-object option entries through so the option check refuses them', () => {
    for (const entry of ['One', null, ['One']]) {
      expect(() => parse({ question: 'Pick', options: [entry] }))
        .toThrow("ask: every 'singleSelect' option requires a string 'value' and 'label'.");
    }
  });
});

describe('parseQuestion nested form', () => {
  it('keeps a string select hint and drops a non-string one', () => {
    expect(parse({ title: 'Pick', singleSelect: { label: 'Plan', hint: 'choose one', options: [{ value: 'a', label: 'A' }] } }).singleSelect)
      .toEqual({ label: 'Plan', hint: 'choose one', options: [{ value: 'a', label: 'A' }] });
    expect(parse({ title: 'Pick', singleSelect: { label: 'Plan', hint: 3, options: [{ value: 'a', label: 'A' }] } }).singleSelect)
      .toEqual({ label: 'Plan', options: [{ value: 'a', label: 'A' }] });
  });
});

describe('matchesOptions', () => {
  const multiOnly: AskChoiceQuestion = { title: 'Pick', multiSelect: { label: 'Tags', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] } };
  const singleOnly: AskChoiceQuestion = { title: 'Pick', singleSelect: { label: 'Plan', options: [{ value: 'x', label: 'X' }] } };

  it('refuses a single choice on a question that offered none', () => {
    expect(matchesOptions({ question: multiOnly, params: { choice: 'a' } })).toBe(false);
  });

  it('refuses selections that are not an array, and selections on a question with no multi-select', () => {
    expect(matchesOptions({ question: multiOnly, params: { selections: 'a' } })).toBe(false);
    expect(matchesOptions({ question: singleOnly, params: { choice: 'x', selections: ['x'] } })).toBe(false);
  });

  it('accepts only offered string selections', () => {
    expect(matchesOptions({ question: multiOnly, params: { selections: ['a', 'b'] } })).toBe(true);
    expect(matchesOptions({ question: multiOnly, params: { selections: ['a', 'c'] } })).toBe(false);
    expect(matchesOptions({ question: multiOnly, params: { selections: [1] } })).toBe(false);
  });
});
