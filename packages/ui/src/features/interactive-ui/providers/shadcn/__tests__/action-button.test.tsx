import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActionButton } from '../action-button.js';

describe('shadcn ActionButton', () => {
  it('renders the label as the button text via the real shadcn Button primitive', () => {
    render(<ActionButton label="Submit" />);
    const button = screen.getByRole('button', { name: 'Submit' });
    expect(button).toBeInTheDocument();
  });

  it('calls onPress when clicked', async () => {
    const onPress = vi.fn();
    render(<ActionButton label="Submit" onPress={onPress} />);
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('disables the button when disabled is true', () => {
    render(<ActionButton label="Submit" disabled />);
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
  });

  it('applies the requested variant/size as real shadcn class names', () => {
    render(<ActionButton label="Delete" variant="destructive" size="lg" />);
    const button = screen.getByRole('button', { name: 'Delete' });
    expect(button.className).toContain('bg-destructive');
    expect(button.className).toContain('h-10');
  });
});
