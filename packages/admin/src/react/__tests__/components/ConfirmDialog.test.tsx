import { fireEvent, render, screen } from '@testing-library/react';
import { memo, useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AGENT_ELEMENT_ATTRIBUTE } from '@jini-ai/agentic';
import { ConfirmDialog } from '../../components/ConfirmDialog/ConfirmDialog.js';
import { ConfirmDialogDefaultsProvider } from '../../components/ConfirmDialog/ConfirmDialog.hooks.js';
import type { UseConfirmDialog } from '../../components/ConfirmDialog/ConfirmDialog.hooks.js';

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

/** Every published handle in `root`, in document order — same helper `RowMenu.test.tsx` uses for
 *  the identical assertion shape. */
function handlesIn(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll(`[${AGENT_ELEMENT_ATTRIBUTE}]`)).map(
    (element) => element.getAttribute(AGENT_ELEMENT_ATTRIBUTE) ?? '',
  );
}

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

describe('ConfirmDialog defaults context', () => {
  it("uses the enclosing provider's cancelLabel when no explicit prop is passed", () => {
    render(
      <ConfirmDialogDefaultsProvider cancelLabel="Abbrechen">
        <ConfirmDialog
          open
          title="Delete post?"
          body="This cannot be undone."
          confirmLabel="Delete"
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />
      </ConfirmDialogDefaultsProvider>,
    );
    expect(screen.getByRole('button', { name: 'Abbrechen' })).toBeInTheDocument();
  });

  it('lets an explicit cancelLabel prop win over the provider default', () => {
    render(
      <ConfirmDialogDefaultsProvider cancelLabel="Abbrechen">
        <ConfirmDialog
          open
          title="Delete post?"
          body=""
          confirmLabel="Delete"
          cancelLabel="Keep it"
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />
      </ConfirmDialogDefaultsProvider>,
    );
    expect(screen.getByRole('button', { name: 'Keep it' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Abbrechen' })).not.toBeInTheDocument();
  });

  it('falls back to the component\'s built-in "Cancel" with no enclosing provider at all', () => {
    renderDialog();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('does not re-render a dialog under a memoized parent when the provider re-renders with the same cancelLabel', () => {
    // The injected `useDialog` runs once per `ConfirmDialog` render, so its call count is the
    // dialog's render count. `memo` makes the parent bail out on the provider's re-render, so the
    // only way the dialog can re-render is a new context value.
    const renderCount = vi.fn();
    const countingDialog: UseConfirmDialog = () => {
      renderCount();
      return {
        titleId: 't',
        dialogRef: { current: null },
        cancelRef: { current: null },
        handleNativeCancel: () => {},
        handleBackdropClick: () => {},
      };
    };
    const MemoizedParent = memo(function MemoizedParent() {
      return (
        <ConfirmDialog
          open
          title="Delete post?"
          body=""
          confirmLabel="Delete"
          onConfirm={() => {}}
          onCancel={() => {}}
          useDialog={countingDialog}
        />
      );
    });
    const tree = (label: string) => (
      <ConfirmDialogDefaultsProvider cancelLabel={label}>
        <MemoizedParent />
      </ConfirmDialogDefaultsProvider>
    );

    const { rerender } = render(tree('Abbrechen'));
    expect(renderCount).toHaveBeenCalledTimes(1);

    rerender(tree('Abbrechen'));
    expect(renderCount).toHaveBeenCalledTimes(1);

    rerender(tree('Annuler'));
    expect(renderCount).toHaveBeenCalledTimes(2);
    // `hidden`: the fake controller never opens the `<dialog>`, so its contents sit outside the
    // accessibility tree.
    expect(screen.getByRole('button', { name: 'Annuler', hidden: true })).toBeInTheDocument();
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

  it('accepts a substitute declared against the published UseConfirmDialog contract, holding no React state at all', () => {
    // The point of typing `useDialog` against `UseConfirmDialog` rather than
    // `typeof useConfirmDialog`: a consumer can write a substitute against the PUBLISHED contract
    // without importing, reading, or structurally matching the default hook. This one holds no
    // state and calls no React hook — the annotation, not the inference, is what says that is
    // allowed, because `typeof` names an implementation while this names a contract.
    const handleBackdropClick = vi.fn();
    const stateless: UseConfirmDialog = (open, pending, onCancel) => ({
      titleId: 'contract-title-id',
      dialogRef: { current: null },
      cancelRef: { current: null },
      handleNativeCancel: () => {
        if (open && !pending) onCancel();
      },
      handleBackdropClick,
    });

    renderDialog({ useDialog: stateless });

    expect(screen.getByRole('heading', { name: 'Delete post?', hidden: true })).toHaveAttribute(
      'id',
      'contract-title-id',
    );
    fireEvent.click(dialog());
    expect(handleBackdropClick).toHaveBeenCalledOnce();
  });
});

describe('ConfirmDialog agent handles', () => {
  it('emits no data-agent-* markup at all when agentHandle is omitted', () => {
    renderDialog();
    expect(handlesIn(document.body)).toEqual([]);
  });

  it('publishes the confirm action by default, with role button', () => {
    renderDialog({ agentHandle: 'delete-role' });
    const confirm = screen.getByRole('button', { name: 'Delete' });
    expect(confirm).toHaveAttribute(AGENT_ELEMENT_ATTRIBUTE, 'delete-role-confirm');
    expect(confirm).toHaveAttribute('data-agent-role', 'button');
    expect(handlesIn(document.body)).toEqual(['delete-role-cancel', 'delete-role-confirm']);
  });

  it('still publishes the cancel action under its own sub-handle, with role button', () => {
    renderDialog({ agentHandle: 'delete-role' });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(cancel).toHaveAttribute(AGENT_ELEMENT_ATTRIBUTE, 'delete-role-cancel');
    expect(cancel).toHaveAttribute('data-agent-role', 'button');
  });

  it('omits the confirm action only when the caller opts out with agentMayConfirm: false', () => {
    // The page driver clicks any published element. Most dialogs want the assistant able to
    // confirm — permanently destructive actions are gated in-chat at the tool level instead — but
    // a dialog guarding a secret can opt out explicitly.
    renderDialog({ agentHandle: 'delete-role', agentMayConfirm: false });
    const confirm = screen.getByRole('button', { name: 'Delete' });
    expect(confirm).not.toHaveAttribute(AGENT_ELEMENT_ATTRIBUTE);
    expect(confirm).not.toHaveAttribute('data-agent-role');
    expect(confirm).not.toHaveAttribute('data-agent-label');
    expect(handlesIn(document.body)).toEqual(['delete-role-cancel']);
  });

  it('emits no markup for agentMayConfirm alone, without an agentHandle', () => {
    renderDialog({ agentMayConfirm: false });
    expect(handlesIn(document.body)).toEqual([]);
  });

  it('publishes both handles even while the dialog is closed — it stays mounted, never conditionally rendered', () => {
    renderDialog({ agentHandle: 'delete-role', open: false });
    expect(handlesIn(document.body)).toEqual(['delete-role-cancel', 'delete-role-confirm']);
  });

  it('states the confirm action and its target in the label, with no consequence phrase at the default tone', () => {
    renderDialog({ agentHandle: 'delete-role' });
    const confirm = screen.getByRole('button', { name: 'Delete' });
    expect(confirm).toHaveAttribute('data-agent-label', 'Delete — Delete post?');
  });

  it('appends the danger tier\'s irreversibility to the confirm label', () => {
    renderDialog({ agentHandle: 'delete-role', tone: 'danger' });
    const confirm = screen.getByRole('button', { name: 'Delete' });
    expect(confirm).toHaveAttribute('data-agent-label', 'Delete — Delete post?; cannot be undone');
  });

  it('appends the warning tier\'s reversible-but-access-affecting phrase to the confirm label', () => {
    renderDialog({ agentHandle: 'delete-role', tone: 'warning', confirmLabel: 'Disable' });
    const confirm = screen.getByRole('button', { name: 'Disable' });
    expect(confirm).toHaveAttribute('data-agent-label', 'Disable — Delete post?; changes access, but is reversible');
  });

  it('maps the deprecated destructive boolean onto the same danger consequence phrase as tone', () => {
    renderDialog({ agentHandle: 'delete-role', destructive: true });
    const confirm = screen.getByRole('button', { name: 'Delete' });
    expect(confirm).toHaveAttribute('data-agent-label', 'Delete — Delete post?; cannot be undone');
  });

  it('states that cancelling takes no action, regardless of the confirm tone', () => {
    renderDialog({ agentHandle: 'delete-role', tone: 'danger' });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(cancel).toHaveAttribute('data-agent-label', 'Cancel — leaves "Delete post?" unconfirmed; no action taken');
  });

  it('reflects a cancelLabel override in both the accessible name and the agent label', () => {
    renderDialog({ agentHandle: 'delete-role', cancelLabel: 'Keep it' });
    const cancel = screen.getByRole('button', { name: 'Keep it' });
    expect(cancel).toHaveAttribute(AGENT_ELEMENT_ATTRIBUTE, 'delete-role-cancel');
    expect(cancel).toHaveAttribute('data-agent-label', 'Keep it — leaves "Delete post?" unconfirmed; no action taken');
  });
});
