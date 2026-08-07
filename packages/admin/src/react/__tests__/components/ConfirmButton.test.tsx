import { fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmButton } from '../../components/ConfirmButton/ConfirmButton.js';

function renderButton(props: Partial<Parameters<typeof ConfirmButton>[0]> = {}) {
  const onConfirm = vi.fn();
  render(<ConfirmButton label="Delete" confirmLabel="Confirm delete" onConfirm={onConfirm} {...props} />);
  return { onConfirm, button: () => screen.getByRole('button') };
}

describe('ConfirmButton arming', () => {
  it('does not fire on the first click', () => {
    const { onConfirm, button } = renderButton();
    fireEvent.click(button());
    expect(onConfirm).not.toHaveBeenCalled();
    expect(button()).toHaveTextContent('Confirm delete');
    expect(button()).toHaveAttribute('data-armed', 'true');
  });

  it('fires on the second click and disarms', () => {
    const { onConfirm, button } = renderButton();
    fireEvent.click(button());
    fireEvent.click(button());
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(button()).toHaveTextContent('Delete');
    expect(button()).not.toHaveAttribute('data-armed');
  });

  it('announces the armed state through a live region', () => {
    const { button } = renderButton();
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('');
    fireEvent.click(button());
    expect(status).toHaveTextContent('Press "Confirm delete" to confirm, or press Escape to cancel.');
  });
});

describe('ConfirmButton disarming', () => {
  it('disarms on Escape without firing', () => {
    const { onConfirm, button } = renderButton();
    fireEvent.click(button());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(button()).toHaveTextContent('Delete');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('disarms on an outside mousedown without firing', () => {
    const { onConfirm, button } = renderButton();
    fireEvent.click(button());
    fireEvent.mouseDown(document.body);
    expect(button()).toHaveTextContent('Delete');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('stays armed when the mousedown lands on the button itself', () => {
    const { button } = renderButton();
    fireEvent.click(button());
    fireEvent.mouseDown(button());
    expect(button()).toHaveTextContent('Confirm delete');
  });

  it('disarms on blur', () => {
    const { onConfirm, button } = renderButton();
    fireEvent.click(button());
    fireEvent.blur(button());
    expect(button()).toHaveTextContent('Delete');
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('ConfirmButton states', () => {
  it('shows the pending label and blocks clicks while pending', () => {
    const { onConfirm, button } = renderButton({ pending: true, pendingLabel: 'Deleting…' });
    expect(button()).toHaveTextContent('Deleting…');
    expect(button()).toBeDisabled();
    fireEvent.click(button());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('defaults the pending label', () => {
    renderButton({ pending: true });
    expect(screen.getByRole('button')).toHaveTextContent('…');
  });

  it('blocks clicks while disabled', () => {
    const { onConfirm, button } = renderButton({ disabled: true });
    fireEvent.click(button());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('applies btn-danger only when destructive, merged with a caller class', () => {
    render(<ConfirmButton label="A" confirmLabel="B" onConfirm={vi.fn()} destructive className="row-action" />);
    expect(screen.getByRole('button', { name: 'A' })).toHaveClass('row-action', 'btn-danger');
  });

  it('leaves className unset when neither destructive nor a class is passed', () => {
    renderButton();
    expect(screen.getByRole('button')).not.toHaveAttribute('class');
  });

  it('takes an explicit accessible name for repeated per-row controls', () => {
    renderButton({ ariaLabel: 'Delete "My Post"' });
    expect(screen.getByRole('button', { name: 'Delete "My Post"' })).toBeInTheDocument();
  });
});

describe('ConfirmButton hook injection', () => {
  it('renders purely off an injected fake, proving useConfirmButton is not hardcoded', () => {
    // A fake that reports armed with spy handlers — no real click-count state or document
    // listeners run at all. If ConfirmButton rendered off anything other than what this hook
    // returns, the label/attribute assertions below would come from real state instead.
    const fakeHandleClick = vi.fn();
    const fakeHandleBlur = vi.fn();
    function useFakeConfirmButton() {
      const buttonRef = useRef<HTMLButtonElement>(null);
      return { confirming: true, buttonRef, handleClick: fakeHandleClick, handleBlur: fakeHandleBlur };
    }

    const { button } = renderButton({ useConfirmButton: useFakeConfirmButton });

    expect(button()).toHaveTextContent('Confirm delete');
    expect(button()).toHaveAttribute('data-armed', 'true');

    fireEvent.click(button());
    expect(fakeHandleClick).toHaveBeenCalledOnce();

    fireEvent.blur(button());
    expect(fakeHandleBlur).toHaveBeenCalledOnce();
  });
});
