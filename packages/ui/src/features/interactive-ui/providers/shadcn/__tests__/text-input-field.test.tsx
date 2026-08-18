import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextInputField } from '../text-input-field.js';

describe('shadcn TextInputField', () => {
  it('renders a real shadcn Input with the given placeholder', () => {
    render(<TextInputField placeholder="Your name" />);
    expect(screen.getByPlaceholderText('Your name')).toBeInTheDocument();
  });

  it('seeds the field from value (uncontrolled)', () => {
    render(<TextInputField value="Ada" />);
    expect(screen.getByDisplayValue('Ada')).toBeInTheDocument();
  });

  it('calls onValueChange with the new text as the user types', async () => {
    const onValueChange = vi.fn();
    render(<TextInputField onValueChange={onValueChange} />);
    await userEvent.type(screen.getByRole('textbox'), 'hi');
    expect(onValueChange).toHaveBeenCalledWith('h');
    expect(onValueChange).toHaveBeenCalledWith('hi');
  });

  it('disables the field when disabled is true', () => {
    render(<TextInputField disabled />);
    expect(screen.getByRole('textbox')).toBeDisabled();
  });

  it('defaults to a text input type', () => {
    render(<TextInputField />);
    expect(screen.getByRole('textbox')).toHaveAttribute('type', 'text');
  });

  it('honors an explicit type', () => {
    render(<TextInputField type="password" placeholder="Password" />);
    expect(document.querySelector('input[type="password"]')).not.toBeNull();
  });
});
