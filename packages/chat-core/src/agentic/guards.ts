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
  /**
   * The field's human-visible label — `aria-label`, `placeholder`, or the text of an associated
   * `<label>`, whichever the driver can resolve.
   *
   * Carried because `name`/`id` are the *machine* names, and a form builder or CMS that emits
   * `name="field_47"` leaves the guard nothing to judge while the page still plainly reads
   * "Card number" to the user. A field whose sensitivity is stated only in its label was
   * invisible to every refusal here until this existed.
   */
  readonly accessibleLabel?: string | undefined;
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

/**
 * Substrings in `name`/`id` that indicate a secret even when type/autocomplete are unset.
 *
 * Matched against {@link squashSeparators}'d text, so the multi-word entries catch the separator
 * spellings people actually use. `api_key`, `api-key` and `apiKey` are all the same field; a
 * literal-substring match sees only the last one, which is the least common of the three.
 */
const SUSPICIOUS_NAME = /(?:password|passwd|secret|token|csrf|xsrf|otp|cvv|cvc|ssn|creditcard|cardnumber|apikey)/i;

/**
 * Drops everything that is not a letter or digit, so separator conventions do not decide whether
 * a guard fires. Over-matching is the safe direction here and is the point: this guard fails
 * closed, and the cost of a false positive is a field an agent must leave to the user.
 *
 * Normalizes before squashing rather than after, because the naive squash used to *delete* any
 * character outside ASCII `[a-z0-9]` instead of folding it. Deleting, not folding, is the bug:
 * replacing one letter of a trigger word with a look-alike codepoint (fullwidth, accented, …)
 * used to remove that letter from the squashed string entirely, so `ｐassword` (fullwidth
 * U+FF50 `ｐ`) squashed to `assword` and matched nothing. NFKC folds that class of look-alike —
 * fullwidth/halfwidth forms, and the Latin compatibility block — to its ordinary ASCII form
 * before the letter can be deleted. The NFD pass afterward strips combining marks so an accented
 * letter (`á` → `a` + combining acute) folds the same way once the mark itself is dropped.
 *
 * This does NOT close the general homoglyph class. NFKC has no cross-script confusables table:
 * Cyrillic `а` (U+0430) and Greek `ο` (U+03BF) stay distinct codepoints from Latin `a`/`o` after
 * NFKC, so `pаssword` (Cyrillic а) still squashes to something other than `password` and still
 * bypasses `SUSPICIOUS_NAME`. Closing that would need an explicit confusables-folding table
 * (e.g. Unicode TR39's) mapping each look-alike script's letters onto Latin before squashing —
 * deliberately not built here; see the "known limit" test in guards.test.ts for the concrete gap.
 */
function squashSeparators(value: string): string {
  const foldedWidth = value.normalize('NFKC');
  const withoutMarks = foldedWidth.normalize('NFD').replace(/\p{M}/gu, '');
  return withoutMarks.replace(/[^a-z0-9]/gi, '');
}

/**
 * The refusals that are about *secrecy* — the field's contents are not an agent's to know.
 *
 * Separated from the two writability refusals below because reading and writing are different
 * questions with different answers. A read-only field's value is perfectly safe to read back; a
 * password's is not safe to read even though it is, mechanically, just as readable. Folding both
 * into one list would either leak the password or hide the read-only field's value for no reason.
 */
export type FieldReadRefusal =
  | 'denied-type'
  | 'denied-autocomplete'
  | 'suspicious-name';

/**
 * Input types that hold no text.
 *
 * Writing to one succeeds mechanically and accomplishes nothing: setting `value` on a checkbox
 * changes the string submitted *if* it is ticked, and leaves `checked` alone. The caller is told
 * the fill worked and the box is still clear — a false success, which is worse than a refusal
 * because it is never retried.
 */
const NON_TEXT_TYPES = new Set(['checkbox', 'radio', 'submit', 'reset', 'button']);

export type FieldRefusal = FieldReadRefusal | 'not-text' | 'read-only' | 'disabled';

/**
 * Why this field's current value must not be reported back to a caller, or `null` when reading
 * it is safe.
 *
 * Reading is the strictly more dangerous direction: writing into a password box gives an agent
 * nothing, whereas reading one out hands over the secret itself. So every secrecy signal the fill
 * guard uses applies here identically — type, autocomplete token, and a name or id that indicates
 * a credential or anti-forgery token — and none of them may be relaxed for reads.
 *
 * @param field - The field's attributes.
 * @returns The first secrecy refusal, or `null` when the value may be reported.
 */
export function findFieldReadRefusal(field: FieldDescriptor): FieldReadRefusal | null {
  const type = field.type?.toLowerCase();
  if (type !== undefined && DENIED_TYPES.has(type)) return 'denied-type';

  const autocomplete = field.autocomplete?.toLowerCase();
  if (autocomplete !== undefined) {
    // The real grammar is space-separated tokens, but a comma-joined value
    // (`"new-password,current-password"`) is markup an attacker-controlled page can trivially
    // emit even though real browsers won't autofill it correctly either — splitting on
    // whitespace alone turned the whole string into one unrecognized token, so the field still
    // worked as a plain text input while looking unguarded.
    for (const token of autocomplete.split(/[\s,]+/)) {
      if (DENIED_AUTOCOMPLETE.has(token)) return 'denied-autocomplete';
    }
  }

  if (
    SUSPICIOUS_NAME.test(squashSeparators(field.name ?? ''))
    || SUSPICIOUS_NAME.test(squashSeparators(field.id ?? ''))
  ) {
    return 'suspicious-name';
  }
  return null;
}

/**
 * Why an automated fill must be refused for this field, or `null` when it is safe to write.
 *
 * Fails closed on anything that looks like a credential, payment instrument, one-time code, or
 * anti-forgery token, independent of whether the field carries an agent handle. Tagging a
 * password box does not make it fillable. Every secrecy refusal is also a fill refusal — a field
 * whose contents an agent may not read is certainly not one it may overwrite — and two further
 * refusals cover fields that are simply not writable.
 *
 * @param field - The field's attributes.
 * @returns The first refusal reason, or `null` when the field may be filled.
 */
export function findFieldFillRefusal(field: FieldDescriptor): FieldRefusal | null {
  const secrecy = findFieldReadRefusal(field);
  if (secrecy !== null) return secrecy;
  const type = field.type?.toLowerCase();
  if (type !== undefined && NON_TEXT_TYPES.has(type)) return 'not-text';
  if (field.readOnly === true) return 'read-only';
  if (field.disabled === true) return 'disabled';
  return null;
}

const FIELD_REFUSAL_MESSAGES: Record<FieldRefusal, string> = {
  'denied-type': 'this field type can never be filled by an agent',
  'denied-autocomplete': 'this field holds a credential or payment instrument',
  'suspicious-name': 'this field name indicates a secret or anti-forgery token',
  'not-text': 'this control holds no text — activate it with the click verb instead of filling it',
  'read-only': 'this field is read-only',
  disabled: 'this field is disabled',
};

const FIELD_READ_REFUSAL_MESSAGES: Record<FieldReadRefusal, string> = {
  'denied-type': 'this field type is never readable by an agent',
  'denied-autocomplete': 'this field holds a credential or payment instrument',
  'suspicious-name': 'this field name indicates a secret or anti-forgery token',
};

/** Model-readable reason for a refusal, so a blocked fill explains itself instead of failing opaquely. */
export function describeFieldRefusal(refusal: FieldRefusal): string {
  return FIELD_REFUSAL_MESSAGES[refusal];
}

/** Model-readable reason a value was withheld, so a caller knows the field has contents it may not see rather than assuming it is empty. */
export function describeFieldReadRefusal(refusal: FieldReadRefusal): string {
  return FIELD_READ_REFUSAL_MESSAGES[refusal];
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
