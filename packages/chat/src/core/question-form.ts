/**
 * @module question-form
 *
 * Parser for inline `<question-form>...</question-form>` blocks an agent
 * emits to ask the user a structured set of clarifying questions before
 * proceeding. Body must be JSON, e.g.:
 *
 *   <question-form id="discovery" title="Quick brief">
 *   {
 *     "questions": [
 *       { "id": "platform", "label": "Platform", "type": "radio",
 *         "options": ["Mobile (iOS/Android)", "Desktop web", "Responsive"],
 *         "required": true }
 *     ]
 *   }
 *   </question-form>
 *
 * `<ask-question>...</ask-question>` is accepted as an alias for
 * `<question-form>`, so a model that drifts to the colloquial tag name
 * still renders correctly instead of leaking raw markup into prose.
 *
 * Splits a final assistant text payload into ordered segments — prose +
 * forms — so a host's message renderer can render the form inline.
 *
 * This module is a stable public facade. The implementation is split across
 * `question-form/` by responsibility, each with its own invariants:
 *   - `types.ts`     — the shared type vocabulary
 *   - `scan.ts`       — tag matching, prose/form segmentation, and the
 *                       tolerant streaming-recovery path
 *   - `normalize.ts`  — raw-JSON-to-`FormQuestion` normalization, including
 *                       the `isRenderableColor` CSS-injection guard
 *   - `format.ts`     — turning submitted answers into agent-readable prose
 * Only re-exports live here; do not add implementation directly to this file.
 */
export type { QuestionType, DirectionCard, FormOption, FormQuestion, QuestionForm, FormSegment } from './question-form/types.js';
export {
  splitOnQuestionForms,
  findFirstQuestionForm,
  parseQuestionForm,
  stripTrailingOpenQuestionForm,
  hasUnterminatedQuestionForm,
  parsePartialQuestionForm,
} from './question-form/scan.js';
export { isRenderableColor } from './question-form/normalize.js';
export { formatFormAnswers, formOptionLabelForValue, formOptionValueForLabel } from './question-form/format.js';
