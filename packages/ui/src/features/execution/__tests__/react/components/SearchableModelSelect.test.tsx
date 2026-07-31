// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SearchableModelSelect } from '../../../react/components/SearchableModelSelect.js';

const SHORT_MODELS = [
  { id: 'm1', label: 'Model One' },
  { id: 'm2', label: 'Model Two' },
];

const LONG_MODELS = Array.from({ length: 9 }, (_, i) => ({ id: `model-${i}`, label: `Model ${i}` }));

describe('SearchableModelSelect', () => {
  it('shows the selected model on the trigger', () => {
    render(
      <SearchableModelSelect
        models={SHORT_MODELS}
        value="m2"
        onChange={vi.fn()}
        ariaLabel="Model"
        searchPlaceholder="Search models"
      />,
    );
    expect(screen.getByRole('combobox').textContent).toContain('Model Two');
  });

  it('does not render a search box below the option-count floor', async () => {
    const user = userEvent.setup();
    render(
      <SearchableModelSelect
        models={SHORT_MODELS}
        value="m1"
        onChange={vi.fn()}
        ariaLabel="Model"
        searchPlaceholder="Search models"
        minSearchableOptions={8}
      />,
    );
    await user.click(screen.getByRole('combobox'));
    expect(screen.queryByPlaceholderText('Search models')).not.toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(2);
  });

  it('renders a search box once the option count reaches the floor, and filters as the operator types', async () => {
    const user = userEvent.setup();
    render(
      <SearchableModelSelect
        // No value selected, so this test isolates filtering from the
        // separate "selected option always stays visible" behavior (covered
        // by its own test below).
        models={LONG_MODELS}
        value=""
        onChange={vi.fn()}
        ariaLabel="Model"
        searchPlaceholder="Search models"
        minSearchableOptions={8}
      />,
    );
    await user.click(screen.getByRole('combobox'));
    const search = await screen.findByPlaceholderText('Search models');
    expect(screen.getAllByRole('option')).toHaveLength(9);

    await user.type(search, 'Model 3');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Model 3']);
  });

  it('keeps the selected option visible while filtering, even when it does not match the query', async () => {
    const user = userEvent.setup();
    render(
      <SearchableModelSelect
        models={LONG_MODELS}
        value="model-0"
        onChange={vi.fn()}
        ariaLabel="Model"
        searchPlaceholder="Search models"
        minSearchableOptions={8}
      />,
    );
    await user.click(screen.getByRole('combobox'));
    const search = await screen.findByPlaceholderText('Search models');
    await user.type(search, 'Model 3');
    const labels = screen.getAllByRole('option').map((o) => o.textContent);
    expect(labels).toContain('Model 0');
    expect(labels).toContain('Model 3');
  });

  it('keeps additionalOptions visible regardless of the query, and selecting one calls onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SearchableModelSelect
        models={LONG_MODELS}
        value="model-0"
        onChange={onChange}
        ariaLabel="Model"
        searchPlaceholder="Search models"
        minSearchableOptions={8}
        additionalOptions={[{ value: '__custom__', label: 'Custom…' }]}
      />,
    );
    await user.click(screen.getByRole('combobox'));
    const search = await screen.findByPlaceholderText('Search models');
    await user.type(search, 'nonexistent-query');
    expect(screen.getByText('Custom…')).toBeInTheDocument();

    await user.click(screen.getByText('Custom…'));
    expect(onChange).toHaveBeenCalledWith('__custom__');
  });

  it('selecting an option calls onChange and closes the popover', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SearchableModelSelect
        models={SHORT_MODELS}
        value="m1"
        onChange={onChange}
        ariaLabel="Model"
        searchPlaceholder="Search models"
      />,
    );
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByText('Model Two'));
    expect(onChange).toHaveBeenCalledWith('m2');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('resets the query and re-shows every option after closing and reopening', async () => {
    const user = userEvent.setup();
    render(
      <SearchableModelSelect
        models={LONG_MODELS}
        value=""
        onChange={vi.fn()}
        ariaLabel="Model"
        searchPlaceholder="Search models"
        minSearchableOptions={8}
      />,
    );
    await user.click(screen.getByRole('combobox'));
    const search = await screen.findByPlaceholderText('Search models');
    await user.type(search, 'Model 3');
    expect(screen.getAllByRole('option')).toHaveLength(1);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    await user.click(screen.getByRole('combobox'));
    expect(screen.getAllByRole('option')).toHaveLength(9);
    expect(screen.getByPlaceholderText('Search models')).toHaveValue('');
  });

  it('focuses the search input once the popover has actually mounted', async () => {
    const user = userEvent.setup();
    render(
      <SearchableModelSelect
        models={LONG_MODELS}
        value="model-0"
        onChange={vi.fn()}
        ariaLabel="Model"
        searchPlaceholder="Search models"
        minSearchableOptions={8}
        searchInputTestId="model-search-input"
      />,
    );
    await user.click(screen.getByRole('combobox'));
    await waitFor(() => expect(screen.getByTestId('model-search-input')).toHaveFocus());
  });

  it('clicking inside the search input does not close the popover', async () => {
    const user = userEvent.setup();
    render(
      <SearchableModelSelect
        models={LONG_MODELS}
        value="model-0"
        onChange={vi.fn()}
        ariaLabel="Model"
        searchPlaceholder="Search models"
        minSearchableOptions={8}
      />,
    );
    await user.click(screen.getByRole('combobox'));
    const search = await screen.findByPlaceholderText('Search models');
    await user.click(search);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('renders inside a container carrying the supplied test id', async () => {
    render(
      <SearchableModelSelect
        models={SHORT_MODELS}
        value="m1"
        onChange={vi.fn()}
        ariaLabel="Model"
        searchPlaceholder="Search models"
        testId="agent-a-model-select"
      />,
    );
    expect(screen.getByTestId('agent-a-model-select')).toBeInTheDocument();
  });
});
