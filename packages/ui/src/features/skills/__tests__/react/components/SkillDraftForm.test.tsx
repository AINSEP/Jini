import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { SkillDraft } from '../../../types.js';
import { SkillDraftForm, type SkillDraftFormProps } from '../../../react/components/SkillDraftForm.js';

const EMPTY_DRAFT: SkillDraft = { name: '', description: '', triggers: '', body: '' };

function renderForm(overrides: Partial<SkillDraftFormProps> = {}) {
  // The `draft` prop passed in stays fixed for the life of this render (no
  // real state backs it), so a controlled `<input>`'s DOM value gets reverted
  // by React right after the change event if nothing re-renders it — the
  // classic "controlled input with a no-op onChange" trap. Applying each
  // updater to `EMPTY_DRAFT` SYNCHRONOUSLY, inside the mock's own call, reads
  // `event.target.value` while it still holds what was typed, before that
  // revert happens; reading it lazily after `userEvent.type` resolves does not.
  const appliedDrafts: SkillDraft[] = [];
  const onDraftChange = vi.fn((updater: (draft: SkillDraft) => SkillDraft) => {
    appliedDrafts.push(updater(EMPTY_DRAFT));
  });
  render(
    <SkillDraftForm
      heading="New skill"
      draft={EMPTY_DRAFT}
      onDraftChange={onDraftChange}
      error={null}
      saving={false}
      isEdit={false}
      onCancel={vi.fn()}
      onSubmit={vi.fn()}
      {...overrides}
    />,
  );
  return { onDraftChange, appliedDrafts };
}

describe('SkillDraftForm', () => {
  it('typing into the Triggers field updates the draft', async () => {
    const { appliedDrafts } = renderForm();
    await userEvent.type(screen.getByPlaceholderText('search the web, summarize'), 'x');
    expect(appliedDrafts[0]?.triggers).toBe('x');
  });

  it('typing into the Description field updates the draft', async () => {
    const { appliedDrafts } = renderForm();
    await userEvent.type(screen.getByPlaceholderText(/What does this skill do/), 'x');
    expect(appliedDrafts[0]?.description).toBe('x');
  });

  it('renders host-supplied labels instead of the built-in defaults', () => {
    renderForm({
      labels: {
        nameLabel: 'Custom name',
        namePlaceholder: 'custom-name-placeholder',
        triggersLabel: 'Custom triggers',
        triggersPlaceholder: 'custom-triggers-placeholder',
        descriptionLabel: 'Custom description',
        descriptionPlaceholder: 'custom-description-placeholder',
        bodyLabel: 'Custom body',
        bodyPlaceholder: 'custom-body-placeholder',
        cancelLabel: 'Custom cancel',
        createLabel: 'Custom create',
        saveLabel: 'Custom save',
        overrideSaveLabel: 'Custom override save',
        savingLabel: 'Custom saving',
        nameRequiredError: 'Custom name error',
        bodyRequiredError: 'Custom body error',
      },
    });
    expect(screen.getByText('Custom name')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('custom-name-placeholder')).toBeInTheDocument();
    expect(screen.getByText('Custom triggers')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('custom-triggers-placeholder')).toBeInTheDocument();
    expect(screen.getByText('Custom description')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('custom-description-placeholder')).toBeInTheDocument();
    expect(screen.getByText('Custom body')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('custom-body-placeholder')).toBeInTheDocument();
    expect(screen.getByText('Custom cancel')).toBeInTheDocument();
    // Not-editing + not-saving: submit button reads the custom create label.
    expect(screen.getByText('Custom create')).toBeInTheDocument();
  });

  it('shows a host-supplied "saving" label on the submit button while saving', () => {
    renderForm({ saving: true, labels: { savingLabel: 'Custom saving…' } });
    expect(screen.getByTestId('skills-save')).toHaveTextContent('Custom saving…');
  });

  it('shows a host-supplied override-save label when editing a built-in skill', () => {
    renderForm({ isEdit: true, isBuiltInOverride: true, labels: { overrideSaveLabel: 'Custom override save' } });
    expect(screen.getByTestId('skills-save')).toHaveTextContent('Custom override save');
  });

  it('shows a host-supplied save label when editing a non-built-in skill', () => {
    renderForm({ isEdit: true, labels: { saveLabel: 'Custom save' } });
    expect(screen.getByTestId('skills-save')).toHaveTextContent('Custom save');
  });

  it('shows a host-supplied name-required error message', () => {
    renderForm({ error: { kind: 'name-required' }, labels: { nameRequiredError: 'Custom name error' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Custom name error');
  });

  it('shows a host-supplied body-required error message', () => {
    renderForm({ error: { kind: 'body-required' }, labels: { bodyRequiredError: 'Custom body error' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Custom body error');
  });
});
