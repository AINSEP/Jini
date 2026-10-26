// @vitest-environment jsdom
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SecretInput } from './SecretInput.js';

function Field({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <form onSubmit={(event) => event.preventDefault()}>
      <label htmlFor="k">API key</label>
      <SecretInput id="k" label="API key" value={value} onChange={(event) => setValue(event.target.value)} />
      <button type="button" onClick={() => setValue('')}>Save</button>
    </form>
  );
}

describe('SecretInput', () => {
  it('starts hidden, inside one .jini-secret wrapper with the eye toggle', () => {
    const { container } = render(<Field initial="sk-1" />);
    const input = screen.getByLabelText('API key');
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveAttribute('spellcheck', 'false');
    const toggle = screen.getByRole('button', { name: 'Show API key' });
    expect(toggle).toHaveAttribute('type', 'button');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle).toHaveClass('jini-secret-toggle');
    expect(toggle.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('.jini-secret')?.contains(input)).toBe(true);
  });

  it('flips password <-> text and its own name/pressed state on each press', async () => {
    render(<Field initial="sk-1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Show API key' }));
    expect(screen.getByLabelText('API key')).toHaveAttribute('type', 'text');
    const hide = screen.getByRole('button', { name: 'Hide API key' });
    expect(hide).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(hide);
    expect(screen.getByLabelText('API key')).toHaveAttribute('type', 'password');
  });

  it('never submits its form', async () => {
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <SecretInput aria-label="Token" label="Token" defaultValue="t" />
      </form>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Show Token' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('re-masks when the value is cleared (a save), but an empty field can still be revealed', async () => {
    render(<Field initial="sk-1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Show API key' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByLabelText('API key')).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByRole('button', { name: 'Show API key' }));
    expect(screen.getByLabelText('API key')).toHaveAttribute('type', 'text');
  });

  it('controlled: shows what `revealed` says and reports presses instead of flipping itself', async () => {
    const onRevealedChange = vi.fn();
    const { rerender } = render(<SecretInput aria-label="Key" label="Key" value="v" readOnly revealed={false} onRevealedChange={onRevealedChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Show Key' }));
    expect(onRevealedChange).toHaveBeenCalledWith(true);
    expect(screen.getByLabelText('Key')).toHaveAttribute('type', 'password');
    rerender(<SecretInput aria-label="Key" label="Key" value="v" readOnly revealed onRevealedChange={onRevealedChange} />);
    expect(screen.getByLabelText('Key')).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide Key' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('takes a host translator\'s full names, extra toggle attrs, and disables with its input', () => {
    render(
      <SecretInput aria-label="Clave" label="Clave" defaultValue="" disabled
        toggleLabels={{ show: 'Mostrar clave', hide: 'Ocultar clave' }} toggleAttrs={{ 'data-agent-handle': 'reveal' }} />,
    );
    const toggle = screen.getByRole('button', { name: 'Mostrar clave' });
    expect(toggle).toHaveAttribute('data-agent-handle', 'reveal');
    expect(toggle).toBeDisabled();
  });
});
