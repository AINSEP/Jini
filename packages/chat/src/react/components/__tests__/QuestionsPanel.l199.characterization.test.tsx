import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { QuestionForm } from '../../../core/index.js';
import { QuestionsPanel } from '../QuestionsPanel.js';

const form: QuestionForm = { id: 'brief', title: 'Brief', questions: [{ id: 'name', label: 'Name', type: 'text', required: true }] };

it.each([
  { submitDisabled: false, generating: false, busy: false },
  { submitDisabled: true, generating: false, busy: true },
  { submitDisabled: false, generating: true, busy: true },
  { submitDisabled: true, generating: true, busy: true },
])('keeps footer gates independent of editable fields: %j', ({ submitDisabled, generating, busy }) => {
  const onSubmit = vi.fn();
  render(<QuestionsPanel form={form} interactive submitDisabled={submitDisabled} generating={generating} onSubmit={onSubmit} />);
  const next = screen.getByRole('button', { name: 'Continue' });
  const skip = screen.getByRole('button', { name: 'Skip' });
  expect(next).toBeDisabled();
  expect(skip).toHaveProperty('disabled', busy);
  expect(screen.queryByText('Still generating…') !== null).toBe(generating);
  const input = screen.getByRole('textbox');
  expect(input).toBeEnabled();
  fireEvent.change(input, { target: { value: 'Ada' } });
  expect(next).toHaveProperty('disabled', busy);
  fireEvent.click(next);
  expect(onSubmit.mock.calls).toEqual(busy ? [] : [['[form answers — brief]\n- Name: Ada', { name: 'Ada' }]]);
});

it('skips an unready form through the form handle and omits the footer for even empty submitted answers', () => {
  const onSubmit = vi.fn();
  const { rerender } = render(<QuestionsPanel form={form} interactive onSubmit={onSubmit} />);
  fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(onSubmit).toHaveBeenCalledWith('[form answers — brief]\n- Name: (skipped)', {});
  rerender(<QuestionsPanel form={form} interactive submittedAnswers={{}} generating onSubmit={onSubmit} />);
  expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();
  expect(screen.queryByText('Still generating…')).toBeNull();
  rerender(<QuestionsPanel form={null} interactive onSubmit={onSubmit} />);
  expect(screen.queryByRole('textbox')).toBeNull();
});
