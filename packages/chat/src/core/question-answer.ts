/** @module question-answer — plain transcript text from the ask-choice result contract. */
function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

/** Resolve a stored option value through the question that offered it. Unknown values stay readable. */
function optionLabel(group: unknown, value: string): string {
  const options = record(group).options;
  if (!Array.isArray(options)) return value;
  const option = options.find(candidate => record(candidate).value === value);
  const label = record(option).label;
  return typeof label === 'string' ? label : value;
}

function selectedAnswerText(
  { result, input }: { result: Record<string, unknown>; input: unknown }, _options = {},
): string | undefined {
  const question = record(input);
  const labels: string[] = [];
  if (typeof result.choice === 'string') labels.push(optionLabel(question.singleSelect, result.choice));
  if (Array.isArray(result.selections)) {
    for (const selection of result.selections) {
      if (typeof selection === 'string') labels.push(optionLabel(question.multiSelect, selection));
    }
  }
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
