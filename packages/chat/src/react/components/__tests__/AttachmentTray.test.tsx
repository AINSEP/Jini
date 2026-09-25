import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AttachmentTray, formatAttachmentSize } from '../AttachmentTray.js';

describe('AttachmentTray', () => {
  it('renders nothing for an empty attachment list', () => {
    const { container } = render(<AttachmentTray attachments={[]} onRemove={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a chip per attachment and calls onRemove with the attachment path', async () => {
    const onRemove = vi.fn();
    render(
      <AttachmentTray
        attachments={[
          { path: '/a.png', name: 'a.png', kind: 'image', size: 1_536 },
          { path: '/b.txt', name: 'b.txt', kind: 'file' },
        ]}
        onRemove={onRemove}
      />,
    );
    expect(screen.getByText('a.png')).toBeInTheDocument();
    expect(screen.getByText('1.5 KB')).toBeInTheDocument();
    expect(screen.getByText('b.txt')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove a.png' }));
    expect(onRemove).toHaveBeenCalledWith('/a.png');
  });

  it('uses a host-supplied renderItem when provided', () => {
    render(<AttachmentTray attachments={[{ path: '/a.png', name: 'a.png', kind: 'image' }]} onRemove={() => {}} renderItem={(a) => <span data-testid="custom">{a.name.toUpperCase()}</span>} />);
    expect(screen.getByTestId('custom')).toHaveTextContent('A.PNG');
  });

  it('formats byte counts without inventing invalid metadata', () => {
    expect(formatAttachmentSize(undefined)).toBeNull();
    expect(formatAttachmentSize(Number.NaN)).toBeNull();
    expect(formatAttachmentSize(-1)).toBeNull();
    expect(formatAttachmentSize(12)).toBe('12 B');
    expect(formatAttachmentSize(10 * 1_024)).toBe('10 KB');
    expect(formatAttachmentSize(1.5 * 1_024 * 1_024)).toBe('1.5 MB');
  });

  it('tags the tray container and each chip with stable E2E hooks', () => {
    const { container } = render(
      <AttachmentTray
        attachments={[
          { path: '/a.png', name: 'a.png', kind: 'image', size: 1_536 },
          { path: '/b.txt', name: 'b.txt', kind: 'file' },
        ]}
        onRemove={() => {}}
      />,
    );
    expect(screen.getByTestId('composer-attachment-tray')).toBe(container.firstChild);
    const chips = screen.getAllByTestId('attachment-chip');
    expect(chips).toHaveLength(2);
    expect(chips[0]).toHaveAttribute('data-attachment-kind', 'image');
    expect(chips[0]).toHaveAttribute('data-attachment-name', 'a.png');
    expect(chips[1]).toHaveAttribute('data-attachment-kind', 'file');
    expect(chips[1]).toHaveAttribute('data-attachment-name', 'b.txt');
  });

  it('emits the real attachment.kind enum value even when a host overrides the chip body via renderItem', () => {
    render(
      <AttachmentTray
        attachments={[{ path: '/emoji.png', name: '_.png', kind: 'image' }]}
        onRemove={() => {}}
        renderItem={(a) => <span data-testid="custom">{a.name}</span>}
      />,
    );
    const chip = screen.getByTestId('attachment-chip');
    // The sanitized name asserted here (`_.png`) stands in for a unicode/emoji source filename
    // that `sanitizeAttachmentName` already collapsed before this component ever saw it — the
    // point of `data-attachment-name` is to expose whatever that upstream sanitizer decided,
    // without the E2E needing to re-derive its logic.
    expect(chip).toHaveAttribute('data-attachment-kind', 'image');
    expect(chip).toHaveAttribute('data-attachment-name', '_.png');
  });
});
