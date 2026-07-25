/**
 * @module @jini/chat-core/agentic/guards
 *
 * The refusals that must hold on every surface, expressed over plain descriptors rather than
 * DOM nodes so they are testable in Node and reusable from any framework binding.
 *
 * Both guards here answer review findings that an allowlist alone does not cover: a generic
 * filler will happily type into a password or card-number field even when that field carries a
 * legitimate handle, and `data-agent-label` is page-authored text that reaches a model as if
 * the host had written it.
 */

/** The subset of an input element these guards need. Framework- and DOM-free by design. */
export interface FieldDescriptor {
  /** The `type` attribute, lowercased. */
  readonly type?: string | undefined;
  /** The `autocomplete` attribute, lowercased. */
  readonly autocomplete?: string | undefined;
  readonly name?: string | undefined;
  readonly id?: string | undefined;
  readonly readOnly?: boolean | undefined;
  readonly disabled?: boolean | undefined;
}

/** Input types no automated caller may ever write to. */
const DENIED_TYPES = new Set(['password', 'hidden', 'file', 'image']);

/** Autocomplete tokens covering credentials, payment instruments and one-time codes. */
const DENIED_AUTOCOMPLETE = new Set([
  'current-password', 'new-password', 'one-time-code',
  'cc-number', 'cc-exp', 'cc-exp-month', 'cc-exp-year', 'cc-csc', 'cc-name', 'cc-type',
]);

/** Substrings in `name`/`id` that indicate a secret even when type/autocomplete are unset. */
const SUSPICIOUS_NAME = /(?:password|passwd|secret|token|csrf|xsrf|otp|cvv|cvc|ssn|creditcard|cardnumber|apikey)/i;

export type FieldRefusal =
  | 'denied-type'
  | 'denied-autocomplete'
  | 'suspicious-name'
  | 'read-only'
  | 'disabled';

/**
 * Why an automated fill must be refused for this field, or `null` when it is safe to write.
 *
 * Fails closed on anything that looks like a credential, payment instrument, one-time code, or
 * anti-forgery token, independent of whether the field carries an agent handle. Tagging a
 * password box does not make it fillable.
 *
 * @param field - The field's attributes.
 * @returns The first refusal reason, or `null` when the field may be filled.
 */
export function findFieldFillRefusal(field: FieldDescriptor): FieldRefusal | null {
  const type = field.type?.toLowerCase();
  if (type !== undefined && DENIED_TYPES.has(type)) return 'denied-type';

  const autocomplete = field.autocomplete?.toLowerCase();
  if (autocomplete !== undefined) {
    for (const token of autocomplete.split(/\s+/)) {
      if (DENIED_AUTOCOMPLETE.has(token)) return 'denied-autocomplete';
    }
  }

  if (SUSPICIOUS_NAME.test(field.name ?? '') || SUSPICIOUS_NAME.test(field.id ?? '')) {
    return 'suspicious-name';
  }
  if (field.readOnly === true) return 'read-only';
  if (field.disabled === true) return 'disabled';
  return null;
}

const FIELD_REFUSAL_MESSAGES: Record<FieldRefusal, string> = {
  'denied-type': 'this field type can never be filled by an agent',
  'denied-autocomplete': 'this field holds a credential or payment instrument',
  'suspicious-name': 'this field name indicates a secret or anti-forgery token',
  'read-only': 'this field is read-only',
  disabled: 'this field is disabled',
};

/** Model-readable reason for a refusal, so a blocked fill explains itself instead of failing opaquely. */
export function describeFieldRefusal(refusal: FieldRefusal): string {
  return FIELD_REFUSAL_MESSAGES[refusal];
}

/** Default cap on page-authored text handed to a model. */
export const MAX_AGENT_LABEL_LENGTH = 200;

/**
 * C0/C1 control characters plus the Unicode bidirectional and invisible formatting ranges.
 *
 * The bidi overrides matter as much as the control codes: `U+202E` and friends let page text
 * render one way and read another, which is a direct way to smuggle a different instruction
 * into whatever reads the label back.
 */
const CONTROL_AND_BIDI =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

export interface NormalizedLabel {
  readonly text: string;
  readonly truncated: boolean;
}

/**
 * Normalizes page-authored text before it reaches a model.
 *
 * Strips control characters (including the bidirectional overrides used to make text render
 * differently from how it reads), collapses whitespace, and caps the length. The result is still
 * untrusted *content* — this only bounds it; it does not make it safe to follow as instruction.
 *
 * @param raw - Text read off the page, e.g. a `data-agent-label`.
 * @param maxLength - Cap, defaulting to {@link MAX_AGENT_LABEL_LENGTH}.
 * @returns The bounded text and whether anything was cut.
 */
export function normalizeAgentLabel(raw: string, maxLength = MAX_AGENT_LABEL_LENGTH): NormalizedLabel {
  const stripped = raw.replace(CONTROL_AND_BIDI, ' ');
  const collapsed = stripped.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxLength) return { text: collapsed, truncated: false };
  return { text: collapsed.slice(0, maxLength), truncated: true };
}
