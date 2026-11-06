import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CheckboxField } from '../checkbox-field.js';
import { SelectField } from '../select-field.js';

it('tags checkbox controls by default, forwards explicit names and respects opt-out', () => {
  const { rerender } = render(<CheckboxField label="Enable" />);
  expect(screen.getByRole('checkbox')).toHaveAttribute('data-agent-element');
  rerender(<CheckboxField label="Enable" agentHandle="enable-feature" />);
  expect(screen.getByRole('checkbox')).toHaveAttribute('data-agent-element', 'enable-feature');
  rerender(<CheckboxField label="Enable" agentHandle={false} />);
  expect(screen.getByRole('checkbox')).not.toHaveAttribute('data-agent-element');
});

it('tags the select trigger and value-derived option with an owned portal destination', async () => {
  const onValueChange = vi.fn();
  const overlay = document.createElement('div');
  document.body.append(overlay);
  const { unmount } = render(<SelectField options={[{ value: 'b/2', label: 'Choice' }]} agentHandle="choose-kind" onValueChange={onValueChange} portalContainer={overlay} />);
  expect(screen.getByRole('combobox')).toHaveAttribute('data-agent-element', 'choose-kind');
  await userEvent.click(screen.getByRole('combobox'));
  const option = screen.getByRole('option');
  expect(option.getAttribute('data-agent-element')).toMatch(/^choose-kind-option-/);
  expect(overlay.contains(option)).toBe(true);
  await userEvent.click(option);
  expect(onValueChange).toHaveBeenCalledWith('b/2');
  unmount(); overlay.remove();
});

it('keeps select opt-out on both trigger and options', async () => {
  render(<SelectField options={[{ value: 'a', label: 'A' }]} agentHandle={false} />);
  expect(screen.getByRole('combobox')).not.toHaveAttribute('data-agent-element');
  await userEvent.click(screen.getByRole('combobox'));
  expect(screen.getByRole('option')).not.toHaveAttribute('data-agent-element');
});
