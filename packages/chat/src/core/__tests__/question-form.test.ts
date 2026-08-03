import { describe, expect, it } from 'vitest';
import {
  formatFormAnswers,
  formOptionLabelForValue,
  formOptionValueForLabel,
  hasUnterminatedQuestionForm,
  parsePartialQuestionForm,
  parseQuestionForm,
  splitOnQuestionForms,
  stripTrailingOpenQuestionForm,
  type QuestionType,
} from '../question-form.js';

const FORM_BODY = JSON.stringify({
  id: 'discovery',
  title: 'Quick brief',
  questions: [
    { id: 'platform', label: 'Platform', type: 'radio', options: ['Mobile', 'Desktop'], required: true },
    { id: 'audience', label: 'Primary audience', type: 'text' },
  ],
});

describe('question-form: complete parsing', () => {
  it('splits prose + a single well-formed form into ordered segments', () => {
    const input = `Sure, one sec.\n<question-form>${FORM_BODY}</question-form>\nThanks!`;
    const segments = splitOnQuestionForms(input);
    expect(segments.map((s) => s.kind)).toEqual(['text', 'form', 'text']);
    const form = segments.find((s) => s.kind === 'form');
    expect(form?.kind === 'form' && form.form.questions).toHaveLength(2);
  });

  it('accepts the <ask-question> alias tag name and matches close tags by backreference', () => {
    const input = `<ask-question>${FORM_BODY}</ask-question>`;
    const form = parseQuestionForm(input);
    expect(form?.id).toBe('discovery');
  });

  it('does not splice across a mismatched open/close tag-name pair', () => {
    // A form opened as <question-form> but "closed" with </ask-question> should
    // not match; the block is left as unterminated prose, not parsed as a form.
    const input = `<question-form>${FORM_BODY}</ask-question>`;
    expect(parseQuestionForm(input)).toBeNull();
  });

  it('leaves a malformed (non-JSON) body as raw text instead of throwing', () => {
    const input = '<question-form>{not valid json</question-form>';
    const segments = splitOnQuestionForms(input);
    expect(segments).toEqual([{ kind: 'text', text: input }]);
  });

  it('rejects a form with zero questions', () => {
    const input = `<question-form>${JSON.stringify({ questions: [] })}</question-form>`;
    expect(parseQuestionForm(input)).toBeNull();
  });

  it('unwraps a ```json fenced body some models echo', () => {
    const input = '<question-form>```json\n' + FORM_BODY + '\n```</question-form>';
    const form = parseQuestionForm(input);
    expect(form?.questions).toHaveLength(2);
  });
});

describe('question-form: streaming', () => {
  it('detects an unterminated open form and strips it from visible text', () => {
    const input = `Let me ask you a few things.\n<question-form>{"id":"d","questi`;
    expect(hasUnterminatedQuestionForm(input)).toBe(true);
    const { text, hadOpenForm } = stripTrailingOpenQuestionForm(input);
    expect(hadOpenForm).toBe(true);
    expect(text).toBe('Let me ask you a few things.\n');
  });

  it('reports no open form once the block is fully closed', () => {
    const input = `<question-form>${FORM_BODY}</question-form>`;
    expect(hasUnterminatedQuestionForm(input)).toBe(false);
  });

  it('reports no open form and echoes the text unchanged when there is no question-form tag at all', () => {
    const input = 'just an ordinary chat reply with no forms in it';
    expect(stripTrailingOpenQuestionForm(input)).toEqual({ text: input, hadOpenForm: false });
    expect(hasUnterminatedQuestionForm(input)).toBe(false);
  });

  it('progressively reveals only fully-closed question objects, holding back the trailing in-flight one', () => {
    // The first question object is complete; the second is still streaming
    // (no closing brace yet) and has no id yet either — it must be held back
    // so the preview never shows a churning fallback id.
    const partialBody = '{"id":"discovery","title":"Quick brief","questions":[{"id":"platform","label":"Platform","type":"radio"},{"label":"Primary aud';
    const input = `<question-form>${partialBody}`;
    const preview = parsePartialQuestionForm(input);
    expect(preview?.id).toBe('discovery');
    expect(preview?.questions).toHaveLength(1);
    expect(preview?.questions[0]?.id).toBe('platform');
  });

  it('keeps a stable default id until the streamed id string literal is fully terminated', () => {
    const stillStreamingId = '<question-form>{"id":"disc';
    const early = parsePartialQuestionForm(stillStreamingId);
    expect(early?.id).toBe('discovery'); // stable default, not a truncated "disc"

    const idJustClosed = '<question-form>{"id":"disco","title":"T","questions":[';
    const later = parsePartialQuestionForm(idJustClosed);
    expect(later?.id).toBe('disco');
  });

  it('returns null when there is no open tag at all', () => {
    expect(parsePartialQuestionForm('just plain prose, no form here')).toBeNull();
  });
});

describe('question-form: answer formatting + option resolution', () => {
  const form = parseQuestionForm(`<question-form>${FORM_BODY}</question-form>`)!;

  it('formats a mix of answered and skipped questions', () => {
    const text = formatFormAnswers(form, { platform: 'Mobile' });
    expect(text).toContain('[form answers — discovery]');
    expect(text).toContain('- Platform: Mobile');
    expect(text).toContain('- Primary audience: (skipped)');
  });

  it('formats an array answer (checkbox-style) by joining resolved labels', () => {
    const text = formatFormAnswers(form, { platform: ['Mobile', 'Desktop'] });
    expect(text).toContain('- Platform: Mobile, Desktop');
  });

  it('round-trips label<->value resolution for a matched option, and passes unmatched values through unchanged', () => {
    const q = form.questions[0]!;
    expect(formOptionValueForLabel(q, 'Mobile')).toBe('Mobile');
    expect(formOptionLabelForValue(q, 'Mobile')).toBe('Mobile');
    expect(formOptionValueForLabel(q, 'nonexistent-option')).toBe('nonexistent-option');
  });
});

describe('question-form: mapRawQuestion field coverage', () => {
  function formWith(question: Record<string, unknown>) {
    const body = JSON.stringify({ id: 'f', title: 'T', questions: [question] });
    return parseQuestionForm(`<question-form>${body}</question-form>`);
  }

  it('carries through maxSelections only for checkbox questions with a valid positive integer', () => {
    expect(formWith({ label: 'L', type: 'checkbox', maxSelections: 3 })?.questions[0]?.maxSelections).toBe(3);
    // Not a checkbox: dropped even though maxSelections is valid.
    expect(formWith({ label: 'L', type: 'text', maxSelections: 3 })?.questions[0]?.maxSelections).toBeUndefined();
    // Invalid: non-integer, non-positive, or wrong type.
    expect(formWith({ label: 'L', type: 'checkbox', maxSelections: 1.5 })?.questions[0]?.maxSelections).toBeUndefined();
    expect(formWith({ label: 'L', type: 'checkbox', maxSelections: 0 })?.questions[0]?.maxSelections).toBeUndefined();
    expect(formWith({ label: 'L', type: 'checkbox', maxSelections: '3' })?.questions[0]?.maxSelections).toBeUndefined();
  });

  it('resolves allowCustom from either allowCustom or the legacy "custom" key, with allowCustom=false taking precedence', () => {
    expect(formWith({ label: 'L', type: 'text', allowCustom: true })?.questions[0]?.allowCustom).toBe(true);
    expect(formWith({ label: 'L', type: 'text', custom: true })?.questions[0]?.allowCustom).toBe(true);
    expect(formWith({ label: 'L', type: 'text', allowCustom: false, custom: true })?.questions[0]?.allowCustom).toBe(false);
    expect(formWith({ label: 'L', type: 'text' })?.questions[0]?.allowCustom).toBeUndefined();
  });

  it('carries through customLabel/customPlaceholder when present as strings', () => {
    const q = formWith({ label: 'L', type: 'text', customLabel: 'Other', customPlaceholder: 'Type here' })?.questions[0];
    expect(q).toMatchObject({ customLabel: 'Other', customPlaceholder: 'Type here' });
  });

  it('parses numeric min/max/step from either a number or a numeric string, dropping non-numeric ones', () => {
    const q = formWith({ label: 'L', type: 'range', min: '0', max: 10, step: 'nope' })?.questions[0];
    expect(q).toMatchObject({ min: 0, max: 10 });
    expect(q?.step).toBeUndefined();
  });

  it('carries multiple/accept only for file-typed questions', () => {
    const fileQ = formWith({ label: 'L', type: 'file', multiple: true, accept: '.png' })?.questions[0];
    expect(fileQ).toMatchObject({ multiple: true, accept: '.png' });
    const textQ = formWith({ label: 'L', type: 'text', multiple: true, accept: '.png' })?.questions[0];
    expect(textQ?.multiple).toBeUndefined();
    expect(textQ?.accept).toBeUndefined();
  });

  it('falls back to the question id when label is missing/non-string, and to an index-based id when id is missing', () => {
    const body = JSON.stringify({ questions: [{ type: 'text' }] });
    const q = parseQuestionForm(`<question-form>${body}</question-form>`)?.questions[0];
    expect(q?.id).toBe('q1');
    expect(q?.label).toBe('q1');
  });

  it('normalizes every documented type alias to its canonical QuestionType', () => {
    const cases: Array<[string, QuestionType]> = [
      ['single', 'radio'],
      ['choice', 'radio'],
      ['multi', 'checkbox'],
      ['multiple', 'checkbox'],
      ['dropdown', 'select'],
      ['long', 'textarea'],
      ['paragraph', 'textarea'],
      ['numeric', 'number'],
      ['slider', 'range'],
      ['date', 'date'],
      ['time', 'time'],
      ['datetime', 'datetime-local'],
      ['date-time', 'datetime-local'],
      ['datetime_local', 'datetime-local'],
      ['colour', 'color'],
      ['color-picker', 'color'],
      ['link', 'url'],
      ['email', 'email'],
      ['phone', 'tel'],
      ['upload', 'file'],
      ['attachment', 'file'],
      ['toggle', 'switch'],
      ['boolean', 'switch'],
      ['directions', 'direction-cards'],
      ['cards', 'direction-cards'],
      ['direction', 'direction-cards'],
      ['  RADIO  ', 'radio'],
      ['totally-unknown-type', 'text'],
    ];
    for (const [raw, expected] of cases) {
      expect(formWith({ label: 'L', type: raw })?.questions[0]?.type).toBe(expected);
    }
    // Non-string type input also falls back to 'text'.
    expect(formWith({ label: 'L', type: 42 })?.questions[0]?.type).toBe('text');
  });

  it('parses string-shorthand options and object options, dropping blank ones', () => {
    const q = formWith({
      label: 'L',
      type: 'radio',
      options: ['  Mobile  ', '', { label: 'Desktop', value: 'desktop-v', description: '  wide screens  ' }, { label: '  ' }, 123],
    })?.questions[0];
    expect(q?.options).toEqual([
      { label: 'Mobile', value: 'Mobile' },
      { label: 'Desktop', value: 'desktop-v', description: 'wide screens' },
    ]);
  });

  it('drops the options array entirely when every candidate is invalid', () => {
    expect(formWith({ label: 'L', type: 'radio', options: ['', {}] })?.questions[0]?.options).toBeUndefined();
    expect(formWith({ label: 'L', type: 'radio', options: 'not-an-array' })?.questions[0]?.options).toBeUndefined();
  });

  it('resolves a string defaultValue and an array defaultValue through the option label/value map', () => {
    const single = formWith({
      label: 'L',
      type: 'radio',
      options: [{ label: 'Mobile', value: 'm' }],
      defaultValue: 'Mobile',
    })?.questions[0];
    expect(single?.defaultValue).toBe('m');

    const multi = formWith({
      label: 'L',
      type: 'checkbox',
      options: [{ label: 'Mobile', value: 'm' }, { label: 'Desktop', value: 'd' }],
      defaultValue: ['Mobile', 'nonexistent', 42],
    })?.questions[0];
    expect(multi?.defaultValue).toEqual(['m', 'nonexistent']);
  });

  it('coerces a numeric or boolean defaultValue/default to a string', () => {
    expect(formWith({ label: 'L', type: 'number', defaultValue: 5 })?.questions[0]?.defaultValue).toBe('5');
    expect(formWith({ label: 'L', type: 'switch', defaultValue: true })?.questions[0]?.defaultValue).toBe('true');
    expect(formWith({ label: 'L', type: 'text', default: 'legacy-key' })?.questions[0]?.defaultValue).toBe('legacy-key');
    expect(formWith({ label: 'L', type: 'number', default: 7 })?.questions[0]?.defaultValue).toBe('7');
    expect(formWith({ label: 'L', type: 'switch', default: false })?.questions[0]?.defaultValue).toBe('false');
    expect(formWith({ label: 'L', type: 'text' })?.questions[0]?.defaultValue).toBeUndefined();
  });

  it('carries through placeholder and help text when present', () => {
    const q = formWith({ label: 'L', type: 'text', placeholder: 'Type…', help: 'Some help text' })?.questions[0];
    expect(q).toMatchObject({ placeholder: 'Type…', help: 'Some help text' });
  });
});

describe('question-form: attrs id/title precedence and description/submitLabel', () => {
  it('prefers the open-tag attrs id/title over the JSON body, and carries description/submitLabel', () => {
    const body = JSON.stringify({
      id: 'body-id',
      title: 'Body Title',
      description: 'A helpful description',
      submitLabel: 'Send it',
      questions: [{ label: 'L', type: 'text' }],
    });
    const form = parseQuestionForm(`<question-form id="attr-id" title="Attr Title">${body}</question-form>`);
    expect(form).toMatchObject({
      id: 'attr-id',
      title: 'Attr Title',
      description: 'A helpful description',
      submitLabel: 'Send it',
    });
  });

  it('falls back to the JSON body id/title when attrs omit them, and to defaults when both omit them', () => {
    const withBodyOnly = parseQuestionForm(
      `<question-form>${JSON.stringify({ id: 'body-id', title: 'Body Title', questions: [{ label: 'L', type: 'text' }] })}</question-form>`,
    );
    expect(withBodyOnly).toMatchObject({ id: 'body-id', title: 'Body Title' });

    const withNeither = parseQuestionForm(
      `<question-form>${JSON.stringify({ questions: [{ label: 'L', type: 'text' }] })}</question-form>`,
    );
    expect(withNeither).toMatchObject({ id: 'discovery', title: 'A few quick questions' });
  });

  it('parses single-quoted open-tag attribute values the same as double-quoted ones', () => {
    const body = JSON.stringify({ questions: [{ label: 'L', type: 'text' }] });
    const form = parseQuestionForm(`<question-form id='single-quoted'>${body}</question-form>`);
    expect(form?.id).toBe('single-quoted');
  });
});

describe('question-form: streaming edge cases', () => {
  it('parsePartialQuestionForm reads title/description/submitLabel once they parse from the (still partial) JSON body', () => {
    const body = JSON.stringify({ title: 'Streaming Title', description: 'desc', submitLabel: 'Go', questions: [] });
    const preview = parsePartialQuestionForm(`<question-form>${body}`);
    expect(preview).toMatchObject({ title: 'Streaming Title', description: 'desc', submitLabel: 'Go' });
  });

  it('parsePartialQuestionForm strips a fully-streamed trailing fence but keeps one still inside an open string value', () => {
    const closedFence = '<question-form>```json\n{"title":"T","questions":[]}\n```';
    expect(parsePartialQuestionForm(closedFence)?.title).toBe('T');

    // The stray backticks are inside a still-open string value (an unterminated "title"), so they
    // must NOT be treated as a closing fence — stripping them would corrupt the JSON differently,
    // but either way this must not throw.
    const backtickInString = '<question-form>{"title": "a value with a trailing ```';
    expect(() => parsePartialQuestionForm(backtickInString)).not.toThrow();
  });

  it('parsePartialQuestionForm resolves a still-streaming close tag position (closeIdx found, not just -1)', () => {
    const body = JSON.stringify({ title: 'Closed', questions: [] });
    const preview = parsePartialQuestionForm(`<question-form>${body}</question-form> trailing text after`);
    expect(preview?.title).toBe('Closed');
  });

  it('does not adopt a nested question id as the form-level id while streaming', () => {
    const partial = '<question-form>{"questions":[{"id":"nested-q-id","label":"Q"';
    const preview = parsePartialQuestionForm(partial);
    expect(preview?.id).toBe('discovery');
  });

  it('does not mistake a top-level value string that happens to spell "id" for the id key itself', () => {
    const partial = '<question-form>{"category":"id","id":"real-id","title":"T","questions":[';
    const preview = parsePartialQuestionForm(partial);
    expect(preview?.id).toBe('real-id');
  });

  it('falls back to the raw (unescaped) string when reconstructing an id value with an invalid JSON escape sequence', () => {
    const partial = String.raw`<question-form>{"id":"bad\zescape","title":"T","questions":[`;
    const preview = parsePartialQuestionForm(partial);
    expect(preview?.id).toBe('bad\\zescape');
  });

  it('handles an id value containing an escaped backslash and quote without throwing', () => {
    const partial = String.raw`<question-form>{"id":"has\\a\"quote","title":"T","questions":[`;
    expect(() => parsePartialQuestionForm(partial)).not.toThrow();
  });

  it('reveals a closed question object even without an id once the object itself has closed', () => {
    const body = '{"questions":[{"label":"Closed question","type":"text"}]}';
    const preview = parsePartialQuestionForm(`<question-form>${body}`);
    expect(preview?.questions).toHaveLength(1);
    expect(preview?.questions[0]?.label).toBe('Closed question');
  });

  it('drops a raw question entry that is not an object, or whose label is missing/blank', () => {
    const body = '{"questions":[42,{"id":"a"},{"id":"b","label":"   "}]}';
    const preview = parsePartialQuestionForm(`<question-form>${body}}`);
    expect(preview?.questions).toEqual([]);
  });

  it('countClosedQuestionObjects tolerates escaped quotes inside a question object without miscounting braces', () => {
    const body = String.raw`{"questions":[{"id":"a","label":"has \" a quote"},{"id":"b","label":"second"}]}`;
    const preview = parsePartialQuestionForm(`<question-form>${body}`);
    expect(preview?.questions).toHaveLength(2);
  });

  it('accepts the <ask-question> alias while streaming, including a not-yet-closed one', () => {
    const input = '<ask-question>{"title":"Streaming via alias","questi';
    const preview = parsePartialQuestionForm(input);
    expect(preview?.title).toBe('Streaming via alias');
  });
});

describe('question-form: formatFormAnswers option-display branches', () => {
  const formBody = JSON.stringify({
    id: 'f',
    title: 'T',
    questions: [
      { id: 'sameval', label: 'Same', type: 'radio', options: [{ label: 'Yes', value: 'Yes' }] },
      { id: 'diffval', label: 'Different', type: 'radio', options: [{ label: 'Mobile App', value: 'mobile' }] },
    ],
  });
  const form = parseQuestionForm(`<question-form>${formBody}</question-form>`)!;

  it('shows the bare label when the matched option value equals its label', () => {
    expect(formatFormAnswers(form, { sameval: 'Yes' })).toContain('- Same: Yes');
  });

  it('shows "label [value: value]" when the matched option value differs from its label', () => {
    expect(formatFormAnswers(form, { diffval: 'mobile' })).toContain('- Different: Mobile App [value: mobile]');
  });

  it('shows the empty answer marker for an empty-array answer and a blank-string answer', () => {
    expect(formatFormAnswers(form, { sameval: [] })).toContain('- Same: (skipped)');
    expect(formatFormAnswers(form, { diffval: '   ' })).toContain('- Different: (skipped)');
  });

  it('formOptionLabelForValue passes an unmatched value through unchanged', () => {
    expect(formOptionLabelForValue(form.questions[0]!, 'nonexistent')).toBe('nonexistent');
  });

  it('formOptionValueForLabel/LabelForValue on a question with no options list at all just echo the input', () => {
    const noOptionsQuestion = { options: undefined };
    expect(formOptionValueForLabel(noOptionsQuestion, 'anything')).toBe('anything');
    expect(formOptionLabelForValue(noOptionsQuestion, 'anything')).toBe('anything');
  });

  it('formatFormAnswers echoes an unmatched answer value verbatim (no option display substitution)', () => {
    expect(formatFormAnswers(form, { sameval: 'not-an-option' })).toContain('- Same: not-an-option');
  });
});

describe('question-form: direction-cards', () => {
  it('parses card metadata and caps references/palette arrays to their documented limits', () => {
    const cards = Array.from({ length: 3 }, (_, i) => ({
      id: `card-${i}`,
      label: `Card ${i}`,
      mood: 'moody',
      references: Array.from({ length: 10 }, (_, j) => `ref-${j}`),
      palette: Array.from({ length: 12 }, (_, j) => `#00000${j}`),
    }));
    const body = JSON.stringify({
      questions: [{ id: 'direction', label: 'Pick a direction', type: 'direction-cards', cards }],
    });
    const form = parseQuestionForm(`<question-form>${body}</question-form>`);
    const question = form?.questions[0];
    expect(question?.type).toBe('direction-cards');
    expect(question?.cards).toHaveLength(3);
    expect(question?.cards?.[0]?.references).toHaveLength(6);
    expect(question?.cards?.[0]?.palette).toHaveLength(8);
  });

  it('drops a card entry missing id or label, defaults mood/font fields, and returns undefined for an all-invalid array', () => {
    const body = JSON.stringify({
      questions: [
        {
          label: 'Pick',
          type: 'direction-cards',
          cards: [{ id: 'ok', label: 'OK Card' }, { label: 'no id' }, { id: 'no-label' }, 'not-an-object'],
        },
      ],
    });
    const form = parseQuestionForm(`<question-form>${body}</question-form>`);
    const card = form?.questions[0]?.cards?.[0];
    expect(form?.questions[0]?.cards).toHaveLength(1);
    expect(card).toMatchObject({ id: 'ok', label: 'OK Card', mood: '', references: [], palette: [], displayFont: 'Georgia, serif' });

    const allInvalid = JSON.stringify({ questions: [{ label: 'Pick', type: 'direction-cards', cards: [{ label: 'no id' }] }] });
    const allInvalidForm = parseQuestionForm(`<question-form>${allInvalid}</question-form>`);
    expect(allInvalidForm?.questions[0]?.cards).toBeUndefined();
  });

  it('returns undefined cards for a non-array cards value', () => {
    const body = JSON.stringify({ questions: [{ label: 'Pick', type: 'direction-cards', cards: 'nope' }] });
    const form = parseQuestionForm(`<question-form>${body}</question-form>`);
    expect(form?.questions[0]?.cards).toBeUndefined();
  });

  it('carries through a custom displayFont/bodyFont when the card provides them', () => {
    const body = JSON.stringify({
      questions: [{ label: 'Pick', type: 'direction-cards', cards: [{ id: 'ok', label: 'OK', displayFont: 'Custom Display', bodyFont: 'Custom Body' }] }],
    });
    const form = parseQuestionForm(`<question-form>${body}</question-form>`);
    expect(form?.questions[0]?.cards?.[0]).toMatchObject({ displayFont: 'Custom Display', bodyFont: 'Custom Body' });
  });

  it('leaves mood/displayFont/bodyFont at their documented defaults when a card omits them entirely', () => {
    const body = JSON.stringify({ questions: [{ label: 'Pick', type: 'direction-cards', cards: [{ id: 'ok', label: 'OK' }] }] });
    const form = parseQuestionForm(`<question-form>${body}</question-form>`);
    expect(form?.questions[0]?.cards?.[0]).toMatchObject({
      mood: '',
      displayFont: 'Georgia, serif',
      bodyFont: '-apple-system, system-ui, sans-serif',
    });
  });
});

describe('question-form: remaining tryParseForm/mapRawQuestion/completeTopLevelString branches', () => {
  it('treats a whitespace-only body the same as an empty one (no recoverable JSON)', () => {
    const input = '<question-form>   </question-form>';
    expect(splitOnQuestionForms(input)).toEqual([{ kind: 'text', text: input }]);
  });

  it('rejects a body that parses as valid JSON but is not an object (e.g. a bare number or null)', () => {
    expect(parseQuestionForm('<question-form>42</question-form>')).toBeNull();
    expect(parseQuestionForm('<question-form>null</question-form>')).toBeNull();
  });

  it('rejects a well-formed JSON object whose "questions" field is missing or not an array', () => {
    expect(parseQuestionForm('<question-form>{"id":"x"}</question-form>')).toBeNull();
    expect(parseQuestionForm('<question-form>{"questions":"nope"}</question-form>')).toBeNull();
  });

  it('drops a non-object entry in the questions array while keeping the valid ones (complete parse, not just streaming)', () => {
    const body = JSON.stringify({ questions: [42, { label: 'Real question', type: 'text' }] });
    const form = parseQuestionForm(`<question-form>${body}</question-form>`);
    expect(form?.questions).toHaveLength(1);
    expect(form?.questions[0]?.label).toBe('Real question');
  });

  it('carries through a valid numeric step value', () => {
    const body = JSON.stringify({ questions: [{ label: 'L', type: 'range', step: 5 }] });
    const form = parseQuestionForm(`<question-form>${body}</question-form>`);
    expect(form?.questions[0]?.step).toBe(5);
  });

  it('falls back to the option label when its value trims to empty', () => {
    const body = JSON.stringify({ questions: [{ label: 'L', type: 'radio', options: [{ label: 'Mobile', value: '   ' }] }] });
    const form = parseQuestionForm(`<question-form>${body}</question-form>`);
    expect(form?.questions[0]?.options?.[0]).toEqual({ label: 'Mobile', value: 'Mobile' });
  });

  it('endsInsideJsonString correctly tracks an escaped quote/backslash before a trailing fence marker', () => {
    // `\\"` is an escaped quote inside the string (does not close it), so the whole tail
    // (including the stray backticks) is still "inside" the open string value.
    const partial = String.raw`<question-form>{"title": "a value with an escaped \" quote and a trailing ` + '```';
    expect(() => parsePartialQuestionForm(partial)).not.toThrow();
  });

  it('completeTopLevelString tolerates whitespace between the key/colon and the colon/value', () => {
    const partial = '<question-form>{"id"   :   "spaced-id","title":"T","questions":[';
    const preview = parsePartialQuestionForm(partial);
    expect(preview?.id).toBe('spaced-id');
  });

  it('completeTopLevelString returns undefined (falls back to default) when the id value is not a string at all', () => {
    const partial = '<question-form>{"id": 123, "title":"T","questions":[';
    const preview = parsePartialQuestionForm(partial);
    expect(preview?.id).toBe('discovery');
  });

  it('shapeStreamingQuestions drops a non-object raw entry and one with a missing/blank label while streaming', () => {
    const body = '{"questions":[42,{"id":"a"},{"id":"b","label":"   "},{"id":"c","label":"Kept"}]}';
    const preview = parsePartialQuestionForm(`<question-form>${body}`);
    expect(preview?.questions.map((q) => q.label)).toEqual(['Kept']);
  });
});
