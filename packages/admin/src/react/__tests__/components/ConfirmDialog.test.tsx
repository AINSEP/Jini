import { fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '../../components/ConfirmDialog/ConfirmDialog.js';

function renderDialog(props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const result = render(
    <ConfirmDialog
      open
      title="Delete post?"
      body="This cannot be undone."
      confirmLabel="Delete"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
    />,
  );
  return { ...result, onConfirm, onCancel };
}

const dialog = () => document.querySelector('dialog') as HTMLDialogElement;

describe('ConfirmDialog content', () => {
  it('renders title and body, and labels itself by the title', () => {
    renderDialog();
    expect(screen.getByRole('heading', { name: 'Delete post?' })).toBeInTheDocument();
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();
    const titleId = screen.getByRole('heading', { name: 'Delete post?' }).getAttribute('id');
    expect(dialog()).toHaveAttribute('aria-labelledby', titleId);
  });

  it('gives two concurrently-mounted dialogs distinct title ids', () => {
    // A hardcoded id makes `aria-labelledby` resolve to whichever `<h2>` is first in document
    // order, announcing the wrong dialog's title on a destructive action.
    render(
      <>
        <ConfirmDialog open={false} title="Delete role?" body="" confirmLabel="Delete" onConfirm={vi.fn()} onCancel={vi.fn()} />
        <ConfirmDialog open={false} title="Delete policy?" body="" confirmLabel="Delete" onConfirm={vi.fn()} onCancel={vi.fn()} />
      </>,
    );
    const [a, b] = Array.from(document.querySelectorAll('dialog'));
    const idA = a?.getAttribute('aria-labelledby');
    const idB = b?.getAttribute('aria-labelledby');
    expect(idA).toBeTruthy();
    expect(idA).not.toBe(idB);
  });

  it('defaults the cancel label and accepts an override', () => {
    const { rerender } = renderDialog();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    rerender(
      <ConfirmDialog
        open
        title="t"
        body=""
        confirmLabel="Delete"
        cancelLabel="Keep it"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Keep it' })).toBeInTheDocument();
  });
});

describe('ConfirmDialog open/close', () => {
  it('opens under jsdom, which implements neither showModal nor close', () => {
    // The `typeof` guard in the component is what makes this pass — jsdom leaves both methods
    // undefined, so an unconditional `dialog.showModal()` would throw TypeError on render.
    expect(HTMLDialogElement.prototype.showModal).toBeUndefined();
    renderDialog();
    expect(dialog()).toHaveAttribute('open');
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('closes when open flips false', () => {
    const { rerender } = renderDialog();
    rerender(
      <ConfirmDialog open={false} title="t" body="" confirmLabel="Delete" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(dialog()).not.toHaveAttribute('open');
  });

  it('focuses cancel — the safe action — on open', () => {
    renderDialog();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('restores focus to the trigger on close, not to <body>', () => {
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          <ConfirmDialog
            open={open}
            title="t"
            body=""
            confirmLabel="Delete"
            onConfirm={vi.fn()}
            onCancel={() => setOpen(false)}
          />
        </>
      );
    }
    render(<Host />);
    const trigger = screen.getByRole('button', { name: 'Open' });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(trigger).toHaveFocus();
  });

  it('neither action is a submit button, so Enter has no default target', () => {
    renderDialog();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveAttribute('type', 'button');
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveAttribute('type', 'button');
  });
});

describe('ConfirmDialog dismissal', () => {
  it('routes Escape through onCancel rather than letting the browser close the element', () => {
    const { onCancel } = renderDialog();
    fireEvent(dialog(), new Event('cancel', { bubbles: false, cancelable: true }));
    expect(onCancel).toHaveBeenCalledOnce();
    // Still open — `props.open` is the single source of truth, and the caller has not flipped it.
    expect(dialog()).toHaveAttribute('open');
  });

  it('cancels on a click that lands on the dialog element itself (the backdrop area)', () => {
    const { onCancel } = renderDialog();
    fireEvent.click(dialog());
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('does not cancel on a click inside the content box', () => {
    const { onCancel } = renderDialog();
    fireEvent.click(screen.getByRole('heading', { name: 'Delete post?' }));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('blocks Escape, backdrop dismissal and both actions while pending', () => {
    const { onCancel, onConfirm } = renderDialog({ pending: true });
    fireEvent(dialog(), new Event('cancel', { bubbles: false, cancelable: true }));
    fireEvent.click(dialog());
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('ConfirmDialog tone', () => {
  it('is neutral by default', () => {
    renderDialog();
    expect(screen.getByRole('button', { name: 'Delete' })).not.toHaveAttribute('class');
  });

  it('maps the deprecated destructive boolean to danger', () => {
    renderDialog({ destructive: true });
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('btn-danger');
  });

  it('never tones the cancel action, whatever the confirm tone is', () => {
    // Cancel is the safe way out; painting it destructive alongside confirm would undo the
    // distinction the tone exists to draw.
    renderDialog({ tone: 'danger' });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(cancel).toHaveClass('btn-secondary');
    expect(cancel).not.toHaveClass('btn-danger', 'btn-warning');
  });

  it('lets tone win over destructive', () => {
    renderDialog({ tone: 'warning', destructive: true });
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('btn-warning');
  });

  it('fires onConfirm from the confirm action', () => {
    const { onConfirm } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});

describe('ConfirmDialog dialog-hook injection', () => {
  it('renders purely off an injected fake, proving useConfirmDialog is not hardcoded', () => {
    // A fake that never touches showModal/close/focus at all — if ConfirmDialog rendered off
    // anything other than what this hook returns (e.g. called the real useConfirmDialog itself
    // somewhere internally), the title id and click routing below would come from that instead.
    const fakeHandleBackdropClick = vi.fn();
    function useFakeDialog() {
      const dialogRef = useRef<HTMLDialogElement>(null);
      const cancelRef = useRef<HTMLButtonElement>(null);
      return {
        titleId: 'fake-title-id',
        dialogRef,
        cancelRef,
        handleNativeCancel: vi.fn(),
        handleBackdropClick: fakeHandleBackdropClick,
      };
    }

    const { onCancel } = renderDialog({ useDialog: useFakeDialog });

    // `hidden: true`: the fake never sets the `open` attribute the real hook would, so the
    // accessibility tree treats this `<dialog>`'s content as hidden — a detail of this fake, not
    // of the seam under test, so it's opted around here rather than replicated in the fake.
    const heading = screen.getByRole('heading', { name: 'Delete post?', hidden: true });
    expect(heading).toHaveAttribute('id', 'fake-title-id');
    expect(dialog()).toHaveAttribute('aria-labelledby', 'fake-title-id');

    // Backdrop click is routed through the fake's handler, not the real one — the real onCancel
    // prop is never called directly by the component.
    fireEvent.click(dialog());
    expect(fakeHandleBackdropClick).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
  });
});
