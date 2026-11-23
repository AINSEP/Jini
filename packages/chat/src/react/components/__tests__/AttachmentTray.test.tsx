import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AttachmentTray, formatAttachmentSize } from '../AttachmentTray.js';

describe('AttachmentTray', () => {
  it('keeps attachment action identity across reordering and suppresses both leaves on opt-out', () => {
    const attachments = [
      { path: '/first.txt', name: 'Same label', kind: 'file' as const },
      { path: '/second.txt', name: 'Same label', kind: 'file' as const },
    ];
    const onRemove = vi.fn();
    const { container, rerender } = render(<AttachmentTray agentHandle="draft" attachments={attachments} onRemove={onRemove} />);
    const handles = screen.getAllByRole('button', { name: 'Remove Same label' }).map(button => button.getAttribute('data-agent-element'));
    expect(handles[0]).toMatch(/^draft-remove-[a-z0-9-]+$/);
    expect(handles[0]).not.toBe(handles[1]);
    rerender(<AttachmentTray agentHandle="draft" attachments={[...attachments].reverse()} onRemove={onRemove} />);
    expect(screen.getAllByRole('button', { name: 'Remove Same label' }).map(button => button.getAttribute('data-agent-element'))).toEqual([...handles].reverse());
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove Same label' })[0]!);
    expect(onRemove).toHaveBeenCalledWith('/second.txt');
    rerender(<AttachmentTray agentHandle={false} attachments={attachments} onRemove={onRemove} />);
    expect(container.querySelector('[data-agent-element]')).toBeNull();
  });

  it('shows a spinning placeholder chip while an upload runs, and drops it when done', () => {
    const { rerender } = render(<AttachmentTray attachments={[]} onRemove={() => {}} uploading />);
    const chip = screen.getByTestId('attachment-uploading-chip');
    expect(chip).toHaveTextContent('Uploading…');
    expect(chip.querySelector('svg.jini-icon-spin')).not.toBeNull();
    rerender(<AttachmentTray attachments={[]} onRemove={() => {}} uploading={false} />);
    expect(screen.queryByTestId('attachment-uploading-chip')).toBeNull();
  });

  // B014: the tray is height-capped and scrolls, so with 4+ chips a newly added one (often the Uploading chip) sat
  // below the fold. Mutation `no-scroll-new-chip`: drop the effect's scrollIntoView call and the first test goes red.
  it('scrolls the newest chip into view when the chip count grows, and not on mount, removal or swap', () => {
    const scrollIntoView = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      const four = ['a', 'b', 'c', 'd'].map(name => ({ path: `/${name}.txt`, name: `${name}.txt`, kind: 'file' as const }));
      const { rerender } = render(<AttachmentTray attachments={four} onRemove={() => {}} />);
      expect(scrollIntoView).not.toHaveBeenCalled();
      rerender(<AttachmentTray attachments={four} onRemove={() => {}} uploading />);
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(scrollIntoView.mock.contexts[0]).toBe(screen.getByTestId('attachment-uploading-chip'));
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
      const five = [...four, { path: '/e.txt', name: 'e.txt', kind: 'file' as const }];
      rerender(<AttachmentTray attachments={five} onRemove={() => {}} />);
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      rerender(<AttachmentTray attachments={four} onRemove={() => {}} />);
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      rerender(<AttachmentTray attachments={five} onRemove={() => {}} />);
      expect(scrollIntoView).toHaveBeenCalledTimes(2);
      expect(scrollIntoView.mock.contexts[1]).toBe(screen.getAllByTestId('attachment-chip').at(-1));
    } finally { Element.prototype.scrollIntoView = original; }
  });

  it('adds a chip without throwing where the platform has no scrollIntoView', () => {
    const original = Element.prototype.scrollIntoView;
    // jsdom (and some embedded webviews) lack it; the effect must check before calling.
    delete (Element.prototype as Partial<Element>).scrollIntoView;
    try {
      const { rerender } = render(<AttachmentTray attachments={[]} onRemove={() => {}} />);
      expect(() => rerender(<AttachmentTray attachments={[]} onRemove={() => {}} uploading />)).not.toThrow();
    } finally { Element.prototype.scrollIntoView = original; }
  });

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
    expect(formatAttachmentSize({ size: undefined })).toBeNull();
    expect(formatAttachmentSize({ size: Number.NaN })).toBeNull();
    expect(formatAttachmentSize({ size: -1 })).toBeNull();
    expect(formatAttachmentSize({ size: 12 })).toBe('12 B');
    expect(formatAttachmentSize({ size: 10 * 1_024 })).toBe('10 KB');
    expect(formatAttachmentSize({ size: 1.5 * 1_024 * 1_024 })).toBe('1.5 MB');
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
