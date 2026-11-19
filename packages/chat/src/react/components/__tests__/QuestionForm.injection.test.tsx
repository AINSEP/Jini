import { createRef } from 'react';
import { act, render, screen } from '../../__tests__/ui-kit-render-support.js';
import { expect, it, vi } from 'vitest';
import { QuestionForm, type QuestionFormHandle } from '../QuestionForm.js';
import { useQuestionAnswers } from '../QuestionForm.answers.hooks.js';
import { useUserTextGuard } from '../../hooks/useUserTextGuard.js';
import type { QuestionForm as Form } from '../../../core/index.js';
import { SECRET_REDACTED_NOTICE } from '../../../core/user-text-redaction.js';

const form: Form = { id: 'injected', title: 'Fixture form', questions: [
  { id: 'title', label: 'Project', type: 'text', required: true },
] };

it('uses injected answers for readiness and the imperative submitted payload', () => {
  const onSubmit = vi.fn(), onReadyChange = vi.fn();
  const ref = createRef<QuestionFormHandle>();
  const useQuestionAnswersHook: typeof useQuestionAnswers = (required, optional) => ({
    ...useQuestionAnswers(required, optional), answers: { title: 'Injected project' },
  });
  render(<QuestionForm ref={ref} form={form} interactive onSubmit={onSubmit} onReadyChange={onReadyChange}
    useQuestionAnswersHook={useQuestionAnswersHook} />);
  expect(screen.getByRole('textbox', { name: 'Project' })).toHaveValue('Injected project');
  expect(onReadyChange).toHaveBeenLastCalledWith(true);
  expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  act(() => ref.current!.submit());
  expect(onSubmit).toHaveBeenCalledOnce();
  expect(onSubmit.mock.calls[0]![0]).toContain('Project: Injected project');
  expect(onSubmit.mock.calls[0]![1]).toEqual({ title: 'Injected project' });
});

it('uses the injected guard notice and one translator for footer lock and direction cards', () => {
  const cards: Form = { id: 'cards', title: 'Direction', questions: [{ id: 'direction', label: 'Direction', type: 'direction-cards',
    cards: [{ id: 'calm', label: 'Calm', mood: 'Quiet', palette: [], displayFont: 'serif', bodyFont: 'sans-serif', references: [] }],
  }] };
  const useUserTextGuardHook: typeof useUserTextGuard = (required) => ({ ...useUserTextGuard(required), secretRedacted: true });
  const useTHook = () => (key: string) => `injected:${key}`;
  const view = render(<QuestionForm form={cards} interactive onSubmit={vi.fn()} draftAnswers={{ direction: 'calm' }}
    useTHook={useTHook} useUserTextGuardHook={useUserTextGuardHook} />);
  expect(screen.getByText(`injected:${SECRET_REDACTED_NOTICE}`)).toBeVisible();
  expect(screen.getByRole('button', { name: 'injected:Continue' })).toBeVisible();
  expect(screen.getByText('injected:Selected')).toBeVisible();
  view.rerender(<QuestionForm form={cards} interactive={false} submittedAnswers={{ direction: 'calm' }} useTHook={useTHook} />);
  expect(screen.getByText('injected:Answered')).toBeVisible();
  expect(screen.getByText('injected:You answered this')).toBeVisible();
  expect(screen.getByText('injected:Selected')).toBeVisible();
});
