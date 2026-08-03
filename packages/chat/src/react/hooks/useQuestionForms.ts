/**
 * @module useQuestionForms
 *
 * Parses `<question-form>` artifacts out of each assistant message via
 * `@jini-ai/chat/core`'s `findFirstQuestionForm`, tracks which one (if any) is
 * still the active/answerable one, and recovers already-submitted answers by
 * reading the next user message's `[form answers — ...]` payload. Pure parse
 * — `submit` only builds the next-user-message text; the host posts it via
 * its own `sendMessage`/transport call. Per
 * `foundry/docs/jini-port/recon/r4b-webui-design.md` §4.
 *
 * `parseSubmittedAnswers` below generalizes OD's `components/QuestionForm.tsx`
 * function of the same name (verified 0 OD product references — it only
 * reverses `formatFormAnswers`'s own text format) into this package, since
 * chat-core intentionally ships only the forward direction
 * (`formatFormAnswers`).
 */
import { useCallback, useMemo } from 'react';
import type { ChatMessage, FormQuestion, QuestionForm } from '@jini-ai/chat/core';
import { findFirstQuestionForm, formOptionValueForLabel, formatFormAnswers } from '@jini-ai/chat/core';

export type QuestionFormAnswers = Record<string, string | string[]>;

export interface ParsedQuestionForm {
  form: QuestionForm;
  raw: string;
  /** The assistant message this form was found in. */
  messageId: string;
  /** `true` when this is the most recent assistant message with no reply after it yet — i.e. still answerable. */
  interactive: boolean;
  /** Recovered from the next user message's `[form answers — ...]` text, if one exists. */
  submittedAnswers: QuestionFormAnswers | undefined;
}

export interface UseQuestionFormsResult {
  /** Every question-form found across the conversation, oldest first. */
  forms: ParsedQuestionForm[];
  /** The most recent form that is still `interactive` (unanswered), or `null`. */
  activeForm: ParsedQuestionForm | null;
  /** Formats `answers` into the prose user-message text the host sends back. */
  buildSubmission: (form: QuestionForm, answers: QuestionFormAnswers) => string;
}

export function useQuestionForms(messages: ReadonlyArray<ChatMessage> | undefined): UseQuestionFormsResult {
  const forms = useMemo<ParsedQuestionForm[]>(() => {
    if (!messages || messages.length === 0) return [];
    const out: ParsedQuestionForm[] = [];
    for (let i = 0; i < messages.length; i += 1) {
      const message = messages[i];
      if (!message || message.role !== 'assistant') continue;
      const found = findFirstQuestionForm(message.content);
      if (!found) continue;
      const nextMessage = messages[i + 1];
      const submittedAnswers =
        nextMessage && nextMessage.role === 'user' ? parseSubmittedAnswers(found.form, nextMessage.content) ?? undefined : undefined;
      const interactive = submittedAnswers === undefined && i === messages.length - 1;
      out.push({ form: found.form, raw: found.raw, messageId: message.id, interactive, submittedAnswers });
    }
    return out;
  }, [messages]);

  const activeForm = useMemo(() => {
    for (let i = forms.length - 1; i >= 0; i -= 1) {
      const form = forms[i];
      if (form?.interactive) return form;
    }
    return null;
  }, [forms]);

  const buildSubmission = useCallback((form: QuestionForm, answers: QuestionFormAnswers) => formatFormAnswers(form, answers), []);

  return { forms, activeForm, buildSubmission };
}

/**
 * Reverse of `formatFormAnswers` — given the user message that (maybe)
 * answered `form`, recover the answers map so the form can render in its
 * locked "answered" state with the user's picks visible.
 */
export function parseSubmittedAnswers(form: QuestionForm, userMessageContent: string): QuestionFormAnswers | null {
  // `String.prototype.split` always returns an array of length >= 1 (even
  // `''.split('\n')` is `['']`), so `lines` can never be empty here — no
  // `lines.length === 0` guard is needed (removed as provably-dead). Index 0
  // of a non-empty array is always defined; TS just can't express that for
  // a plain numeric index, hence the assertion instead of a `?? ''` branch
  // that would never take its fallback path.
  const lines = userMessageContent.split('\n').map((l) => l.trim());
  const header = lines[0]!;
  if (!/^\[form answers/i.test(header)) return null;
  const answers: QuestionFormAnswers = {};
  const labelToId = new Map<string, string>();
  for (const q of form.questions) labelToId.set(q.label.toLowerCase(), q.id);
  for (let i = 1; i < lines.length; i += 1) {
    // `i < lines.length` is the loop condition, so this index is always
    // in-bounds and defined — same reasoning as `header` above.
    const line = lines[i]!;
    const m = /^[-*]\s*([^:]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    // Both capture groups are required (non-optional) in this pattern, so
    // they're always defined once `m` is non-null — TS just can't express
    // that for regex capture groups.
    const labelKey = m[1]!.trim().toLowerCase();
    const value = m[2]!.trim();
    const id = labelToId.get(labelKey);
    if (!id) continue;
    // `id` only ever comes from `labelToId`, which was populated from this
    // same `form.questions` array immediately above, so a question with
    // this exact `id` is always found — the `!` reflects that invariant
    // rather than gaming an untestable defensive branch.
    const question = form.questions.find((x) => x.id === id)!;
    answers[id] = decodeAnswerValue(question, value);
  }
  return Object.keys(answers).length > 0 ? answers : null;
}

function decodeAnswerValue(question: FormQuestion, value: string): string | string[] {
  if (question.type === 'checkbox') {
    return value
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.toLowerCase() !== '(skipped)')
      .map((s) => formOptionValueForLabel(question, parseSubmittedOptionToken(s)));
  }
  return value.toLowerCase() === '(skipped)' ? '' : formOptionValueForLabel(question, parseSubmittedOptionToken(value));
}

function parseSubmittedOptionToken(raw: string): string {
  const match = /\s+\[value:\s*([^\]]+)\]\s*$/i.exec(raw);
  if (!match) return raw.trim();
  // The single capture group is non-optional in this pattern, so it's
  // always defined once `match` is non-null — same regex-capture-group
  // caveat as `parseSubmittedAnswers` above.
  return match[1]!.trim();
}
