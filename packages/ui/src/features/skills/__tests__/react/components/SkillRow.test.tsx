import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { SkillFileEntry, SkillSummary } from '../../../types.js';
import { SkillRow, type SkillRowProps } from '../../../react/components/SkillRow.js';

const SKILL: SkillSummary = {
  id: 'skill-x',
  name: 'X',
  description: 'd',
  mode: 'assistant',
  source: 'user',
};

function renderRow(overrides: Partial<SkillRowProps> = {}) {
  return render(
    <SkillRow
      skill={SKILL}
      locale="en"
      enabled
      expanded={false}
      editing={false}
      body={undefined}
      bodyLoading={false}
      files={null}
      filesLoading={false}
      confirmDelete={false}
      confirmBuiltInEdit={false}
      draft={null}
      draftError={null}
      draftSaving={false}
      onDraftChange={vi.fn()}
      onToggleExpanded={vi.fn()}
      onToggleEnabled={vi.fn()}
      onStartEdit={vi.fn()}
      onConfirmBuiltInEdit={vi.fn()}
      onCancelBuiltInEdit={vi.fn()}
      onArmDelete={vi.fn()}
      onCancelDelete={vi.fn()}
      onCommitDelete={vi.fn()}
      onCancelEdit={vi.fn()}
      onSubmitEdit={vi.fn()}
      {...overrides}
    />,
  );
}

describe('SkillRow', () => {
  it('falls back to the skill id when it has no untranslated or localized name', () => {
    renderRow({ skill: { ...SKILL, id: 'skill-no-name', name: '' } });
    expect(screen.getByText('skill-no-name')).toBeInTheDocument();
  });

  it('renders a directory entry in the file tree without a size', () => {
    const files: readonly SkillFileEntry[] = [{ path: 'assets', kind: 'directory', size: null }];
    renderRow({ expanded: true, files });
    expect(screen.getByText('assets')).toBeInTheDocument();
    // A directory never shows a formatted size, unlike a file with a numeric size.
    expect(screen.queryByText(/\d+(\.\d+)? (B|KB|MB)$/)).not.toBeInTheDocument();
  });

  it('renders a file entry with no numeric size without a size label', () => {
    // The body-preview section heading is also the literal text "SKILL.md"
    // (every skill has a canonical SKILL.md), which collides with this
    // fixture's file-tree entry of the same name — scope to the file list
    // (an implicit role="list" <ul>) to disambiguate, same as SkillsTab.test.tsx.
    const files: readonly SkillFileEntry[] = [{ path: 'SKILL.md', kind: 'file', size: null }];
    renderRow({ expanded: true, files });
    const fileTree = screen.getByRole('list');
    expect(within(fileTree).getByText('SKILL.md')).toBeInTheDocument();
    expect(within(fileTree).queryByText(/\d+(\.\d+)? (B|KB|MB)$/)).not.toBeInTheDocument();
  });

  it('renders host-supplied labels instead of the built-in defaults', () => {
    renderRow({
      skill: { ...SKILL, source: 'user', category: 'design' },
      confirmBuiltInEdit: true,
      labels: {
        expandLabel: 'Custom expand',
        editLabel: 'Custom edit',
        deleteLabel: 'Custom delete',
        cancelLabel: 'Custom cancel',
        enableToggleLabel: 'Custom enabled',
        userBadge: 'Custom user badge',
        overrideCreateLabel: 'Custom override create',
        overrideWarning: 'Custom override warning',
      },
    });
    expect(screen.getByTitle('Custom expand')).toBeInTheDocument();
    expect(screen.getByTitle('Custom edit')).toBeInTheDocument();
    expect(screen.getByTitle('Custom delete')).toBeInTheDocument();
    expect(screen.getByTitle('Custom enabled')).toBeInTheDocument();
    expect(screen.getByText('Custom user badge')).toBeInTheDocument();
    expect(screen.getByText('Custom override warning')).toBeInTheDocument();
    expect(screen.getByTestId('skills-edit-builtin-cancel')).toHaveTextContent('Custom cancel');
    expect(screen.getByTestId('skills-edit-builtin-confirm')).toHaveTextContent('Custom override create');
  });

  const BUILT_IN: SkillSummary = { ...SKILL, id: 'skill-b', source: 'built-in' };
  const DRAFT = { name: 'X', description: 'd', triggers: '', body: 'b' };

  it('titles the summary button "Expand" and marks it collapsed when not expanded', () => {
    renderRow();
    const summary = screen.getByTitle('Expand');
    expect(summary).toHaveAttribute('aria-expanded', 'false');
  });

  it('titles the summary button "Collapse" and marks it expanded when expanded', () => {
    renderRow({ expanded: true });
    expect(screen.getByTitle('Collapse')).toHaveAttribute('aria-expanded', 'true');
  });

  it('calls onToggleExpanded when the summary button is clicked', async () => {
    const onToggleExpanded = vi.fn();
    renderRow({ onToggleExpanded });
    await userEvent.click(screen.getByTitle('Expand'));
    expect(onToggleExpanded).toHaveBeenCalledTimes(1);
  });

  it('adds the disabled and expanded row classes from the props', () => {
    renderRow({ enabled: false, expanded: true });
    expect(screen.getByTestId('skill-row-skill-x')).toHaveClass('jini-skills-row', 'jini-skills-row-disabled', 'jini-skills-row-expanded');
  });

  it('uses only the base row class when enabled and collapsed', () => {
    renderRow();
    expect(screen.getByTestId('skill-row-skill-x').className).toBe('jini-skills-row');
  });

  it('shows the humanized category as a badge', () => {
    renderRow({ skill: { ...SKILL, category: 'image-generation' } });
    expect(screen.getByTitle('Image Generation')).toHaveTextContent('Image Generation');
  });

  it('shows the default "user" badge for a user skill only', () => {
    renderRow();
    expect(screen.getByText('user')).toHaveClass('jini-skills-row-summary-source');
  });

  it('shows no user badge for a built-in skill', () => {
    renderRow({ skill: BUILT_IN });
    expect(screen.queryByText('user')).toBeNull();
  });

  it('renders no description hint when the description is empty', () => {
    const { container } = renderRow({ skill: { ...SKILL, description: '' } });
    expect(container.querySelector('.jini-skills-row-summary .jini-hint')).toBeNull();
  });

  it('labels the edit button "Edit" for a user skill', () => {
    renderRow();
    expect(screen.getByTestId('skills-edit')).toHaveAttribute('aria-label', 'Edit');
  });

  it('labels the edit button "Create override" for a built-in skill and offers no delete', () => {
    renderRow({ skill: BUILT_IN });
    expect(screen.getByTestId('skills-edit')).toHaveAttribute('aria-label', 'Create override');
    expect(screen.queryByTestId('skills-delete')).toBeNull();
  });

  it('calls onStartEdit and onArmDelete from the action buttons', async () => {
    const onStartEdit = vi.fn();
    const onArmDelete = vi.fn();
    renderRow({ onStartEdit, onArmDelete });
    await userEvent.click(screen.getByTestId('skills-edit'));
    await userEvent.click(screen.getByTestId('skills-delete'));
    expect(onStartEdit).toHaveBeenCalledTimes(1);
    expect(onArmDelete).toHaveBeenCalledTimes(1);
  });

  it('swaps the actions for a confirm group when a user skill is armed for delete', async () => {
    const onCommitDelete = vi.fn();
    const onCancelDelete = vi.fn();
    renderRow({ confirmDelete: true, onCommitDelete, onCancelDelete });
    expect(screen.queryByTestId('skills-edit')).toBeNull();
    const group = screen.getByRole('group');
    await userEvent.click(within(group).getByTestId('skills-delete-confirm'));
    await userEvent.click(within(group).getByText('Cancel'));
    expect(onCommitDelete).toHaveBeenCalledTimes(1);
    expect(onCancelDelete).toHaveBeenCalledTimes(1);
  });

  it('labels the delete confirm button "Confirm delete" by default', () => {
    renderRow({ confirmDelete: true });
    expect(screen.getByTestId('skills-delete-confirm')).toHaveTextContent('Confirm delete');
  });

  it('ignores confirmDelete for a built-in skill and keeps the edit action', () => {
    renderRow({ skill: BUILT_IN, confirmDelete: true });
    expect(screen.queryByRole('group')).toBeNull();
    expect(screen.getByTestId('skills-edit')).toBeInTheDocument();
  });

  it('calls onToggleEnabled with the new checked state', async () => {
    const onToggleEnabled = vi.fn();
    renderRow({ onToggleEnabled });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Enabled' }));
    expect(onToggleEnabled).toHaveBeenCalledWith(false);
  });

  it('shows the default override warning and wires its two buttons', async () => {
    const onCancelBuiltInEdit = vi.fn();
    const onConfirmBuiltInEdit = vi.fn();
    renderRow({ skill: BUILT_IN, confirmBuiltInEdit: true, onCancelBuiltInEdit, onConfirmBuiltInEdit });
    expect(screen.getByTestId('skills-edit-builtin-warning')).toHaveTextContent(/This skill ships with the host/);
    await userEvent.click(screen.getByTestId('skills-edit-builtin-cancel'));
    await userEvent.click(screen.getByTestId('skills-edit-builtin-confirm'));
    expect(onCancelBuiltInEdit).toHaveBeenCalledTimes(1);
    expect(onConfirmBuiltInEdit).toHaveBeenCalledTimes(1);
  });

  it('renders no detail section when collapsed', () => {
    const { container } = renderRow({ body: 'hello' });
    expect(container.querySelector('.jini-skills-row-detail')).toBeNull();
  });

  it('shows the loading hint in both detail sections while loading', () => {
    renderRow({ expanded: true, bodyLoading: true, filesLoading: true });
    expect(screen.getAllByText('Loading…')).toHaveLength(2);
  });

  it('previews the loaded body under the SKILL.md heading', () => {
    const { container } = renderRow({ expanded: true, body: '# hello' });
    expect(screen.getByRole('heading', { name: 'SKILL.md' })).toBeInTheDocument();
    expect(container.querySelector('pre.jini-skills-body-preview')?.textContent).toBe('# hello');
  });

  it('previews an empty body when none has been fetched', () => {
    const { container } = renderRow({ expanded: true, body: undefined });
    expect(container.querySelector('pre.jini-skills-body-preview')?.textContent).toBe('');
  });

  it('shows "No files." for a null file list', () => {
    renderRow({ expanded: true, files: null });
    expect(screen.getByText('No files.')).toBeInTheDocument();
  });

  it('shows "No files." for an empty file list', () => {
    renderRow({ expanded: true, files: [] });
    expect(screen.getByText('No files.')).toBeInTheDocument();
  });

  it('shows a file size and indents nested entries by depth', () => {
    const files: readonly SkillFileEntry[] = [{ path: 'assets/img/logo.png', kind: 'file', size: 2048 }];
    renderRow({ expanded: true, files });
    const entry = screen.getByText('logo.png').closest('li');
    expect(entry).toHaveStyle({ paddingLeft: '24px' });
    expect(within(entry as HTMLElement).getByText('2.0 KB')).toBeInTheDocument();
  });

  it('renders host-supplied detail labels', () => {
    renderRow({
      expanded: true,
      bodyLoading: true,
      files: [],
      labels: { bodyHeading: 'Custom body', filesHeading: 'Custom files', loadingLabel: 'Custom loading', noFilesLabel: 'Custom none', collapseLabel: 'Custom collapse' },
    });
    expect(screen.getByText('Custom body')).toBeInTheDocument();
    expect(screen.getByText('Custom files')).toBeInTheDocument();
    expect(screen.getByText('Custom loading')).toBeInTheDocument();
    expect(screen.getByText('Custom none')).toBeInTheDocument();
    expect(screen.getByTitle('Custom collapse')).toBeInTheDocument();
  });

  it('renders host-supplied delete-confirm label', () => {
    renderRow({ confirmDelete: true, labels: { deleteConfirmLabel: 'Custom confirm' } });
    expect(screen.getByTestId('skills-delete-confirm')).toHaveTextContent('Custom confirm');
  });

  it('replaces the detail with the edit form while editing, headed "Edit" with the skill id', () => {
    const { container } = renderRow({ expanded: true, editing: true, draft: DRAFT });
    expect(container.querySelector('.jini-skills-row-detail')).toBeNull();
    const form = screen.getByTestId('skills-edit-form');
    expect(within(form).getByRole('heading', { name: 'Edit' })).toBeInTheDocument();
    expect(within(form).getByText('skill-x')).toBeInTheDocument();
    expect(within(form).getByTestId('skills-save')).toHaveTextContent('Save');
  });

  it('heads the edit form "Create override" and saves as override for a built-in skill', () => {
    renderRow({ skill: BUILT_IN, editing: true, draft: DRAFT });
    const form = screen.getByTestId('skills-edit-form');
    expect(within(form).getByRole('heading', { name: 'Create override' })).toBeInTheDocument();
    expect(within(form).getByTestId('skills-save')).toHaveTextContent('Save as override');
  });

  it('renders no edit form while editing until the draft exists', () => {
    renderRow({ editing: true, draft: null });
    expect(screen.queryByTestId('skills-edit-form')).toBeNull();
  });

  it('gives the edit form a sub-handle of the row handle', () => {
    renderRow({ editing: true, draft: DRAFT, agentHandle: 'skill-x' });
    const name = within(screen.getByTestId('skills-edit-form')).getByPlaceholderText('my-skill');
    expect([...name.attributes].some((attr) => attr.value === 'skill-x-edit-form-name')).toBe(true);
  });

  it('publishes no agent handles without a row handle', () => {
    renderRow({ editing: true, draft: DRAFT });
    const name = within(screen.getByTestId('skills-edit-form')).getByPlaceholderText('my-skill');
    expect([...name.attributes].some((attr) => attr.name.startsWith('data-agent'))).toBe(false);
  });
});

