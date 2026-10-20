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

  it('typing into the Name field updates the draft', async () => {
    const { appliedDrafts } = renderForm();
    await userEvent.type(screen.getByPlaceholderText('my-skill'), 'x');
    expect(appliedDrafts[0]?.name).toBe('x');
  });

  it('typing into the Body field updates the draft', async () => {
    const { appliedDrafts } = renderForm();
    await userEvent.type(screen.getByPlaceholderText(/# My skill/), 'x');
    expect(appliedDrafts[0]?.body).toBe('x');
  });

  it('renders the built-in default labels when the host passes none', () => {
    renderForm();
    for (const text of ['Name', 'Triggers', 'Description', 'Body', 'Cancel']) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    expect(screen.getByTestId('skills-save')).toHaveTextContent('Create');
  });

  it('labels the submit button "Saving…" by default while saving, even when editing', () => {
    renderForm({ saving: true, isEdit: true, isBuiltInOverride: true });
    expect(screen.getByTestId('skills-save')).toHaveTextContent('Saving…');
  });

  it('disables both buttons while saving', () => {
    renderForm({ saving: true });
    expect(screen.getByTestId('skills-save')).toBeDisabled();
    expect(screen.getByText('Cancel')).toBeDisabled();
  });

  it('labels the submit button "Save as override" by default when editing a built-in skill', () => {
    renderForm({ isEdit: true, isBuiltInOverride: true });
    expect(screen.getByTestId('skills-save')).toHaveTextContent('Save as override');
  });

  it('labels the submit button "Save" by default when editing a user skill', () => {
    renderForm({ isEdit: true });
    expect(screen.getByTestId('skills-save')).toHaveTextContent('Save');
  });

  it('ignores isBuiltInOverride when creating rather than editing', () => {
    renderForm({ isBuiltInOverride: true });
    expect(screen.getByTestId('skills-save')).toHaveTextContent('Create');
  });

  it('uses the edit-form test id and disables the Name input when editing', () => {
    renderForm({ isEdit: true });
    expect(screen.getByTestId('skills-edit-form')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('my-skill')).toBeDisabled();
  });

  it('uses the create-form test id and leaves the Name input enabled when creating', () => {
    renderForm();
    expect(screen.getByTestId('skills-create-form')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('my-skill')).toBeEnabled();
  });

  it('shows the default name-required error text', () => {
    renderForm({ error: { kind: 'name-required' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Name is required.');
  });

  it('shows the default body-required error text', () => {
    renderForm({ error: { kind: 'body-required' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Body is required.');
  });

  it('shows a submit-failed error with the message the host reported', () => {
    renderForm({ error: { kind: 'submit-failed', message: 'disk full' } });
    expect(screen.getByRole('alert')).toHaveTextContent('disk full');
  });

  it('renders no alert when a submit-failed error carries an empty message', () => {
    renderForm({ error: { kind: 'submit-failed', message: '' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders no alert when there is no error', () => {
    renderForm();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders the subheading as a hint when one is given', () => {
    renderForm({ subheading: 'Edits create an override' });
    expect(screen.getByText('Edits create an override')).toHaveClass('jini-hint');
  });

  it('renders no hint paragraph when the subheading is null', () => {
    const { container } = render(
      <SkillDraftForm
        heading="New skill"
        subheading={null}
        draft={EMPTY_DRAFT}
        onDraftChange={vi.fn()}
        error={null}
        saving={false}
        isEdit={false}
        onCancel={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(container.querySelector('.jini-section-head .jini-hint')).toBeNull();
  });

  it('calls onCancel and onSubmit from their buttons', async () => {
    const onCancel = vi.fn();
    const onSubmit = vi.fn();
    renderForm({ onCancel, onSubmit });
    await userEvent.click(screen.getByText('Cancel'));
    await userEvent.click(screen.getByTestId('skills-save'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('stamps each field with an agent handle derived from the form handle', () => {
    renderForm({ agentHandle: 'skills-create' });
    const name = screen.getByPlaceholderText('my-skill');
    expect([...name.attributes].some((attr) => attr.value === 'skills-create-name')).toBe(true);
  });
});

