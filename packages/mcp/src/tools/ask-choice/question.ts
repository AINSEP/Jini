import type { AskChoiceQuestion, AskChoiceSelect } from './types.js';

/** Internal marker: only malformed question content gets schema-retry decoration. */
export class QuestionShapeError extends Error {
  constructor({ message }: { message: string }, options: ErrorOptions = {}) {
    super(message, options);
  }
}

function readSelect(raw: unknown, field: string, toolId: string): AskChoiceSelect | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'object' || raw === null) {
    throw new QuestionShapeError({ message: `${toolId}: '${field}' must be an object.` });
  }
  const spec = raw as Record<string, unknown>;
  if (typeof spec['label'] !== 'string' || !spec['label'] || !Array.isArray(spec['options']) || !spec['options'].length) {
    throw new QuestionShapeError({ message: `${toolId}: '${field}' requires a non-empty 'label' and at least one option.` });
  }
  const options = spec['options'].map((entry: unknown) => {
    const option = typeof entry === 'object' && entry !== null ? entry as Record<string, unknown> : {};
    const value = option['value'];
    const label = option['label'];
    if (typeof value !== 'string' || !value || typeof label !== 'string' || !label) {
      throw new QuestionShapeError({ message: `${toolId}: every '${field}' option requires a string 'value' and 'label'.` });
    }
    return { value, label, ...(typeof option['description'] === 'string' ? { description: option['description'] } : {}) };
  });
  return { label: spec['label'], options, ...(typeof spec['hint'] === 'string' ? { hint: spec['hint'] } : {}) };
}

function normalizeFlatQuestion(
  { input, toolId }: { input: Record<string, unknown>; toolId: string }, _options = {},
): Record<string, unknown> {
  const question = input['question'];
  if (typeof question !== 'string' || !question.trim()) throw new QuestionShapeError({ message: `${toolId}: 'question' is required.` });
  if (input['multiple'] !== undefined && typeof input['multiple'] !== 'boolean') {
    throw new QuestionShapeError({ message: `${toolId}: 'multiple' must be a boolean.` });
  }
  const options = normalizeFlatOptions({ rawOptions: input['options'] });
  const select = { label: question, options };
  return { title: question, ...(typeof input['description'] === 'string' ? { description: input['description'] } : {}),
    ...(typeof input['submitLabel'] === 'string' ? { submitLabel: input['submitLabel'] } : {}),
    [input['multiple'] === true ? 'multiSelect' : 'singleSelect']: select };
}

function normalizeFlatOptions({ rawOptions }: { rawOptions: unknown }, _options = {}): unknown {
  return Array.isArray(rawOptions) ? rawOptions.map(entry => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return entry;
    const option = entry as Record<string, unknown>;
    return { ...option, value: option['value'] === undefined ? option['label'] : option['value'] };
  }) : rawOptions;
}

function normalizeQuestion(
  { input, toolId }: { input: Record<string, unknown>; toolId: string }, _options = {},
): Record<string, unknown> {
  if (input['question'] === undefined && input['options'] === undefined && input['multiple'] === undefined) return input;
  if (input['title'] !== undefined || input['singleSelect'] !== undefined || input['multiSelect'] !== undefined) {
    throw new QuestionShapeError({ message: `${toolId}: use {question, options, multiple?} or the legacy nested selects; do not mix them.` });
  }
  return normalizeFlatQuestion({ input, toolId });
}

/** Normalize the flat model question into the existing UI/answer contract.
 * @throws QuestionShapeError for malformed questions or ambiguous mixed forms.
 * @complexity O(n) in offered options; no effects.
 */
export function parseQuestion({ input, toolId }: { input: Record<string, unknown>; toolId: string }, _options = {}): AskChoiceQuestion {
  input = normalizeQuestion({ input, toolId });
  const title = input['title'];
  if (typeof title !== 'string' || !title) throw new QuestionShapeError({ message: `${toolId}: 'title' is required.` });
  const singleSelect = readSelect(input['singleSelect'], 'singleSelect', toolId);
  const multiSelect = readSelect(input['multiSelect'], 'multiSelect', toolId);
  if (!singleSelect && !multiSelect) {
    throw new QuestionShapeError({ message: `${toolId}: at least one of 'singleSelect' or 'multiSelect' is required.` });
  }
  return {
    title,
    ...(typeof input['description'] === 'string' ? { description: input['description'] } : {}),
    ...(typeof input['submitLabel'] === 'string' ? { submitLabel: input['submitLabel'] } : {}),
    ...(singleSelect ? { singleSelect } : {}), ...(multiSelect ? { multiSelect } : {}),
  };
}

export function matchesOptions({ question, params }: { question: AskChoiceQuestion; params: Record<string, unknown> }): boolean {
  const choice = params['choice'];
  if (question.singleSelect) {
    if (!question.singleSelect.options.some(option => option.value === choice)) return false;
  } else if (choice !== undefined) return false;
  const selections = params['selections'];
  if (selections === undefined) return true;
  if (!question.multiSelect || !Array.isArray(selections)) return false;
  const offered = new Set(question.multiSelect.options.map(option => option.value));
  return selections.every(value => typeof value === 'string' && offered.has(value));
}
