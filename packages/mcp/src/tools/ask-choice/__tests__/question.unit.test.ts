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

// Stryker L3 (2026-10-25): 21 survivors — each validation conjunct was only broken together with
// others. Start from one valid question and break exactly one field per case; assert WHICH error.
describe('parseQuestion / matchesOptions — one broken clause per case (F3)', () => {
  const T = 'ask_choice';
  const opt = { value: 'a', label: 'A' };
  const legacy = (over: Record<string, unknown> = {}) => ({ title: 'Pick', singleSelect: { label: 'L', options: [opt, { value: 'b', label: 'B' }] }, ...over });
  const err = (input: Record<string, unknown>) => { try { parseQuestion({ input, toolId: T }); return 'no error'; } catch (e) { return `${(e as Error).constructor.name}: ${(e as Error).message}`; } };

  it.each([
    ['title missing', { title: undefined }, `QuestionShapeError: ${T}: 'title' is required.`],
    ['title empty', { title: '' }, `QuestionShapeError: ${T}: 'title' is required.`],
    ['title non-string', { title: 7 }, `QuestionShapeError: ${T}: 'title' is required.`],
    ['no select at all', { singleSelect: undefined }, `QuestionShapeError: ${T}: at least one of 'singleSelect' or 'multiSelect' is required.`],
    ['select is null', { singleSelect: null }, `QuestionShapeError: ${T}: 'singleSelect' must be an object.`],
    ['select is a string', { singleSelect: 'x' }, `QuestionShapeError: ${T}: 'singleSelect' must be an object.`],
    ['select label empty', { singleSelect: { label: '', options: [opt] } }, `QuestionShapeError: ${T}: 'singleSelect' requires a non-empty 'label' and at least one option.`],
    ['select label non-string', { singleSelect: { label: 1, options: [opt] } }, `QuestionShapeError: ${T}: 'singleSelect' requires a non-empty 'label' and at least one option.`],
    ['options not an array', { singleSelect: { label: 'L', options: { 0: opt } } }, `QuestionShapeError: ${T}: 'singleSelect' requires a non-empty 'label' and at least one option.`],
    ['options empty', { singleSelect: { label: 'L', options: [] } }, `QuestionShapeError: ${T}: 'singleSelect' requires a non-empty 'label' and at least one option.`],
    ['second option value empty', { singleSelect: { label: 'L', options: [opt, { value: '', label: 'B' }] } }, `QuestionShapeError: ${T}: every 'singleSelect' option requires a string 'value' and 'label'.`],
    ['second option label missing', { singleSelect: { label: 'L', options: [opt, { value: 'b' }] } }, `QuestionShapeError: ${T}: every 'singleSelect' option requires a string 'value' and 'label'.`],
    ['option value non-string', { singleSelect: { label: 'L', options: [{ value: 1, label: 'A' }] } }, `QuestionShapeError: ${T}: every 'singleSelect' option requires a string 'value' and 'label'.`],
    ['option is null', { singleSelect: { label: 'L', options: [null] } }, `QuestionShapeError: ${T}: every 'singleSelect' option requires a string 'value' and 'label'.`],
    ['bad multiSelect next to a good singleSelect', { multiSelect: { label: 'M', options: [] } }, `QuestionShapeError: ${T}: 'multiSelect' requires a non-empty 'label' and at least one option.`],
    ['flat + legacy mixed', { question: 'Q' }, `QuestionShapeError: ${T}: use {question, options, multiple?} or the legacy nested selects; do not mix them.`],
  ])('%s', (_label, over, expected) => {
    expect(err(legacy(over))).toBe(expected);
  });

  it.each([
    ['blank question', { question: '  ', options: [opt] }, `QuestionShapeError: ${T}: 'question' is required.`],
    ['non-boolean multiple', { question: 'Q', options: [opt], multiple: 'yes' }, `QuestionShapeError: ${T}: 'multiple' must be a boolean.`],
    ['only multiple given', { multiple: true }, `QuestionShapeError: ${T}: 'question' is required.`],
    ['only options given', { options: [opt] }, `QuestionShapeError: ${T}: 'question' is required.`],
  ])('flat form: %s', (_label, input, expected) => {
    expect(err(input)).toBe(expected);
  });

  it('flat form: label stands in for a missing value; optional fields are carried only when strings', () => {
    expect(parseQuestion({ input: { question: 'Q', options: [{ label: 'A' }, { value: 'b', label: 'B', description: 'd' }], multiple: true, description: 3, submitLabel: 'Go' }, toolId: T }))
      .toStrictEqual({ title: 'Q', submitLabel: 'Go', multiSelect: { label: 'Q', options: [{ value: 'A', label: 'A' }, { value: 'b', label: 'B', description: 'd' }] } });
    expect(parseQuestion({ input: { question: 'Q', options: [opt], multiple: false, description: 'D' }, toolId: T }))
      .toStrictEqual({ title: 'Q', description: 'D', singleSelect: { label: 'Q', options: [opt] } });
  });

  it.each([
    [{ choice: 'b' }, true], [{ choice: 'z' }, false], [{}, false],
    [{ choice: 'a', selections: ['x'] }, false],
  ])('single-select answer %j → %s', (params, expected) => {
    expect(matchesOptions({ question: parseQuestion({ input: legacy(), toolId: T }), params })).toBe(expected);
  });

  it.each([
    [{ selections: ['a', 'b'] }, true], [{ selections: [] }, true], [{ selections: ['a', 'z'] }, false], [{ selections: ['z', 'a'] }, false],
    [{ selections: ['a', 1] }, false], [{ selections: 'a' }, false], [{ choice: 'a' }, false], [{}, true],
  ])('multi-select answer %j → %s', (params, expected) => {
    const question = parseQuestion({ input: { question: 'Q', options: [opt, { value: 'b', label: 'B' }], multiple: true }, toolId: T });
    expect(matchesOptions({ question, params })).toBe(expected);
  });
});
