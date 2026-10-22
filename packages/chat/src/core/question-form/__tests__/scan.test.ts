import { describe, expect, it } from 'vitest';
import {
  findFirstQuestionForm,
  parsePartialQuestionForm,
  parseQuestionForm,
  splitOnQuestionForms,
  stripTrailingOpenQuestionForm,
} from '../scan.js';

const Q = { id: 'a', label: 'A' };
const body = (extra: Record<string, unknown> = {}) => JSON.stringify({ questions: [Q], ...extra });

describe('splitOnQuestionForms block boundaries', () => {
  it('keeps a complete form and leaves a later unterminated block as prose', () => {
    const input = `<question-form>${body()}</question-form>tail<question-form>{"questions":[`;
    const segments = splitOnQuestionForms({ input });
    expect(segments.map((s) => s.kind)).toEqual(['form', 'text']);
    expect(segments[1]).toEqual({ kind: 'text', text: 'tail<question-form>{"questions":[' });
  });

  it('matches a close tag whose case differs from the open tag', () => {
    const segments = splitOnQuestionForms({ input: `<Question-Form>${body()}</QUESTION-FORM>` });
    expect(segments).toHaveLength(1);
    expect(segments[0]?.kind).toBe('form');
  });

  it('emits two adjacent forms with no empty prose segment between them', () => {
    const block = `<question-form>${body()}</question-form>`;
    expect(splitOnQuestionForms({ input: block + block }).map((s) => s.kind)).toEqual(['form', 'form']);
  });

  it('returns no segments for empty input', () => {
    expect(splitOnQuestionForms({ input: '' })).toEqual([]);
  });

  it('keeps the exact raw block text on a parsed form segment', () => {
    const raw = `<ask-question title="T">${body()}</ask-question>`;
    expect(findFirstQuestionForm({ input: `x${raw}y` })?.raw).toBe(raw);
  });

  it('finds the first parseable form after a malformed one', () => {
    const input = `<question-form>nope</question-form><question-form>${body({ id: 'second' })}</question-form>`;
    expect(findFirstQuestionForm({ input })?.form.id).toBe('second');
  });
});

describe('stripTrailingOpenQuestionForm', () => {
  it('strips only the trailing open block after a closed one', () => {
    const closed = `<question-form>${body()}</question-form>`;
    expect(stripTrailingOpenQuestionForm({ input: `${closed}mid<ask-question>{` })).toEqual({ text: `${closed}mid`, hadOpenForm: true });
  });

  it('reports no open form for empty input', () => {
    expect(stripTrailingOpenQuestionForm({ input: '' })).toEqual({ text: '', hadOpenForm: false });
  });
});

describe('complete form parsing (tryParseForm)', () => {
  it('rejects a JSON array body', () => {
    expect(parseQuestionForm({ input: '<question-form>[]</question-form>' })).toBeNull();
  });

  it('unwraps a bare ``` fence with no json tag', () => {
    expect(parseQuestionForm({ input: `<question-form>\n\`\`\`\n${body()}\n\`\`\`\n</question-form>` })?.questions).toHaveLength(1);
  });

  it('rejects a form whose every question entry is unusable', () => {
    expect(parseQuestionForm({ input: '<question-form>{"questions":[1,null,"x"]}</question-form>' })).toBeNull();
  });

  it('keeps an empty-string id attribute rather than falling back to the body id', () => {
    expect(parseQuestionForm({ input: `<question-form id="">${body({ id: 'body-id' })}</question-form>` })?.id).toBe('');
  });

  it('keeps a whitespace-only body title on the complete path', () => {
    expect(parseQuestionForm({ input: `<question-form>${body({ title: '  ' })}</question-form>` })?.title).toBe('  ');
  });

  it('drops an empty description and submitLabel', () => {
    const form = parseQuestionForm({ input: `<question-form>${body({ description: '', submitLabel: '' })}</question-form>` });
    expect(form).not.toHaveProperty('description');
    expect(form).not.toHaveProperty('submitLabel');
  });

  it('ignores non-string id and title in the body', () => {
    const form = parseQuestionForm({ input: `<question-form>${body({ id: 7, title: false })}</question-form>` });
    expect(form?.id).toBe('discovery');
    expect(form?.title).toBe('A few quick questions');
  });
});

describe('streaming form parsing (parsePartialQuestionForm)', () => {
  const partial = (rest: string) => parsePartialQuestionForm({ input: `<question-form>${rest}` });

  it('returns a frame with defaults for a bare open tag', () => {
    expect(partial('')).toEqual({ id: 'discovery', title: 'A few quick questions', questions: [] });
  });

  it('falls back to the default title when the streamed title is blank', () => {
    expect(partial('{"title":"   "')?.title).toBe('A few quick questions');
  });

  it('ignores a top-level JSON array body', () => {
    expect(partial('[{"label":"x"}]')).toEqual({ id: 'discovery', title: 'A few quick questions', questions: [] });
  });

  it('decodes an escaped quote inside a terminated id', () => {
    expect(partial('{"id":"a\\"b",')?.id).toBe('a"b');
  });

  it('keeps the default id while the id key has streamed but its colon has not', () => {
    expect(partial('{"id"')?.id).toBe('discovery');
  });

  it('keeps the default id while the id value is still open', () => {
    expect(partial('{"id":"abc')?.id).toBe('discovery');
  });

  it('keeps the default id when the colon arrived but the value has not', () => {
    expect(partial('{"id": ')?.id).toBe('discovery');
  });

  it('does not adopt an id nested inside a top-level array', () => {
    expect(partial('{"tags":[{"id":"nested"}],"x":1')?.id).toBe('discovery');
  });

  it('adopts the top-level id that follows a closed nested object', () => {
    expect(partial('{"meta":{"id":"inner"},"id":"outer"')?.id).toBe('outer');
  });

  it('adopts the id key rather than an earlier top-level string field', () => {
    expect(partial('{"ab":"x","id":"real"')?.id).toBe('real');
  });

  it('keeps the default id when an earlier string value never terminates', () => {
    expect(partial('{"note":"open')?.id).toBe('discovery');
  });

  it('stops counting closed questions at a non-object array element', () => {
    // The string element stops the closed-object walk, so the later object
    // (which has no id) is treated as still in flight and held back.
    const form = partial('{"questions":["x",{"label":"L"}');
    expect(form?.questions).toEqual([]);
  });

  it('counts closed questions separated by commas and whitespace', () => {
    const form = partial('{"questions":[ {"label":"A"} ,\n {"label":"B"}, {"label":"C"');
    expect(form?.questions.map((q) => q.id)).toEqual(['q1', 'q2']);
  });

  it('counts a question object as closed only at its own closing brace, not a nested one', () => {
    const form = partial('{"questions":[{"x":{},"label":"A"},{"label":"B"}');
    expect(form?.questions.map((q) => q.label)).toEqual(['A', 'B']);
  });

  it('counts no closed question when the array has just opened', () => {
    expect(partial('{"questions":[')?.questions).toEqual([]);
  });

  it('treats a brace inside a question string as content, not structure', () => {
    const form = partial('{"questions":[{"label":"a}b"},{"label":"c{"');
    expect(form?.questions.map((q) => q.label)).toEqual(['a}b']);
  });

  it('keeps a trailing fence when a backslash leaves the last string open', () => {
    // The escaped quote keeps the title string open, so the backticks are its content.
    expect(partial('{"title":"a\\"```')?.title).toBe('a"```');
  });

  it('strips a partially streamed closing fence after complete JSON', () => {
    expect(partial(`\`\`\`json\n${body({ title: 'T' })}\n\``)?.title).toBe('T');
  });

  it('reads the body only up to the close tag', () => {
    const form = parsePartialQuestionForm({ input: `<question-form>${body({ title: 'T' })}</question-form>{"title":"later"}` });
    expect(form?.title).toBe('T');
  });
});
