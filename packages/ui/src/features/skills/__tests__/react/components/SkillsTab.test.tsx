import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../i18n/index.js';
import { createFakeSkillsPort } from '../../../dependencies.js';
import type { SkillsPort, SkillWritePayload } from '../../../ports.js';
import type { SkillDetail } from '../../../types.js';
import { SkillsTab } from '../../../react/components/SkillsTab.js';

const BUILT_IN: SkillDetail = {
  id: 'skill-summarize',
  name: 'Summarize',
  description: 'Summarizes long documents.',
  triggers: ['summarize'],
  mode: 'assistant',
  source: 'built-in',
  category: 'productivity',
  body: '# Summarize\n\nDo the thing.',
};

const USER_SKILL: SkillDetail = {
  id: 'skill-custom',
  name: 'My Custom Skill',
  description: 'A user skill.',
  triggers: ['custom'],
  mode: 'assistant',
  source: 'user',
  body: '# Custom\n\nDo the other thing.',
};

function renderTab(port: SkillsPort, extra: Partial<{ disabledSkillIds: ReadonlySet<string>; onToggleEnabled: (id: string, enabled: boolean) => void }> = {}) {
  return render(
    <SkillsTab port={port} disabledSkillIds={extra.disabledSkillIds ?? new Set()} onToggleEnabled={extra.onToggleEnabled ?? vi.fn()} />,
  );
}

describe('SkillsTab', () => {
  it('lists every skill from the port', async () => {
    const port = createFakeSkillsPort({ skills: [BUILT_IN, USER_SKILL] });
    renderTab(port);
    expect(await screen.findByText('Summarize')).toBeInTheDocument();
    expect(screen.getByText('My Custom Skill')).toBeInTheDocument();
  });

  it('filters by search text against name/description/triggers', async () => {
    const port = createFakeSkillsPort({ skills: [BUILT_IN, USER_SKILL] });
    renderTab(port);
    await screen.findByText('Summarize');

    await userEvent.type(screen.getByPlaceholderText('Search skills…'), 'custom');

    expect(screen.queryByText('Summarize')).not.toBeInTheDocument();
    expect(screen.getByText('My Custom Skill')).toBeInTheDocument();
  });

  it('shows the category filter row only when a skill carries a category', async () => {
    const port = createFakeSkillsPort({ skills: [BUILT_IN, USER_SKILL] });
    renderTab(port);
    await screen.findByText('Summarize');
    expect(screen.getByTestId('skills-category-filters')).toBeInTheDocument();
  });

  it('hides the category filter row entirely when no skill has one', async () => {
    const port = createFakeSkillsPort({ skills: [USER_SKILL] });
    renderTab(port);
    await screen.findByText('My Custom Skill');
    expect(screen.queryByTestId('skills-category-filters')).not.toBeInTheDocument();
  });

  it('filtering by source narrows the list', async () => {
    const port = createFakeSkillsPort({ skills: [BUILT_IN, USER_SKILL] });
    renderTab(port);
    await screen.findByText('Summarize');

    await userEvent.selectOptions(screen.getByLabelText('Source'), 'user');

    expect(screen.queryByText('Summarize')).not.toBeInTheDocument();
    expect(screen.getByText('My Custom Skill')).toBeInTheDocument();
  });

  it('filtering by mode (type) narrows the list', async () => {
    const port = createFakeSkillsPort({
      skills: [BUILT_IN, { ...USER_SKILL, mode: 'automation' }],
    });
    renderTab(port);
    await screen.findByText('Summarize');

    await userEvent.selectOptions(screen.getByLabelText('Type'), 'automation');

    expect(screen.queryByText('Summarize')).not.toBeInTheDocument();
    expect(screen.getByText('My Custom Skill')).toBeInTheDocument();
  });

  it('filtering by category narrows the list', async () => {
    const port = createFakeSkillsPort({ skills: [BUILT_IN, USER_SKILL] });
    renderTab(port);
    await screen.findByText('Summarize');

    await userEvent.selectOptions(screen.getByLabelText('Category'), 'productivity');

    expect(screen.getByText('Summarize')).toBeInTheDocument();
    expect(screen.queryByText('My Custom Skill')).not.toBeInTheDocument();
  });

  it('expanding a row lazily fetches and shows its body and file tree', async () => {
    const port = createFakeSkillsPort({
      skills: [USER_SKILL],
      files: { [USER_SKILL.id]: [{ path: 'SKILL.md', kind: 'file', size: 42 }] },
    });
    renderTab(port);
    await screen.findByText('My Custom Skill');

    await userEvent.click(screen.getByRole('button', { name: /My Custom Skill/ }));

    // A plain string query against `getByText`'s default normalizer collapses
    // the body's embedded blank line the same way it collapses the query's —
    // in theory a wash, but in practice unreliable for a <pre>; matching a
    // substring via regex sidesteps it.
    expect(await screen.findByText(/Do the other thing/)).toBeInTheDocument();
    // The body-preview section heading is also the literal text "SKILL.md" (every
    // skill has a canonical SKILL.md), which collides with this fixture's file-tree
    // entry of the same name. Scope to the file list (an implicit role="list" <ul>)
    // to disambiguate while still waiting on the lazily-fetched tree to render.
    const fileTree = await screen.findByRole('list');
    expect(within(fileTree).getByText('SKILL.md')).toBeInTheDocument();
    expect(within(fileTree).getByText('42 B')).toBeInTheDocument();
  });

  it('creating a skill validates name and body, then saves and shows it in the list', async () => {
    const port = createFakeSkillsPort({ skills: [] });
    renderTab(port);
    await screen.findByTestId('skills-list');

    await userEvent.click(screen.getByTestId('skills-new'));
    await userEvent.click(screen.getByTestId('skills-save'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Name is required.');

    await userEvent.type(screen.getByPlaceholderText('my-skill'), 'my-new-skill');
    await userEvent.click(screen.getByTestId('skills-save'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Body is required.');

    await userEvent.type(screen.getByPlaceholderText(/Explain the workflow/), '# body text');
    await userEvent.click(screen.getByTestId('skills-save'));

    await waitFor(() => expect(screen.getByText('my-new-skill')).toBeInTheDocument());
    // The create form is gone once the save lands.
    expect(screen.queryByTestId('skills-create-form')).not.toBeInTheDocument();
  });

  it('editing a user skill pre-fills the inline form and saves through updateSkill', async () => {
    const port = createFakeSkillsPort({ skills: [USER_SKILL] });
    const updateSpy = vi.spyOn(port, 'updateSkill');
    renderTab(port);
    await screen.findByText('My Custom Skill');

    await userEvent.click(screen.getByTestId('skills-edit'));
    const nameInput = await screen.findByDisplayValue('My Custom Skill');
    expect(nameInput).toBeDisabled(); // name is not editable

    const bodyInput = screen.getByDisplayValue(/Do the other thing/);
    await userEvent.clear(bodyInput);
    await userEvent.type(bodyInput, '# Updated');
    await userEvent.click(screen.getByTestId('skills-save'));

    await waitFor(() =>
      expect(updateSpy).toHaveBeenCalledWith(
        'skill-custom',
        expect.objectContaining({ body: '# Updated' } satisfies Partial<SkillWritePayload>),
      ),
    );
  });

  it('editing a built-in skill requires confirming the override first', async () => {
    const port = createFakeSkillsPort({ skills: [BUILT_IN] });
    const updateSpy = vi.spyOn(port, 'updateSkill');
    renderTab(port);
    await screen.findByText('Summarize');

    await userEvent.click(screen.getByTestId('skills-edit'));
    expect(await screen.findByTestId('skills-edit-builtin-warning')).toBeInTheDocument();
    expect(screen.queryByTestId('skills-edit-form')).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId('skills-edit-builtin-confirm'));

    expect(await screen.findByTestId('skills-edit-form')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('skills-save'));
    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith('skill-summarize', expect.anything()));
  });

  it('cancelling the built-in override confirmation leaves the skill unedited', async () => {
    const port = createFakeSkillsPort({ skills: [BUILT_IN] });
    renderTab(port);
    await screen.findByText('Summarize');

    await userEvent.click(screen.getByTestId('skills-edit'));
    await userEvent.click(screen.getByTestId('skills-edit-builtin-cancel'));

    expect(screen.queryByTestId('skills-edit-builtin-warning')).not.toBeInTheDocument();
    expect(screen.queryByTestId('skills-edit-form')).not.toBeInTheDocument();
  });

  it('a built-in skill offers no delete action', async () => {
    const port = createFakeSkillsPort({ skills: [BUILT_IN] });
    renderTab(port);
    await screen.findByText('Summarize');
    expect(screen.queryByTestId('skills-delete')).not.toBeInTheDocument();
  });

  it('deleting a user skill requires a second confirming click', async () => {
    const port = createFakeSkillsPort({ skills: [USER_SKILL] });
    const deleteSpy = vi.spyOn(port, 'deleteSkill');
    renderTab(port);
    await screen.findByText('My Custom Skill');

    await userEvent.click(screen.getByTestId('skills-delete'));
    expect(deleteSpy).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId('skills-delete-confirm'));

    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith('skill-custom'));
    await waitFor(() => expect(screen.queryByText('My Custom Skill')).not.toBeInTheDocument());
  });

  it('toggling the enable checkbox calls onToggleEnabled, and a disabled skill is styled distinctly', async () => {
    const port = createFakeSkillsPort({ skills: [USER_SKILL] });
    const onToggleEnabled = vi.fn();
    renderTab(port, { onToggleEnabled });
    await screen.findByText('My Custom Skill');

    await userEvent.click(screen.getByLabelText('Enabled'));
    expect(onToggleEnabled).toHaveBeenCalledWith('skill-custom', false);
  });

  it('renders a disabled skill row distinctly from an enabled one', async () => {
    const port = createFakeSkillsPort({ skills: [USER_SKILL] });
    renderTab(port, { disabledSkillIds: new Set(['skill-custom']) });
    await screen.findByText('My Custom Skill');
    const row = screen.getByTestId('skill-row-skill-custom');
    expect(row.className).toContain('jini-skills-row-disabled');
    expect(within(row).getByLabelText('Enabled')).not.toBeChecked();
  });

  it('shows a submit-failed message when the server rejects a create', async () => {
    const port: SkillsPort = {
      listSkills: () => Promise.resolve([]),
      fetchSkillDetail: () => Promise.reject(new Error('not found')),
      fetchSkillFiles: () => Promise.resolve([]),
      createSkill: () => Promise.reject(new Error('name already taken')),
      updateSkill: () => Promise.reject(new Error('not found')),
      deleteSkill: () => Promise.reject(new Error('not found')),
    };
    renderTab(port);
    await screen.findByTestId('skills-list');

    await userEvent.click(screen.getByTestId('skills-new'));
    await userEvent.type(screen.getByPlaceholderText('my-skill'), 'dup-skill');
    await userEvent.type(screen.getByPlaceholderText(/Explain the workflow/), '# body');
    await userEvent.click(screen.getByTestId('skills-save'));

    expect(await screen.findByRole('alert')).toHaveTextContent('name already taken');
  });

  it('shows a load error when the initial listSkills call rejects', async () => {
    const port: SkillsPort = {
      listSkills: () => Promise.reject(new Error('registry unreachable')),
      fetchSkillDetail: () => Promise.reject(new Error('n/a')),
      fetchSkillFiles: () => Promise.resolve([]),
      createSkill: () => Promise.reject(new Error('n/a')),
      updateSkill: () => Promise.reject(new Error('n/a')),
      deleteSkill: () => Promise.reject(new Error('n/a')),
    };
    renderTab(port);
    expect(await screen.findByText(/registry unreachable/)).toBeInTheDocument();
  });

  it('renders host-supplied labels instead of the built-in defaults', async () => {
    const port = createFakeSkillsPort({ skills: [BUILT_IN, USER_SKILL] });
    render(
      <SkillsTab
        port={port}
        disabledSkillIds={new Set()}
        onToggleEnabled={vi.fn()}
        labels={{
          searchPlaceholder: 'Custom search…',
          newSkillLabel: 'Custom new skill',
          sourceFilterLabel: 'Custom source',
          modeFilterLabel: 'Custom type',
          categoryFilterLabel: 'Custom category',
          allLabel: 'Custom all',
          noResultsLabel: 'Custom no results',
          loadErrorLabel: 'Custom load error',
        }}
      />,
    );
    expect(await screen.findByPlaceholderText('Custom search…')).toBeInTheDocument();
    expect(screen.getByText('Custom new skill')).toBeInTheDocument();
    expect(screen.getByText('Custom source')).toBeInTheDocument();
    expect(screen.getByText('Custom type')).toBeInTheDocument();
    expect(screen.getByText('Custom category')).toBeInTheDocument();
  });

  it('shows a host-supplied "no results" message when filters exclude every skill', async () => {
    const port = createFakeSkillsPort({ skills: [USER_SKILL] });
    render(
      <SkillsTab
        port={port}
        disabledSkillIds={new Set()}
        onToggleEnabled={vi.fn()}
        labels={{ noResultsLabel: 'Custom no results' }}
      />,
    );
    await screen.findByText('My Custom Skill');
    await userEvent.type(screen.getByPlaceholderText('Search skills…'), 'nonexistent-query');
    expect(await screen.findByText('Custom no results')).toBeInTheDocument();
  });

  it('renders translated copy when mounted under an I18nProvider with a matching dictionary', async () => {
    const port = createFakeSkillsPort({ skills: [] });
    render(
      <I18nProvider dictionaries={{ fr: { 'New skill': 'Nouvelle compétence' } }} initialLocale="fr">
        <SkillsTab port={port} disabledSkillIds={new Set()} onToggleEnabled={vi.fn()} />
      </I18nProvider>,
    );
    expect(await screen.findByText('Nouvelle compétence')).toBeInTheDocument();
  });
});
