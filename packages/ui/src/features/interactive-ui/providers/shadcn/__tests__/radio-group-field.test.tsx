import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RadioGroupField } from '../radio-group-field.js';

const options = [
  { value: 'a', label: 'Option A' },
  { value: 'b', label: 'Option B' },
];

describe('shadcn RadioGroupField', () => {
  it('renders one labeled radio per option via the real shadcn RadioGroup primitive', () => {
    render(<RadioGroupField options={options} />);
    expect(screen.getByRole('radio', { name: 'Option A' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Option B' })).toBeInTheDocument();
  });

  it('pre-selects the option matching value', () => {
    render(<RadioGroupField options={options} value="b" />);
    expect(screen.getByRole('radio', { name: 'Option B' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Option A' })).not.toBeChecked();
  });

  it('calls onValueChange with the selected value', async () => {
    const onValueChange = vi.fn();
    render(<RadioGroupField options={options} onValueChange={onValueChange} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Option B' }));
    expect(onValueChange).toHaveBeenCalledWith('b');
  });

  it('disables every option when disabled is true', () => {
    render(<RadioGroupField options={options} disabled />);
    expect(screen.getByRole('radio', { name: 'Option A' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Option B' })).toBeDisabled();
  });
});
