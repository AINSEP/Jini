import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CheckboxField } from '../checkbox-field.js';

describe('shadcn CheckboxField', () => {
  it('renders a labeled checkbox via the real shadcn Checkbox primitive', () => {
    render(<CheckboxField label="Accept terms" />);
    expect(screen.getByRole('checkbox', { name: 'Accept terms' })).toBeInTheDocument();
  });

  it('renders unchecked by default and reflects checked=true', () => {
    const { rerender } = render(<CheckboxField label="Accept terms" />);
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    rerender(<CheckboxField label="Accept terms" checked />);
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('calls onCheckedChange with a boolean when toggled', async () => {
    const onCheckedChange = vi.fn();
    render(<CheckboxField label="Accept terms" onCheckedChange={onCheckedChange} />);
    await userEvent.click(screen.getByRole('checkbox'));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('disables the control when disabled is true', () => {
    render(<CheckboxField label="Accept terms" disabled />);
    expect(screen.getByRole('checkbox')).toBeDisabled();
  });

  it('renders with no visible label text when label is omitted', () => {
    render(<CheckboxField />);
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
    expect(screen.queryByText('Accept terms')).not.toBeInTheDocument();
  });
});
