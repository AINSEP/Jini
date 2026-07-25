import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MentionAutocomplete } from '../../../react/components/MentionAutocomplete.js';
import { I18nProvider } from '../../../../i18n/index.js';
import type { MentionItem } from '../../../types.js';
import type { ReactNode } from 'react';

const CATEGORIES = [
  { id: 'skills', label: 'Skills' },
  { id: 'plugins', label: 'Plugins' },
];

const ITEMS: MentionItem<ReactNode>[] = [
  { id: '1', label: 'Alpha', category: 'skills', meta: 'A skill' },
  { id: '2', label: 'Beta', category: 'plugins', meta: 'A plugin' },
];

function ControlledHarness(props: Partial<React.ComponentProps<typeof MentionAutocomplete<MentionItem<ReactNode>>>> = {}) {
  const [value, setValue] = useState(props.value ?? '');
  return (
    <MentionAutocomplete
      items={ITEMS}
      categories={CATEGORIES}
      {...props}
      value={value}
      onValueChange={(next) => {
        setValue(next);
        props.onValueChange?.(next);
      }}
    />
  );
}

describe('MentionAutocomplete', () => {
  it('opens the results popover when typing the trigger character, and closes when the query ends', async () => {
    render(<ControlledHarness />);
    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, '@al');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();

    await userEvent.type(textarea, ' ');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('picking a result splices the token into the textarea and adds a removable chip', async () => {
    const onSelectionChange = vi.fn();
    render(<ControlledHarness onSelectionChange={onSelectionChange} />);
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    await userEvent.type(textarea, '@al');
    await userEvent.click(screen.getByRole('option', { name: /Alpha/ }));

    expect(textarea.value).toBe('@Alpha ');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(onSelectionChange).toHaveBeenCalledWith([ITEMS[0]]);
    expect(screen.getByRole('button', { name: /Alpha/ })).toBeInTheDocument();
  });

  it('removing a chip drops it from the selection row', async () => {
    render(<ControlledHarness />);
    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, '@al');
    await userEvent.click(screen.getByRole('option', { name: /Alpha/ }));
    expect(screen.getByRole('button', { name: /Alpha/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Alpha/ }));
    expect(screen.queryByRole('button', { name: /Alpha/ })).not.toBeInTheDocument();
  });

  it('switching category tabs narrows the visible results', async () => {
    render(<ControlledHarness />);
    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, '@');
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Plugins' }));
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('closes the popover on outside click without adding a selection', async () => {
    render(
      <div>
        <ControlledHarness />
        <button type="button">outside</button>
      </div>,
    );
    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, '@al');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'outside' }));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('closes the popover on Escape', async () => {
    render(<ControlledHarness />);
    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, '@al');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('supports a custom resultsAriaLabel', async () => {
    render(<ControlledHarness resultsAriaLabel="Pick some context" />);
    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, '@al');
    expect(screen.getByRole('listbox', { name: 'Pick some context' })).toBeInTheDocument();
  });

  it('renders a placeholder and respects the disabled prop', () => {
    render(<ControlledHarness placeholder="Ask anything" disabled />);
    const textarea = screen.getByPlaceholderText('Ask anything');
    expect(textarea).toBeDisabled();
  });

  it('shows the no-results message for a query that matches nothing', async () => {
    render(<ControlledHarness />);
    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, '@zzz');
    expect(screen.getByText('No results for "zzz".')).toBeInTheDocument();
  });

  it('supports a custom trigger character', async () => {
    render(<ControlledHarness triggerChar="/" />);
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    await userEvent.type(textarea, '/al');
    await userEvent.click(screen.getByRole('option', { name: /Alpha/ }));
    expect(textarea.value).toBe('/Alpha ');
  });

  it('renders translated placeholder, tabs, and results end-to-end under an I18nProvider', async () => {
    render(
      <I18nProvider
        dictionaries={{
          fr: {
            'Ask anything': 'Demandez tout',
            All: 'Tout',
            Skills: 'Compétences',
            'Selected context': 'Contexte sélectionné',
          },
        }}
        initialLocale="fr"
      >
        <ControlledHarness placeholder="Ask anything" />
      </I18nProvider>,
    );
    expect(screen.getByPlaceholderText('Demandez tout')).toBeInTheDocument();
    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, '@al');
    expect(screen.getByRole('tab', { name: 'Tout' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Compétences' })).toBeInTheDocument();
    expect(screen.getAllByText('Compétences')).toHaveLength(2); // tab + section label
    await userEvent.click(screen.getByRole('option', { name: /Alpha/ }));
    expect(screen.getByLabelText('Contexte sélectionné')).toBeInTheDocument();
  });
});

describe('MentionAutocomplete 4-pattern hook override test suite', () => {
  it('Pattern 1 — State 1: Closed mention popover state via hook override', () => {
    const customHook = () => ({
      containerRef: { current: null },
      textareaRef: { current: null },
      isOpen: false,
      query: '',
      activeCategory: 'all',
      setActiveCategory: vi.fn(),
      groups: [],
      hasResults: false,
      selectedKeys: new Set<string>(),
      selectedItems: [],
      pickItem: vi.fn(),
      removeItem: vi.fn(),
      onTextareaChange: vi.fn(),
      onTextareaClick: vi.fn(),
      onTextareaFocus: vi.fn(),
      onTextareaKeyDown: vi.fn(),
      onTextareaKeyUp: vi.fn(),
    });

    render(
      <MentionAutocomplete
        value=""
        onValueChange={vi.fn()}
        items={ITEMS}
        categories={CATEGORIES}
        useMentionAutocomplete={customHook as any}
      />,
    );

    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('Pattern 2 — State 2: Open mention popover state via hook override', () => {
    const customHook = () => ({
      containerRef: { current: null },
      textareaRef: { current: null },
      isOpen: true,
      query: 'Al',
      activeCategory: 'all',
      setActiveCategory: vi.fn(),
      groups: [{ category: { id: 'skills', label: 'Skills' }, items: [ITEMS[0]!] }],
      hasResults: true,
      selectedKeys: new Set<string>(),
      selectedItems: [],
      pickItem: vi.fn(),
      removeItem: vi.fn(),
      onTextareaChange: vi.fn(),
      onTextareaClick: vi.fn(),
      onTextareaFocus: vi.fn(),
      onTextareaKeyDown: vi.fn(),
      onTextareaKeyUp: vi.fn(),
    });

    render(
      <MentionAutocomplete
        value="@Al"
        onValueChange={vi.fn()}
        items={ITEMS}
        categories={CATEGORIES}
        useMentionAutocomplete={customHook as any}
      />,
    );

    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
  });

  it('Pattern 3 — State 3: Selected items chips state via hook override', () => {
    const customHook = () => ({
      containerRef: { current: null },
      textareaRef: { current: null },
      isOpen: false,
      query: '',
      activeCategory: 'all',
      setActiveCategory: vi.fn(),
      groups: [],
      hasResults: false,
      selectedKeys: new Set<string>(['skills:1']),
      selectedItems: [ITEMS[0]!],
      pickItem: vi.fn(),
      removeItem: vi.fn(),
      onTextareaChange: vi.fn(),
      onTextareaClick: vi.fn(),
      onTextareaFocus: vi.fn(),
      onTextareaKeyDown: vi.fn(),
      onTextareaKeyUp: vi.fn(),
    });

    render(
      <MentionAutocomplete
        value=""
        onValueChange={vi.fn()}
        items={ITEMS}
        categories={CATEGORIES}
        useMentionAutocomplete={customHook as any}
      />,
    );

    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByTitle('Remove Alpha')).toBeInTheDocument();
  });

  it('Pattern 4 — State 4: Dynamic input value transition walkthrough using React useState inside test harness', () => {
    function DynamicMentionHarness() {
      const [val, setVal] = useState('');
      return <MentionAutocomplete value={val} onValueChange={setVal} items={ITEMS} categories={CATEGORIES} />;
    }

    render(<DynamicMentionHarness />);

    const textarea = screen.getByRole('textbox');
    expect(screen.queryByRole('listbox')).toBeNull();

    fireEvent.change(textarea, { target: { value: '@Al' } });
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });
});
