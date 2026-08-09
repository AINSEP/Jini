import { fireEvent, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Composer } from '../Composer.js';
import { useComposer } from '../../hooks/useComposer.js';

function ComposerHarness({ onSend }: { onSend: (draft: string) => void }) {
  const composer = useComposer();
  return <Composer composer={composer} onSend={() => onSend(composer.draft)} />;
}

describe('Composer', () => {
  it('disables send until there is a draft or attachment', async () => {
    render(<ComposerHarness onSend={() => {}} />);
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText('Send a message…'), 'hi');
    expect(send).not.toBeDisabled();
  });

  it('calls onSend when the send button is clicked', async () => {
    const onSend = vi.fn();
    render(<ComposerHarness onSend={onSend} />);
    await userEvent.type(screen.getByPlaceholderText('Send a message…'), 'hello');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledWith('hello');
  });

  it('Enter submits (without Shift), Shift+Enter inserts a newline instead', async () => {
    const onSend = vi.fn();
    render(<ComposerHarness onSend={onSend} />);
    const textarea = screen.getByPlaceholderText('Send a message…');
    await userEvent.type(textarea, 'line one{Shift>}{Enter}{/Shift}line two');
    expect(onSend).not.toHaveBeenCalled();
    expect((textarea as HTMLTextAreaElement).value).toBe('line one\nline two');
    await userEvent.type(textarea, '{Enter}');
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('renders plusMenuItems, leadingAccessories, and footerAccessories slots when supplied', async () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() => useComposer());
    render(
      <Composer
        composer={result.current}
        onSend={() => {}}
        slots={{
          leadingAccessories: <span data-testid="leading">mode</span>,
          footerAccessories: <span data-testid="footer">agent</span>,
          plusMenuItems: [{ id: 'p1', label: 'Import file', onSelect }],
        }}
      />,
    );
    expect(screen.getByTestId('leading')).toBeInTheDocument();
    expect(screen.getByTestId('footer')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Import file'));
    expect(onSelect).toHaveBeenCalled();
  });

  it('renders the attachment tray for staged attachments', () => {
    render(<ComposerHarness onSend={() => {}} />);
    // No attachments staged yet -> tray renders nothing.
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument();
  });

  it('opens and forwards the hidden attachment input while reflecting upload state', async () => {
    const onFiles = vi.fn();
    const { result } = renderHook(() => useComposer());
    const { rerender } = render(
      <Composer
        composer={result.current}
        onSend={() => {}}
        attachmentPicker={{ onFiles, accept: 'image/*' }}
      />,
    );
    const input = screen.getByLabelText('Attach files', { selector: 'input' });
    const inputClick = vi.spyOn(input, 'click');
    await userEvent.click(screen.getByRole('button', { name: 'Attach files' }));
    expect(inputClick).toHaveBeenCalledTimes(1);

    fireEvent.change(input, { target: { files: null } });
    expect(onFiles).not.toHaveBeenCalled();
    const file = new File(['image'], 'reference.png', { type: 'image/png' });
    await userEvent.upload(input, file);
    expect(onFiles).toHaveBeenCalledWith([file]);

    rerender(
      <Composer
        composer={result.current}
        onSend={() => {}}
        attachmentPicker={{ onFiles, uploading: true }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Attaching files…' })).toBeDisabled();
  });

  it('swaps the send button for a stop button while running, calling onCancel instead of onSend', async () => {
    const onSend = vi.fn();
    const onCancel = vi.fn();
    const { result } = renderHook(() => useComposer());
    render(<Composer composer={result.current} onSend={onSend} running onCancel={onCancel} />);

    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
    const stop = screen.getByRole('button', { name: 'Stop run' });
    await userEvent.click(stop);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('keeps the stop button clickable even when disabled/sendDisabled would gate the send button', async () => {
    // `disabled`/`sendDisabled` gate submitting a NEW draft — irrelevant to cancelling a run
    // already in flight, which is why running ignores both rather than inheriting them.
    const onCancel = vi.fn();
    const { result } = renderHook(() => useComposer());
    render(
      <Composer composer={result.current} onSend={() => {}} disabled sendDisabled running onCancel={onCancel} />,
    );
    const stop = screen.getByRole('button', { name: 'Stop run' });
    expect(stop).not.toBeDisabled();
    await userEvent.click(stop);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('can disable only submission while keeping draft editing available', async () => {
    const onSend = vi.fn();
    const { result } = renderHook(() => useComposer({ initialDraft: 'editable' }));
    render(<Composer composer={result.current} onSend={onSend} sendDisabled />);

    const textarea = screen.getByRole('textbox');
    expect(textarea).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await userEvent.type(textarea, '{Enter}');
    expect(onSend).not.toHaveBeenCalled();
  });
});
