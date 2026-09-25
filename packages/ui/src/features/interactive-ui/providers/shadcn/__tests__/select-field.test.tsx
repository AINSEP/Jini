import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SelectField } from '../select-field.js';

const options = [
  { value: 'a', label: 'Option A' },
  { value: 'b', label: 'Option B' },
];

describe('shadcn SelectField', () => {
  it('renders a real shadcn Select trigger with the placeholder when no value is chosen', () => {
    render(<SelectField options={options} placeholder="Pick one" />);
    expect(screen.getByRole('combobox')).toHaveTextContent('Pick one');
  });

  it('shows the label for a pre-selected value', () => {
    render(<SelectField options={options} value="b" />);
    expect(screen.getByRole('combobox')).toHaveTextContent('Option B');
  });

  it('opens the listbox and calls onValueChange when an option is picked', async () => {
    const onValueChange = vi.fn();
    render(<SelectField options={options} onValueChange={onValueChange} />);
    await userEvent.click(screen.getByRole('combobox'));
    const option = await screen.findByRole('option', { name: 'Option B' });
    await userEvent.click(option);
    expect(onValueChange).toHaveBeenCalledWith('b');
  });

  it('disables the trigger when disabled is true', () => {
    render(<SelectField options={options} disabled />);
    expect(screen.getByRole('combobox')).toBeDisabled();
  });
});
