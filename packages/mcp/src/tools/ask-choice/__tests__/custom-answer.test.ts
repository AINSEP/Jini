import { describe, expect, it } from 'vitest';
import { SURFACE_TYPED_ANSWER_PARAM } from '@jini-ai/core';
import type { SurfaceField } from '@jini-ai/core/contracts/cards';

import {
  addCustomAnswerFields,
  CUSTOM_ANSWER_PARAM,
  CUSTOM_CHOICE_VALUE,
  customAnswerExchanges,
  mergeCustomAnswer,
  splitCustomAnswer,
  type CustomAnswerCall,
} from '../custom-answer.js';
import type { AskChoiceExchangeStore, AskChoiceQuestion } from '../types.js';

/**
 * @file Unit certification of the "Something else" answer: the extra option and text box, and
 * how a delivered answer is split so the typed words reach the model only as `freeText`. The
 * host's end-to-end card test drives these through a real exchange store.
 */

const copy = { choiceLabel: 'Other', answerLabel: 'Your answer', answerPlaceholder: 'Type it', withPicksNote: 'NOTE' };
const single: SurfaceField = { kind: 'enum', name: 'choice', label: 'Pick', options: [{ value: 'a', label: 'A' }], required: true } as SurfaceField;
const multi: SurfaceField = { kind: 'multi-enum', name: 'selections', label: 'Pick', options: [{ value: 'x', label: 'X' }] } as SurfaceField;
const multiQuestion = { multiSelect: { options: [{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }] } } as unknown as AskChoiceQuestion;

describe('addCustomAnswerFields', () => {
  it('adds the injected option to every choice field and one text box, required only when the radio picks it', () => {
    const fields = addCustomAnswerFields({ fields: [single, multi], copy });
    expect(fields).toHaveLength(3);
    expect((fields[0] as { options: readonly unknown[] }).options.at(-1)).toEqual({ value: CUSTOM_CHOICE_VALUE, label: 'Other' });
    expect((fields[1] as { options: readonly unknown[] }).options.at(-1)).toEqual({ value: CUSTOM_CHOICE_VALUE, label: 'Other' });
    expect(fields[2]).toEqual({ kind: 'string', name: CUSTOM_ANSWER_PARAM, label: 'Your answer', placeholder: 'Type it', required: false,
      requiredWhen: { field: 'choice', in: [CUSTOM_CHOICE_VALUE] } });
  });

  it('adds no requiredWhen for a multi-select-only card', () => {
    expect(addCustomAnswerFields({ fields: [multi], copy })[1]).not.toHaveProperty('requiredWhen');
  });

  it('returns the fields unchanged when there is no choice field or the reserved value is already taken', () => {
    const text = { kind: 'string', name: 'note', label: 'Note', required: false } as SurfaceField;
    expect(addCustomAnswerFields({ fields: [text], copy })).toEqual([text]);
    const taken = { ...single, options: [{ value: CUSTOM_CHOICE_VALUE, label: 'model' }] } as SurfaceField;
    expect(addCustomAnswerFields({ fields: [taken], copy })).toEqual([taken]);
  });
});

describe('splitCustomAnswer', () => {
  it('leaves an answer without the text box param untouched', () => {
    const params = { choice: 'a' };
    expect(splitCustomAnswer({ params, question: undefined })).toEqual({ params, split: {} });
  });

  it('drops typed words when "Something else" was not picked', () => {
    expect(splitCustomAnswer({ params: { choice: 'a', [CUSTOM_ANSWER_PARAM]: 'hi' }, question: undefined })).toEqual({ params: { choice: 'a' }, split: {} });
  });

  it('turns a picked single-select "Something else" into the typed answer, restoring only offered multi picks', () => {
    const result = splitCustomAnswer({ params: { choice: CUSTOM_CHOICE_VALUE, selections: ['x'], [CUSTOM_ANSWER_PARAM]: '  mine  ' }, question: multiQuestion });
    expect(result).toEqual({ params: { [SURFACE_TYPED_ANSWER_PARAM]: 'mine' }, split: { freeText: 'mine', selections: ['x'] } });
    const forged = splitCustomAnswer({ params: { choice: CUSTOM_CHOICE_VALUE, selections: ['zzz'], [CUSTOM_ANSWER_PARAM]: 'mine' }, question: multiQuestion });
    expect(forged.split).toEqual({ freeText: 'mine' });
  });

  it('strips a ticked multi-select "Something else" and keeps the words beside the real picks', () => {
    expect(splitCustomAnswer({ params: { selections: ['x', CUSTOM_CHOICE_VALUE], [CUSTOM_ANSWER_PARAM]: 'mine' }, question: multiQuestion }))
      .toEqual({ params: { selections: ['x'] }, split: { freeText: 'mine' } });
  });
});

describe('mergeCustomAnswer', () => {
  it('adds freeText and the injected note to a submitted answer with picks', () => {
    expect(mergeCustomAnswer({ result: { submitted: true, selections: ['x'] }, split: { freeText: 'mine' }, note: 'NOTE' }))
      .toEqual({ submitted: true, selections: ['x'], freeText: 'mine', note: 'NOTE' });
  });

  it('restores kept selections next to an existing freeText, and leaves unsubmitted or unsplit results alone', () => {
    expect(mergeCustomAnswer({ result: { submitted: true, freeText: 'mine' }, split: { freeText: 'mine', selections: ['x'] }, note: 'NOTE' }))
      .toEqual({ submitted: true, freeText: 'mine', selections: ['x'] });
    const typed = { submitted: true, freeText: 'mine' };
    expect(mergeCustomAnswer({ result: typed, split: { freeText: 'mine' }, note: 'NOTE' })).toBe(typed);
    const cancelled = { submitted: false };
    expect(mergeCustomAnswer({ result: cancelled, split: { freeText: 'mine' }, note: 'NOTE' })).toBe(cancelled);
    expect(mergeCustomAnswer({ result: typed, split: {}, note: 'NOTE' })).toBe(typed);
  });
});

describe('customAnswerExchanges', () => {
  it('splits each received answer, records the split on the call, and forwards every other port call', async () => {
    const calls: string[] = [];
    let next: unknown = { status: 'received', params: { selections: ['x', CUSTOM_CHOICE_VALUE], [CUSTOM_ANSWER_PARAM]: 'mine' } };
    const store = {
      open: () => ({
        id: 'ex-1',
        send: () => { calls.push('send'); },
        close: () => { calls.push('close'); },
        receive: async () => next,
      }),
    } as unknown as AskChoiceExchangeStore;
    const call: CustomAnswerCall = { question: multiQuestion, split: {} };
    const exchange = customAnswerExchanges({ exchanges: store, call }).open({} as never);
    expect(exchange.id).toBe('ex-1');
    expect(await exchange.receive({} as never)).toEqual({ status: 'received', params: { selections: ['x'] } });
    expect(call.split).toEqual({ freeText: 'mine' });
    next = { status: 'expired' };
    expect(await exchange.receive({} as never)).toBe(next);
    exchange.send({} as never);
    exchange.close({} as never);
    expect(calls).toEqual(['send', 'close']);
  });
});

it.each([42, '   '])('a blank or non-text custom answer %j does not become model-visible free text', raw => {
  const params = { selections: ['x', CUSTOM_CHOICE_VALUE], [CUSTOM_ANSWER_PARAM]: raw };
  expect(splitCustomAnswer({ params, question: multiQuestion })).toStrictEqual({ params: { selections: ['x'] }, split: {} });
});

it('does not restore a non-string multi-select field when a single custom answer is accepted', () => {
  const params = { choice: CUSTOM_CHOICE_VALUE, selections: ['x', 42, 'y'], [CUSTOM_ANSWER_PARAM]: 'mine' };
  expect(splitCustomAnswer({ params, question: multiQuestion }))
    .toStrictEqual({ params: { [SURFACE_TYPED_ANSWER_PARAM]: 'mine' }, split: { freeText: 'mine' } });
});
