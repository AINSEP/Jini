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
});
