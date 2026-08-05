/**
 * @module question-form/types
 *
 * Type vocabulary for the `<question-form>` parser, split out of the
 * original single-file `question-form.ts` so `scan.ts` / `normalize.ts` /
 * `format.ts` can each import just the types they need without pulling in
 * one another's implementation. See `../question-form.ts` for the public
 * facade and the block format this vocabulary describes.
 */

export type QuestionType =
  | 'radio'
  | 'checkbox'
  | 'select'
  | 'text'
  | 'textarea'
  | 'number'
  | 'range'
  | 'date'
  | 'time'
  | 'datetime-local'
  | 'color'
  | 'url'
  | 'email'
  | 'tel'
  | 'file'
  | 'switch'
  | 'direction-cards';

/**
 * Rich card metadata for a single `direction-cards` option. A direction
 * picker renders a swatch row, a serif/sans type sample, a mood blurb, and a
 * "references" line so users can scan visually instead of reading radio
 * labels. The agent emits this metadata inline in the form JSON so a host
 * can render it without additional fetches.
 */
export interface DirectionCard {
  /** The radio value — what comes back in the user's answer. Must match a label/value in `options`. */
  id: string;
  /** Short headline on the card. */
  label: string;
  /** One- or two-sentence mood blurb. */
  mood: string;
  /** Real-world exemplars (kept to at most 6 by the parser). */
  references: string[];
  /** Swatch hex / OKLch strings for the palette row (kept to at most 8 by the parser). */
  palette: string[];
  /** Display (headline) font stack, for a live "Aa" sample. */
  displayFont: string;
  /** Body font stack, for a secondary sample. */
  bodyFont: string;
}

export interface FormOption {
  label: string;
  value: string;
  description?: string;
}

export interface FormQuestion {
  id: string;
  label: string;
  type: QuestionType;
  options?: FormOption[];
  placeholder?: string;
  required?: boolean;
  help?: string;
  defaultValue?: string | string[];
  /** Only applies when `type === 'checkbox'`. Caps the number of selected options. */
  maxSelections?: number;
  /**
   * For finite-choice controls, show a free-form override beside the
   * generated options so the user can supply their own value.
   */
  allowCustom?: boolean;
  customLabel?: string;
  customPlaceholder?: string;
  /** Numeric/range inputs only. */
  min?: number;
  max?: number;
  step?: number;
  /** File inputs only. The answer serializes selected file names, not bytes. */
  multiple?: boolean;
  /** File inputs only. Mirrors the native file input `accept` attribute. */
  accept?: string;
  /** Only present when `type === 'direction-cards'`. Mapped to `options` by `id`. */
  cards?: DirectionCard[];
}

export interface QuestionForm {
  id: string;
  title: string;
  description?: string;
  questions: FormQuestion[];
  submitLabel?: string;
}

export type FormSegment =
  | { kind: 'text'; text: string }
  | { kind: 'form'; form: QuestionForm; raw: string };
