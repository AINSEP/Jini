import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatAttachment } from '../../../core/index.js';
import {
  __resetAttachmentPreviewCacheForTests,
  cacheAttachmentPreviewSource,
} from '../../hooks/attachment-preview-cache.js';
import { AttachmentPreviewModal } from '../AttachmentPreviewModal.js';

describe('AttachmentPreviewModal', () => {
  afterEach(() => __resetAttachmentPreviewCacheForTests());

  it('renders the honest metadata view for an attachment with no cached bytes', () => {
    const attachment: ChatAttachment = { path: 'attachment:1', name: 'archive.zip', kind: 'file', size: 512 };
    render(<AttachmentPreviewModal attachment={attachment} onClose={vi.fn()} />);

    expect(screen.getByText('archive.zip', { selector: '.jini-attachment-preview-meta-row span:last-child' })).toBeInTheDocument();
    expect(screen.getByText('File')).toBeInTheDocument();
    expect(screen.getByText('512 B')).toBeInTheDocument();
    expect(screen.getByText('A preview is not available for this file.')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('shows the file contents in a scrollable monospace pane for a cached text-ish attachment', async () => {
    cacheAttachmentPreviewSource('attachment:2', new File(['a,b,c\n1,2,3'], 'rows.csv'));
    const attachment: ChatAttachment = { path: 'attachment:2', name: 'rows.csv', kind: 'file' };
    render(<AttachmentPreviewModal attachment={attachment} onClose={vi.fn()} />);

    // A custom matcher, not a plain string: testing-library's default text matcher normalizes
    // whitespace (collapsing the embedded newline), which would pass even if the newline were lost.
    expect(await screen.findByText((_, el) => el?.tagName === 'PRE' && el.textContent === 'a,b,c\n1,2,3')).toBeInTheDocument();
  });

  it('truncates a text preview past the character cap and says so', async () => {
    const big = 'x'.repeat(200_050);
    cacheAttachmentPreviewSource('attachment:3', new File([big], 'huge.log'));
    const attachment: ChatAttachment = { path: 'attachment:3', name: 'huge.log', kind: 'file' };
    render(<AttachmentPreviewModal attachment={attachment} onClose={vi.fn()} />);

    const pre = await screen.findByText((_, el) => el?.tagName === 'PRE' && (el.textContent?.length ?? 0) === 200_000);
    expect(pre).toBeInTheDocument();
    expect(screen.getByText('Preview truncated — this file is larger than the preview limit.')).toBeInTheDocument();
  });

  describe('with Blob-URL support (jsdom does not implement it - stubbed here; real support is proven in the browser verification pass)', () => {
    let createObjectURL: ReturnType<typeof vi.fn>;
    let revokeObjectURL: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      createObjectURL = vi.fn(() => 'blob:mock-url');
      revokeObjectURL = vi.fn();
      vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    });

    afterEach(() => {
      // Unmount BEFORE restoring the real `URL` global: an unmount here runs this component's own
      // effect cleanup (which calls `URL.revokeObjectURL`), and the global `afterEach(cleanup)` in
      // `vitest.setup.ts` runs AFTER this nested describe's own afterEach hooks (innermost-first),
      // which would otherwise unmount into an already-restored `URL` with no `revokeObjectURL` at
      // all - a false failure about this file's code, not a real one.
      cleanup();
      vi.unstubAllGlobals();
    });

    it('renders a cached image attachment as an <img>, scaled to fit rather than linked', () => {
      cacheAttachmentPreviewSource('attachment:4', new File(['bytes'], 'photo.png'));
      const attachment: ChatAttachment = { path: 'attachment:4', name: 'photo.png', kind: 'image' };
      render(<AttachmentPreviewModal attachment={attachment} onClose={vi.fn()} />);

      const img = screen.getByRole('img', { name: 'photo.png' });
      expect(img).toHaveAttribute('src', 'blob:mock-url');
      expect(createObjectURL).toHaveBeenCalledTimes(1);
    });

    // The bug this task exists to fix: `@jini-ai/http-kit`'s `detectAttachmentKind` sniffs only
    // PNG/JPEG/GIF/WEBP signatures, so a real AVIF upload carries `kind: 'file'` from the server
    // (see AttachmentPreviewModal.hooks.ts's module doc). The chip must still preview it as an
    // image on extension alone rather than deferring to that stale `kind`.
    it('attempts an AVIF attachment as an image even though its server-reported kind is "file"', () => {
      cacheAttachmentPreviewSource('attachment:5', new File(['bytes'], 'ai-caps.avif'));
      const attachment: ChatAttachment = { path: 'attachment:5', name: 'ai-caps.avif', kind: 'file' };
      render(<AttachmentPreviewModal attachment={attachment} onClose={vi.fn()} />);

      expect(screen.getByRole('img', { name: 'ai-caps.avif' })).toBeInTheDocument();
    });

    it('falls back to the honest metadata view when the browser cannot actually decode the attempted image', () => {
      cacheAttachmentPreviewSource('attachment:6', new File(['bytes'], 'weird.avif'));
      const attachment: ChatAttachment = { path: 'attachment:6', name: 'weird.avif', kind: 'file', size: 10 };
      render(<AttachmentPreviewModal attachment={attachment} onClose={vi.fn()} />);

      fireEvent.error(screen.getByRole('img', { name: 'weird.avif' }));

      expect(screen.queryByRole('img')).not.toBeInTheDocument();
      expect(screen.getByText('A preview is not available for this file.')).toBeInTheDocument();
    });

    it('revokes the object URL on unmount', () => {
      cacheAttachmentPreviewSource('attachment:7', new File(['bytes'], 'photo.png'));
      const attachment: ChatAttachment = { path: 'attachment:7', name: 'photo.png', kind: 'image' };
      const { unmount } = render(<AttachmentPreviewModal attachment={attachment} onClose={vi.fn()} />);
      unmount();
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    });
  });

  it('calls onClose from the header close button', () => {
    const onClose = vi.fn();
    const attachment: ChatAttachment = { path: 'attachment:8', name: 'notes.txt', kind: 'file' };
    render(<AttachmentPreviewModal attachment={attachment} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose on a backdrop click but not on a click inside the surface', () => {
    const onClose = vi.fn();
    const attachment: ChatAttachment = { path: 'attachment:9', name: 'notes.txt', kind: 'file' };
    const { container } = render(<AttachmentPreviewModal attachment={attachment} onClose={onClose} />);
    const dialog = container.querySelector('dialog.jini-attachment-preview-dialog')!;

    fireEvent.click(screen.getByText('notes.txt', { selector: '.jini-attachment-preview-name' }));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose (and prevents the default close) on the dialog\'s native cancel event', () => {
    const onClose = vi.fn();
    const attachment: ChatAttachment = { path: 'attachment:10', name: 'notes.txt', kind: 'file' };
    const { container } = render(<AttachmentPreviewModal attachment={attachment} onClose={onClose} />);
    const dialog = container.querySelector('dialog.jini-attachment-preview-dialog')!;

    const event = new Event('cancel', { cancelable: true });
    fireEvent(dialog, event);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('has an accessible dialog role, aria-modal, and a label naming the file', () => {
    const attachment: ChatAttachment = { path: 'attachment:11', name: 'ai-caps.avif', kind: 'file' };
    render(<AttachmentPreviewModal attachment={attachment} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'ai-caps.avif preview' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });
});
