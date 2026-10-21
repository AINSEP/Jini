import { expect, it } from 'vitest';
import { parseQuestion, QuestionShapeError } from '../question.js';

it('keeps mixed-form refusal ahead of missing-question and multiple-type checks', () => {
  expect(() => parseQuestion({ input: { title: 'legacy', options: [], multiple: 'yes' }, toolId: 'ask' }))
    .toThrow("ask: use {question, options, multiple?} or the legacy nested selects; do not mix them.");
});
it('defaults missing flat values to labels without trimming or mutating the supplied options', () => {
  const input = { question: '  Pick  ', multiple: true, options: [{ label: ' One ', description: 'hint' }], submitLabel: 'Go' };
  expect(parseQuestion({ input, toolId: 'ask' })).toEqual({ title: '  Pick  ', submitLabel: 'Go', multiSelect: { label: '  Pick  ', options: [{ value: ' One ', label: ' One ', description: 'hint' }] } });
  expect(input.options).toEqual([{ label: ' One ', description: 'hint' }]);
});
it('validates the single select before an invalid multi select', () => {
  expect(() => parseQuestion({ input: { title: 'Pick', singleSelect: null, multiSelect: null }, toolId: 'ask' }))
    .toThrow("ask: 'singleSelect' must be an object.");
  expect(() => parseQuestion({ input: { question: 'Pick', options: [{ label: 'One', value: null }] }, toolId: 'ask' })).toThrow(QuestionShapeError);
});
