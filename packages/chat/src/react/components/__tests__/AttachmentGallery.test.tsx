import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChatAttachment, ChatMessage } from '../../../core/index.js';
import {
  __resetAttachmentPreviewCacheForTests,
  cacheAttachmentPreviewSource,
} from '../../hooks/attachment-preview-cache.js';
import { attachmentGalleryFor, isOpaqueAttachmentName, stepGalleryIndex } from '../AttachmentGallery.rules.js';
import { galleryStepForKey } from '../AttachmentPreviewModal.hooks.js';
import { AttachmentTray } from '../AttachmentTray.js';
import { MessageRow } from '../MessageRow.js';
import type { ObjectUrlPort } from '../SentAttachment.hooks.js';

const ONE: ChatAttachment = { path: 'attachment:1', name: 'one.png', kind: 'image' };
const TWO: ChatAttachment = { path: 'attachment:2', name: 'two.png', kind: 'image' };
const THREE: ChatAttachment = { path: 'attachment:3', name: 'three.png', kind: 'image' };
const CSV: ChatAttachment = { path: 'attachment:csv', name: 'rows.csv', kind: 'file' };

function fakeObjectUrls(): ObjectUrlPort {
  let made = 0;
  return { create: () => `blob:fake-${(made += 1)}`, revoke: () => {} };
}

function previewTitle(): string | null {
  return document.querySelector('.jini-attachment-preview-name')?.textContent ?? null;
}

function dialog(): HTMLDialogElement {
  return screen.getByRole('dialog') as HTMLDialogElement;
}

describe('attachment gallery rules', () => {
  it('steps through the images only, positioned at the opened one', () => {
    expect(attachmentGalleryFor({ attachments: [ONE, CSV, TWO, THREE], opened: TWO })).toEqual({ items: [ONE, TWO, THREE], index: 1 });
  });

  it('opens a non-image, or an attachment not in the list, on its own', () => {
    expect(attachmentGalleryFor({ attachments: [ONE, CSV, TWO], opened: CSV })).toEqual({ items: [CSV], index: 0 });
    expect(attachmentGalleryFor({ attachments: [ONE], opened: TWO })).toEqual({ items: [TWO], index: 0 });
  });

  it('wraps past either end', () => {
    expect(stepGalleryIndex({ index: 0, count: 3, step: -1 })).toBe(2);
    expect(stepGalleryIndex({ index: 2, count: 3, step: 1 })).toBe(0);
    expect(stepGalleryIndex({ index: 1, count: 3, step: 1 })).toBe(2);
    expect(stepGalleryIndex({ index: 0, count: 0, step: 1 })).toBe(0);
  });

  it('maps the arrow keys and nothing else', () => {
    expect(galleryStepForKey({ key: 'ArrowLeft' })).toBe(-1);
    expect(galleryStepForKey({ key: 'ArrowRight' })).toBe(1);
    expect(galleryStepForKey({ key: 'Enter' })).toBe(0);
  });

  it('treats a bare content hash as an opaque name', () => {
    expect(isOpaqueAttachmentName({ name: 'b5aa983b7af337a54a4e23f8e0124c9d' })).toBe(true);
    expect(isOpaqueAttachmentName({ name: 'b5aa983b7af337a54a4e23f8e0124c9d.png' })).toBe(true);
    expect(isOpaqueAttachmentName({ name: 'checkout-screenshot.png' })).toBe(false);
    expect(isOpaqueAttachmentName({ name: 'deadbeef.png' })).toBe(false);
  });
});

describe('MessageRow image preview stepping', () => {
  afterEach(() => cleanup());

  const message: ChatMessage = { id: 'u-gallery', role: 'user', content: 'three shots', attachments: [ONE, CSV, TWO, THREE] };

  it('opens on click and wraps with previous/next', () => {
    render(<MessageRow message={message} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open two.png' }));
    expect(previewTitle()).toBe('two.png');
    expect(screen.getByText('2 / 3')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next image' }));
    expect(previewTitle()).toBe('three.png');
    fireEvent.click(screen.getByRole('button', { name: 'Next image' }));
    expect(previewTitle()).toBe('one.png');
    fireEvent.click(screen.getByRole('button', { name: 'Previous image' }));
    expect(previewTitle()).toBe('three.png');
    expect(screen.getByText('3 / 3')).toBeInTheDocument();
  });

  it('steps with the arrow keys and ignores other keys', () => {
    render(<MessageRow message={message} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open one.png' }));
    fireEvent.keyDown(dialog(), { key: 'ArrowLeft' });
    expect(previewTitle()).toBe('three.png');
    fireEvent.keyDown(dialog(), { key: 'ArrowRight' });
    expect(previewTitle()).toBe('one.png');
    fireEvent.keyDown(dialog(), { key: 'a' });
    expect(previewTitle()).toBe('one.png');
  });

  it('shows no previous/next for a lone image or a non-image', () => {
    render(<MessageRow message={{ id: 'u-one', role: 'user', content: 'one', attachments: [ONE, CSV] }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open one.png' }));
    expect(screen.queryByRole('button', { name: 'Next image' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Previous image' })).not.toBeInTheDocument();
    fireEvent.keyDown(dialog(), { key: 'ArrowRight' });
    expect(previewTitle()).toBe('one.png');
    cleanup();

    render(<MessageRow message={message} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open rows.csv' }));
    expect(screen.queryByRole('button', { name: 'Next image' })).not.toBeInTheDocument();
  });

  it('returns focus to the clicked thumbnail on close, even after stepping', () => {
    render(<MessageRow message={message} />);
    const opener = screen.getByRole('button', { name: 'Open two.png' });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole('button', { name: 'Next image' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('closes on the dialog\'s native cancel (Escape)', () => {
    render(<MessageRow message={message} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open one.png' }));
    fireEvent(dialog(), new Event('cancel', { cancelable: true }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('AttachmentTray staged chips', () => {
  afterEach(() => {
    cleanup();
    __resetAttachmentPreviewCacheForTests();
  });

  it('draws a staged image as a thumbnail and labels a hash-named one "Image"', () => {
    const hashed: ChatAttachment = { path: 'attachment:h', name: 'b5aa983b7af337a54a4e23f8e0124c9d', kind: 'image', size: 2_048 };
    cacheAttachmentPreviewSource({ path: ONE.path, file: new File(['png'], 'one.png') });
    cacheAttachmentPreviewSource({ path: hashed.path, file: new File(['png'], hashed.name) });
    render(<AttachmentTray attachments={[ONE, hashed, CSV]} onRemove={() => {}} objectUrls={fakeObjectUrls()} />);

    const one = screen.getByRole('button', { name: 'Open one.png' });
    expect(one.querySelector('img.jini-attachment-chip-thumb')).toHaveAttribute('src', 'blob:fake-1');
    expect(one).toHaveTextContent('one.png');

    const hashedChip = screen.getByRole('button', { name: `Open ${hashed.name}` });
    expect(hashedChip.querySelector('img.jini-attachment-chip-thumb')).toHaveAttribute('src', 'blob:fake-2');
    expect(hashedChip).toHaveTextContent('Image2 KB');

    const csv = screen.getByRole('button', { name: 'Open rows.csv' });
    expect(csv.querySelector('img')).toBeNull();
    expect(csv).toHaveTextContent('rows.csv');
  });

  it('opens the preview from a chip and steps through the staged images', () => {
    render(<AttachmentTray attachments={[ONE, CSV, TWO]} onRemove={() => {}} objectUrls={fakeObjectUrls()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open two.png' }));
    expect(previewTitle()).toBe('two.png');
    expect(screen.getByText('2 / 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next image' }));
    expect(previewTitle()).toBe('one.png');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
