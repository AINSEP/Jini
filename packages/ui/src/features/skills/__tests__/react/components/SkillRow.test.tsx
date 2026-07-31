import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SkillFileEntry, SkillSummary } from '@jini-ai/ui-core';
import { SkillRow, type SkillRowProps } from '../../../react/components/SkillRow.js';

const SKILL: SkillSummary = {
  id: 'skill-x',
  name: 'X',
  description: 'd',
  mode: 'assistant',
  source: 'user',
};

function renderRow(overrides: Partial<SkillRowProps> = {}) {
  render(
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
});
