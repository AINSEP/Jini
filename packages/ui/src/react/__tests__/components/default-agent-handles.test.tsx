import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PillButton } from '../../components/PillButton.js';
import { PopoverItem } from '../../components/PopoverItem.js';
import { PopoverMenu } from '../../components/PopoverMenu.js';
import { CustomSelect } from '../../components/CustomSelect.js';

const wrappers = [
  { name: 'PillButton', control: (handle?: string | false) => <PillButton label="Same label" onClick={vi.fn()} agentHandle={handle} /> },
  { name: 'PopoverItem', control: (handle?: string | false) => <PopoverItem label="Same label" onClick={vi.fn()} agentHandle={handle} /> },
  { name: 'CustomSelect', control: (handle?: string | false) => <CustomSelect value="a" ariaLabel="Same label" options={[{ value: 'a', label: 'A' }]} onChange={vi.fn()} agentHandle={handle} portal={false} /> },
];

describe('shared control agent handles', () => {
  it.each(wrappers)('$name tags the actual control by default and preserves explicit/false', ({ control }) => {
    const { container, rerender } = render(control());
    const target = () => container.querySelector('button')!;
    expect(target()).toHaveAttribute('data-agent-element');
    const generated = target().getAttribute('data-agent-element');
    rerender(control());
    expect(target()).toHaveAttribute('data-agent-element', generated);
    rerender(control('my-control'));
    expect(target()).toHaveAttribute('data-agent-element', 'my-control');
    rerender(control(false));
    expect(target()).not.toHaveAttribute('data-agent-element');
  });

  it('keeps the popover descriptive while each row has a distinct address', () => {
    const { container } = render(<PopoverMenu><PopoverItem label="Same label" onClick={vi.fn()} /><PopoverItem label="Same label" onClick={vi.fn()} /></PopoverMenu>);
    expect(container.querySelector('.jini-popover')).not.toHaveAttribute('data-agent-element');
    const buttons = screen.getAllByRole('button');
    expect(buttons[0]).toHaveAttribute('data-agent-element');
    expect(buttons[0]!.getAttribute('data-agent-element')).not.toBe(buttons[1]!.getAttribute('data-agent-element'));
  });

  it('derives select rows from values and keeps them stable across translated labels/reorder', () => {
    const onChange = vi.fn();
    const { rerender } = render(<CustomSelect value="a" ariaLabel="Runtime" options={[{ value: 'a', label: 'First' }, { value: 'b/2', label: 'Second' }]} onChange={onChange} agentHandle="runtime" portal={false} />);
    fireEvent.click(screen.getByRole('combobox'));
    const secondHandle = screen.getByRole('option', { name: 'Second' }).getAttribute('data-agent-element');
    expect(secondHandle).toMatch(/^runtime-option-/);
    rerender(<CustomSelect value="a" ariaLabel="Runtime" options={[{ value: 'b/2', label: 'Deuxième' }, { value: 'a', label: 'Premier' }]} onChange={onChange} agentHandle="runtime" portal={false} />);
    const second = screen.getByRole('option', { name: 'Deuxième' });
    expect(second).toHaveAttribute('data-agent-element', secondHandle);
    fireEvent.click(second);
    expect(onChange).toHaveBeenCalledWith('b/2');
  });
});
