/** @module question-answer — plain transcript text from the ask-choice result contract. */
/** Optional question context on an MCP-UI resource, before HTML presentation flattens its labels. */
export const SURFACE_QUESTION_META_KEY = 'x-jini-chat/question';

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

/** The shared title/answer format for closed cards and standalone form receipts. */
export function questionAnswerLabel({ input, text }: { input: unknown; text: string }, _options = {}): string {
  const question = record(input);
  const title = [question.title, question.question, question.prompt]
    .find(value => typeof value === 'string' && value.trim() !== '');
  return typeof title === 'string' ? `${title}: ${text}` : text;
}

/** Resolve a stored option value through the question that offered it. Unknown values stay readable. */
function optionLabel({ group, value }: { group: unknown; value: string }, _options = {}): string {
  const options = record(group).options;
  if (!Array.isArray(options)) return value;
  const option = options.find(candidate => {
    const offered = record(candidate);
    return (offered.value ?? offered.id ?? offered.label) === value;
  });
  const label = record(option).label;
  return typeof label === 'string' ? label : value;
}

/** Labels for the string entries of a multi-select answer, in answer order. O(s*m). */
function multiSelectLabels({ selections, question }: { selections: unknown; question: Record<string, unknown> }, _options = {}): string[] {
  if (!Array.isArray(selections)) return [];
  return selections.filter((selection): selection is string => typeof selection === 'string')
    .map(selection => optionLabel({ group: question.multiSelect ?? question, value: selection }));
}

function selectedAnswerText(
  { result, input }: { result: Record<string, unknown>; input: unknown }, _options = {},
): string | undefined {
  const question = record(input);
  const single = typeof result.choice === 'string' ? [optionLabel({ group: question.singleSelect ?? question, value: result.choice })] : [];
  // concat, never push(...spread): spreading every selection as an argument throws past the engine's
  // argument limit, and this path must never throw (FU-B).
  const labels = single.concat(multiSelectLabels({ selections: result.selections, question }));
  if (labels.length > 0) return labels.join(', ');
  return Array.isArray(result.selections) && result.selections.length === 0 ? 'None selected' : undefined;
}

/** Read a classified result or delivered callback as plain user text. Decline wins over other fields;
 * expiry, invalid answers and unrecognized results produce no user message.
 * @returns Answer text, or undefined when no supported human answer is present; never throws.
 * @example questionAnswerText({ answer: { submitted: true, freeText: 'Custom theme' } })
 * @complexity O(p + s*m) time, O(s) space for p single options, s selections, m multi options; no I/O.
 */
export function questionAnswerText(
  { answer, input }: { answer: unknown; input?: unknown }, _options = {},
): string | undefined {
  const result = record(answer);
  if ((result.submitted === false && result.reason === 'cancelled') || result.__dismissed === true) return 'Declined';
  if (result.submitted === false) return undefined;
  const freeText = result.freeText ?? result.__typedAnswer;
  if (typeof freeText === 'string' && freeText.trim()) return freeText.trim();
  return selectedAnswerText({ result, input });
}

/** Decode the persisted JSON result; failed tools and non-answer payloads never become user text.
 * @returns Plain answer text or undefined for missing, failed or malformed results; never throws.
 * @example questionAnswerFromResult({ result: { content: '{"submitted":true,"choice":"Blue"}', isError: false } })
 * @complexity O(r + p + s*m) time, O(r + s) space including JSON decoding of r result characters.
 */
export function questionAnswerFromResult(
  { result, input }: { result: { content: string; isError: boolean } | undefined; input?: unknown }, _options = {},
): string | undefined {
  if (!result || result.isError) return undefined;
  let answer: unknown;
  try { answer = JSON.parse(result.content); } catch { return undefined; }
  const fields = record(answer);
  if (fields.submitted !== true && !(fields.submitted === false && fields.reason === 'cancelled')) return undefined;
  return questionAnswerText({ answer, input });
}
