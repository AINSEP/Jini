import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { QuestionForm as QuestionFormType } from '../../../core/index.js';
import { I18nContext, type useT } from '../../hooks/context.js';
import { CopyMessageButton } from '../CopyMessageButton.js';
import { QuestionsPanel } from '../QuestionsPanel.js';
import { TodoCard } from '../TodoCard.js';

/** A translator that is visibly not the key, so the assertion proves the injected hook ran. */
const useQuotingT: typeof useT = () => (key) => `«${key}»`;

const FR: Record<string, string> = { Todos: 'Tâches', Continue: 'Continuer', Copied: 'Copié' };

/** The chat package has no I18nProvider component; its real context provider takes an adapter directly. */
function inFrench(ui: React.ReactNode) {
  return <I18nContext.Provider value={{ locale: 'fr', t: (key) => FR[key] ?? key }}>{ui}</I18nContext.Provider>;
}

const todos = [{ content: 'step one', status: 'in_progress' as const }];
const form: QuestionFormType = {
  id: 'discovery',
  title: 'Quick brief',
  questions: [{ id: 'platform', label: 'Platform', type: 'radio', options: [{ label: 'Mobile', value: 'mobile' }], required: true }],
};

describe('TodoCard translation hook', () => {
  it('renders the translator supplied through useTHook', () => {
    render(<TodoCard todos={todos} useTHook={useQuotingT} />);
    expect(screen.getByText('«Todos»')).toBeInTheDocument();
  });

  it('renders the translated title from the real provider, not the key', () => {
    render(inFrench(<TodoCard todos={todos} />));
    expect(screen.getByText('Tâches')).toBeInTheDocument();
    expect(screen.queryByText('Todos')).not.toBeInTheDocument();
  });
});

describe('QuestionsPanel translation hook', () => {
  it('renders the translator supplied through useTHook', () => {
    render(<QuestionsPanel form={form} interactive onSubmit={vi.fn()} useTHook={useQuotingT} />);
    expect(screen.getByRole('button', { name: '«Continue»' })).toBeInTheDocument();
  });

  it('renders the translated button from the real provider, not the key', () => {
    render(inFrench(<QuestionsPanel form={form} interactive onSubmit={vi.fn()} />));
    expect(screen.getByRole('button', { name: 'Continuer' })).toBeInTheDocument();
  });
});

describe('CopyMessageButton hooks', () => {
  it('renders the copied state from the injected clipboard hook with the injected translator', () => {
    render(<CopyMessageButton text="# md" label="Copy" useTHook={useQuotingT} useCopyToClipboardHook={() => ({ copied: true, copy: vi.fn() })} />);
    expect(screen.getByRole('button', { name: '«Copied»' })).toBeInTheDocument();
  });

  it('renders the translated copied label from the real provider, not the key', () => {
    render(inFrench(<CopyMessageButton text="# md" label="Copy" useCopyToClipboardHook={() => ({ copied: true, copy: vi.fn() })} />));
    expect(screen.getByRole('button', { name: 'Copié' })).toBeInTheDocument();
  });
});
