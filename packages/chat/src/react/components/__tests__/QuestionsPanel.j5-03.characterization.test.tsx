import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { QuestionForm } from '../../../core/index.js';
import type { RedactUserText } from '../../../core/user-text-redaction.js';
import { QuestionsPanel } from '../QuestionsPanel.js';

const form: QuestionForm = { id: 'brief', title: 'Brief', questions: [{ id: 'name', label: 'Name', type: 'text', required: true }] };

it('forwards a host redaction policy and its signal before submitting through Continue', () => {
  const redactUserText = vi.fn<RedactUserText>(() => ({ text: '[removed]', secretRedacted: true, count: 1 }));
  const onSecretRedacted = vi.fn();
  const onSubmit = vi.fn();
  render(<QuestionsPanel form={form} interactive redactUserText={redactUserText} onSecretRedacted={onSecretRedacted} onSubmit={onSubmit} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'private value' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(redactUserText).toHaveBeenCalled();
  expect(onSecretRedacted).toHaveBeenCalledWith({ secretRedacted: true, count: 1 });
  expect(onSubmit).toHaveBeenCalledWith('[form answers — brief]\n- Name: [removed]', { name: '[removed]' });
});

it('keeps a noninteractive form locked even though its Skip footer button is enabled', () => {
  const onSubmit = vi.fn();
  render(<QuestionsPanel form={form} interactive={false} onSubmit={onSubmit} />);
  expect(screen.getByRole('textbox')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Skip' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
  expect(onSubmit).not.toHaveBeenCalled();
});

it.each([{}, { submitDisabled: false }, { generating: false }, { submitDisabled: false, generating: false }])('treats omitted busy flags like explicit false: %j', (flags) => {
  const onSubmit = vi.fn();
  render(<QuestionsPanel form={form} interactive {...flags} onSubmit={onSubmit} />);
  expect(screen.queryByText('Still generating…')).toBeNull();
  expect(screen.getByRole('button', { name: 'Skip' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Ada' } });
  expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(onSubmit).toHaveBeenCalledWith('[form answers — brief]\n- Name: Ada', { name: 'Ada' });
});
