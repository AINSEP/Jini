import { readFileSync } from "node:fs";
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConnectorSearchBar } from '../../components/ConnectorSearchBar.js';

describe('ConnectorSearchBar', () => {
  it('calls onChange as the user types', async () => {
    const onChange = vi.fn();
    render(<ConnectorSearchBar value="" onChange={onChange} />);
    await userEvent.type(screen.getByTestId('connectors-search-input'), 'sl');
    expect(onChange).toHaveBeenCalledWith('s');
    expect(onChange).toHaveBeenCalledWith('l');
  });

  it('shows a clear button only when there is a query, and clears on click', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<ConnectorSearchBar value="" onChange={onChange} />);
    expect(screen.queryByTestId('connectors-search-clear')).toBeNull();

    rerender(<ConnectorSearchBar value="slack" onChange={onChange} />);
    await userEvent.click(screen.getByTestId('connectors-search-clear'));
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('clears on Escape when there is a query', () => {
    const onChange = vi.fn();
    render(<ConnectorSearchBar value="slack" onChange={onChange} />);
    const input = screen.getByTestId('connectors-search-input');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('disables the input when disabled=true', () => {
    render(<ConnectorSearchBar value="" onChange={() => {}} disabled />);
    expect((screen.getByTestId('connectors-search-input') as HTMLInputElement).disabled).toBe(true);
  });

  it('fires onFocus when the input receives focus', async () => {
    const onFocus = vi.fn();
    render(<ConnectorSearchBar value="" onChange={() => {}} onFocus={onFocus} />);
    await userEvent.click(screen.getByTestId('connectors-search-input'));
    expect(onFocus).toHaveBeenCalledTimes(1);
  });
});

it('the connector toolbar keeps its search layout and Escape action', async () => {
  const css = readFileSync(new URL('../../../settings/dialog/styles/settings-dialog.css', import.meta.url), 'utf8');
  const onChange = vi.fn();
  const { container } = render(<div className="tab-panel-toolbar"><ConnectorSearchBar value="slack" onChange={onChange} /></div>);
  expect(container.querySelector('.jini-ui-toolbar-search')).not.toBeNull();
  expect(css).toContain('.tab-panel-toolbar .jini-ui-toolbar-search');
  const clear = screen.getByRole('button', { name: 'Clear search' });
  expect(clear).toHaveClass('jini-ui-toolbar-search-clear');
  expect(css).toContain('.jini-ui-toolbar-search-clear');
  const search = screen.getByRole('searchbox', { name: 'Search connectors' });
  search.focus();
  await userEvent.keyboard('{Escape}');
  expect(onChange).toHaveBeenCalledWith('');
  expect(search).toHaveFocus();
});
