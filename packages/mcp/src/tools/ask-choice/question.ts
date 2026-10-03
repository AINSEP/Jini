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
    return { value, label };
  });
  return { label: spec['label'], options, ...(typeof spec['hint'] === 'string' ? { hint: spec['hint'] } : {}) };
}

export function parseQuestion({ input, toolId }: { input: Record<string, unknown>; toolId: string }): AskChoiceQuestion {
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
