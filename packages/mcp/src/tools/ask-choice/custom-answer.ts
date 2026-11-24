import { SURFACE_TYPED_ANSWER_PARAM } from '@jini-ai/core';
import type { SurfaceField } from '@jini-ai/core/contracts/cards';
import type { AskChoiceExchangeStore, AskChoiceQuestion } from './types.js';

/**
 * @file The "Something else" choice on an ask-choice card: one extra option plus a text box, so
 * the operator can give an answer the model did not list.
 *
 * The typed words always reach the model as `freeText`, never as a fake option value: a picked
 * single-select "Something else" becomes the exchange's typed answer (the same path as a reply
 * typed in the chat box), and a ticked multi-select one is stripped from `selections` and its
 * words are added next to the real picks.
 *
 * The host injects every visible word ({@link CustomAnswerCopy}); the option value and the text
 * box's param name are fixed here because the answer splitting below depends on them.
 */

/** The extra option's submitted value. Never shown to the model; stripped before the answer is classified. */
export const CUSTOM_CHOICE_VALUE = '__somethingElse';
/** The text box's param name in the form's callback. */
export const CUSTOM_ANSWER_PARAM = 'customAnswer';

/** Host wording for the extra option, its text box, and the model note. */
export interface CustomAnswerCopy {
  /** The extra option's label (e.g. "Something else"). */
  readonly choiceLabel: string;
  /** The text box's label (kept for screen readers even when the host hides it visually). */
  readonly answerLabel: string;
  readonly answerPlaceholder: string;
  /** Model note when the operator ticked options and also wrote their own answer. */
  readonly withPicksNote: string;
}

/** Adds "Something else" to each choice field and one text box after them.
 * Returns the fields unchanged when a model option already uses the reserved value.
 * @complexity O(n) in offered options; pure.
 */
export function addCustomAnswerFields(
  { fields, copy }: { fields: readonly SurfaceField[]; copy: Pick<CustomAnswerCopy, 'choiceLabel' | 'answerLabel' | 'answerPlaceholder'> },
  _options = {},
): SurfaceField[] {
  const choiceFields = fields.filter((field) => field.kind === 'enum' || field.kind === 'multi-enum');
  const taken = choiceFields.some((field) => field.options.some((option) => option.value === CUSTOM_CHOICE_VALUE));
  if (choiceFields.length === 0 || taken) return [...fields];
  const custom = { value: CUSTOM_CHOICE_VALUE, label: copy.choiceLabel };
  const withOption = fields.map((field) =>
    field.kind === 'enum' || field.kind === 'multi-enum' ? { ...field, options: [...field.options, custom] } : field);
  // Required only for the radio: the renderer cannot read a checkbox group's state.
  const single = fields.some((field) => field.kind === 'enum' && field.name === 'choice');
  const textBox: SurfaceField = {
    kind: 'string',
    name: CUSTOM_ANSWER_PARAM,
    label: copy.answerLabel,
    placeholder: copy.answerPlaceholder,
    required: false,
    ...(single ? { requiredWhen: { field: 'choice', in: [CUSTOM_CHOICE_VALUE] } } : {}),
  };
  return [...withOption, textBox];
}

/** What one delivered answer said under "Something else", kept for {@link mergeCustomAnswer}. */
export interface CustomAnswerSplit {
  readonly freeText?: string;
  /** Real multi-select picks to restore when a single-select "Something else" took the typed path. */
  readonly selections?: readonly string[];
}

type AnswerParams = Record<string, unknown>;

/** Rewrites one delivered form answer so the exchange classifies it, and keeps the typed words aside.
 * Typed words count only when "Something else" was picked; otherwise they are dropped.
 * @complexity O(s + m) in selections and offered options; pure.
 */
export function splitCustomAnswer(
  { params, question }: { params: AnswerParams; question: AskChoiceQuestion | undefined },
  _options = {},
): { params: AnswerParams; split: CustomAnswerSplit } {
  if (!Object.hasOwn(params, CUSTOM_ANSWER_PARAM)) return { params, split: {} };
  const { [CUSTOM_ANSWER_PARAM]: raw, ...rest } = params;
  const text = typeof raw === 'string' ? raw.trim() : '';
  const pickedSingle = rest.choice === CUSTOM_CHOICE_VALUE;
  const { params: cleaned, pickedMulti } = withoutMultiCustomPick({ params: rest });
  if (!text || !(pickedSingle || pickedMulti)) return { params: cleaned, split: {} };
  if (!pickedSingle) return { params: cleaned, split: { freeText: text } };
  return typedCustomAnswer({ params: cleaned, text, question });
}

/** Removes the "Something else" pick from multi-select selections and reports whether it was there.
 * @complexity O(s) in selections; pure.
 */
function withoutMultiCustomPick({ params }: { params: AnswerParams }, _options = {}): { params: AnswerParams; pickedMulti: boolean } {
  const selections = Array.isArray(params.selections) ? params.selections : undefined;
  const pickedMulti = selections?.includes(CUSTOM_CHOICE_VALUE) === true;
  const realSelections = selections?.filter((value) => value !== CUSTOM_CHOICE_VALUE);
  return { params: realSelections ? { ...params, selections: realSelections } : params, pickedMulti };
}

/** A picked single-select "Something else" becomes the exchange's typed answer.
 * The typed path skips option checks, so only multi-select picks really offered are restored.
 * @complexity O(s + m) in selections and offered options; pure.
 */
function typedCustomAnswer(
  { params, text, question }: { params: AnswerParams; text: string; question: AskChoiceQuestion | undefined },
  _options = {},
): { params: AnswerParams; split: CustomAnswerSplit } {
  const { choice: _custom, selections, ...typed } = params;
  const offered = new Set(question?.multiSelect?.options.map((option) => option.value));
  const keep = Array.isArray(selections) && selections.every((value) => typeof value === 'string' && offered.has(value))
    ? selections as string[] : undefined;
  return { params: { ...typed, [SURFACE_TYPED_ANSWER_PARAM]: text }, split: { freeText: text, ...(keep ? { selections: keep } : {}) } };
}

/** Folds the kept words into the classified result; only a submitted answer is changed.
 * `note` is the host's {@link CustomAnswerCopy.withPicksNote}.
 * @complexity O(1); pure.
 */
export function mergeCustomAnswer({ result, split, note }: { result: unknown; split: CustomAnswerSplit; note: string }, _options = {}): unknown {
  const answer = result as Record<string, unknown>;
  if (split.freeText === undefined || answer?.submitted !== true) return result;
  if (answer.freeText !== undefined) return split.selections ? { ...answer, selections: split.selections } : result;
  return { ...answer, freeText: split.freeText, note };
}

/** One tool call's "Something else" state: the shown question and what the answer said. */
export interface CustomAnswerCall {
  question?: AskChoiceQuestion;
  split: CustomAnswerSplit;
}

/** Wraps an exchange store so each delivered answer is split before it is classified.
 * @complexity O(1) wiring; per answer see {@link splitCustomAnswer}.
 */
export function customAnswerExchanges(
  { exchanges, call }: { exchanges: AskChoiceExchangeStore; call: CustomAnswerCall },
  _options = {},
): AskChoiceExchangeStore {
  return {
    open: (args) => {
      const exchange = exchanges.open(args);
      return {
        id: exchange.id,
        send: (sendArgs) => exchange.send(sendArgs),
        close: (closeArgs) => exchange.close(closeArgs),
        receive: async (receiveArgs) => {
          const message = await exchange.receive(receiveArgs);
          if (message.status !== 'received') return message;
          const { params, split } = splitCustomAnswer({ params: message.params, question: call.question });
          call.split = split;
          return { status: 'received', params };
        },
      };
    },
  };
}
