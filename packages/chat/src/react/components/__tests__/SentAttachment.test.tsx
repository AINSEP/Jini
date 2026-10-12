import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatAttachment, ChatMessage } from '../../../core/index.js';
import {
  __resetAttachmentPreviewCacheForTests,
  cacheAttachmentPreviewSource,
} from '../../hooks/attachment-preview-cache.js';
import { MessageRow } from '../MessageRow.js';
import { SentAttachmentButton } from '../SentAttachment.js';
import { sentAttachmentThumbnailSource, type ObjectUrlPort } from '../SentAttachment.hooks.js';

function fakeObjectUrls(): ObjectUrlPort & { created: File[]; revoked: string[] } {
  const created: File[] = [];
  const revoked: string[] = [];
  return {
    created,
    revoked,
    create: (file) => {
      created.push(file);
      return `blob:fake-${created.length}`;
    },
    revoke: (url) => {
      revoked.push(url);
    },
  };
}

const IMAGE: ChatAttachment = { path: 'attachment:img-1', name: 'shot.png', kind: 'image' };
const PDF: ChatAttachment = { path: 'attachment:pdf-1', name: 'report.pdf', kind: 'file' };

describe('sentAttachmentThumbnailSource', () => {
  it('returns the cached bytes for an image and nothing for a non-image or an uncached image', () => {
    const png = new File(['png'], 'shot.png');
    const pdf = new File(['pdf'], 'report.pdf');
    const cache = new Map<string, File>([[IMAGE.path, png], [PDF.path, pdf]]);
    const getSource = ({ path }: { path: string }) => cache.get(path);
    expect(sentAttachmentThumbnailSource({ attachment: IMAGE }, { getSource })).toBe(png);
    expect(sentAttachmentThumbnailSource({ attachment: PDF }, { getSource })).toBeUndefined();
    expect(sentAttachmentThumbnailSource({ attachment: { ...IMAGE, path: 'attachment:gone' } }, { getSource })).toBeUndefined();
  });

  it('treats an image extension as an image even when the server said "file"', () => {
    const avif = new File(['avif'], 'caps.avif');
    const attachment: ChatAttachment = { path: 'attachment:avif', name: 'caps.avif', kind: 'file' };
    expect(sentAttachmentThumbnailSource({ attachment }, { getSource: () => avif })).toBe(avif);
  });
});

describe('SentAttachmentButton', () => {
  afterEach(() => __resetAttachmentPreviewCacheForTests());

  it('draws a cached image as a thumbnail that opens the preview', () => {
    cacheAttachmentPreviewSource({ path: IMAGE.path, file: new File(['png'], 'shot.png') });
    const urls = fakeObjectUrls();
    const onOpen = vi.fn();
    render(<SentAttachmentButton attachment={IMAGE} onOpen={onOpen} objectUrls={urls} />);

    const button = screen.getByRole('button', { name: 'Open shot.png' });
    expect(button).toHaveClass('jini-message-attachment-chip', 'is-thumbnail');
    expect(button.querySelector('img.jini-message-attachment-thumb')).toHaveAttribute('src', 'blob:fake-1');
    expect(button).not.toHaveTextContent('shot.png');

    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledWith(IMAGE);
  });

  it('keeps a pdf as a filename chip and makes no object URL for it', () => {
    cacheAttachmentPreviewSource({ path: PDF.path, file: new File(['pdf'], 'report.pdf') });
    const urls = fakeObjectUrls();
    render(<SentAttachmentButton attachment={PDF} onOpen={() => {}} objectUrls={urls} />);

    const button = screen.getByRole('button', { name: 'Open report.pdf' });
    expect(button).not.toHaveClass('is-thumbnail');
    expect(button).toHaveTextContent('report.pdf');
    expect(button.querySelector('img')).toBeNull();
    expect(urls.created).toHaveLength(0);
  });

  it('keeps an image whose bytes are not cached (a reload) as a filename chip', () => {
    const urls = fakeObjectUrls();
    render(<SentAttachmentButton attachment={IMAGE} onOpen={() => {}} objectUrls={urls} />);
    expect(screen.getByRole('button', { name: 'Open shot.png' })).toHaveTextContent('shot.png');
    expect(urls.created).toHaveLength(0);
  });

  it('falls back to the chip when the browser cannot decode the image, and revokes the URL', () => {
    cacheAttachmentPreviewSource({ path: IMAGE.path, file: new File(['not really png'], 'shot.png') });
    const urls = fakeObjectUrls();
    render(<SentAttachmentButton attachment={IMAGE} onOpen={() => {}} objectUrls={urls} />);

    const button = screen.getByRole('button', { name: 'Open shot.png' });
    act(() => {
      fireEvent.error(button.querySelector('img')!);
    });
    expect(button.querySelector('img')).toBeNull();
    expect(button).toHaveTextContent('shot.png');
    expect(urls.revoked).toEqual(['blob:fake-1']);
  });

  it('revokes the thumbnail URL on unmount', () => {
    cacheAttachmentPreviewSource({ path: IMAGE.path, file: new File(['png'], 'shot.png') });
    const urls = fakeObjectUrls();
    const { unmount } = render(<SentAttachmentButton attachment={IMAGE} onOpen={() => {}} objectUrls={urls} />);
    unmount();
    expect(urls.revoked).toEqual(['blob:fake-1']);
  });

  it('lets a host renderAttachment win and makes no thumbnail for it', () => {
    cacheAttachmentPreviewSource({ path: IMAGE.path, file: new File(['png'], 'shot.png') });
    const urls = fakeObjectUrls();
    render(
      <SentAttachmentButton attachment={IMAGE} onOpen={() => {}} objectUrls={urls}
        renderAttachment={(a) => <span data-testid="custom">{a.name.toUpperCase()}</span>} />,
    );
    expect(screen.getByTestId('custom')).toHaveTextContent('SHOT.PNG');
    expect(urls.created).toHaveLength(0);
  });
});

describe('MessageRow sent attachments', () => {
  afterEach(() => {
    // Thumbnail effects must release Blob URLs while the fake platform port is still installed.
    cleanup();
    __resetAttachmentPreviewCacheForTests();
    vi.unstubAllGlobals();
  });

  it('renders a sent image as a thumbnail and a sent pdf as a chip', () => {
    // jsdom has no Blob URLs; the row uses the platform port, so give the platform one.
    // A subclass, so anything else in the row that constructs a URL still can.
    vi.stubGlobal('URL', Object.assign(class extends URL {}, {
      createObjectURL: vi.fn(() => 'blob:row-thumb'),
      revokeObjectURL: vi.fn(),
    }));
    cacheAttachmentPreviewSource({ path: IMAGE.path, file: new File(['png'], 'shot.png') });
    cacheAttachmentPreviewSource({ path: PDF.path, file: new File(['pdf'], 'report.pdf') });
    const message: ChatMessage = { id: 'u-thumb', role: 'user', content: 'see attached', attachments: [IMAGE, PDF] };
    render(<MessageRow message={message} />);

    const image = screen.getByRole('button', { name: 'Open shot.png' });
    expect(image).toHaveClass('is-thumbnail');
    expect(image.querySelector('img')).toHaveAttribute('src', 'blob:row-thumb');
    const pdf = screen.getByRole('button', { name: 'Open report.pdf' });
    expect(pdf).not.toHaveClass('is-thumbnail');
    expect(pdf).toHaveTextContent('report.pdf');
  });
});
