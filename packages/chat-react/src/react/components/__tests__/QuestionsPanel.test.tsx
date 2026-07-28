import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { QuestionForm as QuestionFormType } from '@injini/chat-core';
import { QuestionsPanel } from '../QuestionsPanel.js';

const form: QuestionFormType = {
  id: 'discovery',
  title: 'Quick brief',
  questions: [{ id: 'platform', label: 'Platform', type: 'radio', options: [{ label: 'Mobile', value: 'mobile' }], required: true }],
};

describe('QuestionsPanel', () => {
  it('renders nothing when there is no form', () => {
    const { container } = render(<QuestionsPanel form={null} interactive onSubmit={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('Continue is disabled until required questions are answered, then submits via the panel button', async () => {
    const onSubmit = vi.fn();
    render(<QuestionsPanel form={form} interactive onSubmit={onSubmit} />);
    const continueBtn = screen.getByRole('button', { name: 'Continue' });
    expect(continueBtn).toBeDisabled();
    await userEvent.click(screen.getByRole('radio', { name: 'Mobile' }));
    expect(continueBtn).not.toBeDisabled();
    await userEvent.click(continueBtn);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('Skip submits with every question skipped, bypassing the ready gate', async () => {
    const onSubmit = vi.fn();
    render(<QuestionsPanel form={form} interactive onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0]).toContain('(skipped)');
  });

  it('hides the footer once the form is answered', () => {
    render(<QuestionsPanel form={form} interactive={false} submittedAnswers={{ platform: 'mobile' }} onSubmit={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument();
  });

  it('disables Continue/Skip while generating, without locking the form fields', () => {
    render(<QuestionsPanel form={form} interactive submitDisabled generating onSubmit={() => {}} />);
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Skip' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Mobile' })).not.toBeDisabled();
  });
});
