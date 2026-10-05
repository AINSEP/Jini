import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatAttachment } from '../../../core/index.js';
import {
  __resetAttachmentPreviewCacheForTests,
  cacheAttachmentPreviewSource,
} from '../../hooks/attachment-preview-cache.js';
import { readFileAsText, useAttachmentPreviewModal } from '../AttachmentPreviewModal.hooks.js';

// A real <dialog> is always mounted, as in AttachmentPreviewModal.tsx; only the text reader is a
// hand-written fake, injected through the hook's optional deps.
function Harness({ attachment, readText, open }: {
  attachment: ChatAttachment; readText?: (required: { file: File }) => Promise<string>; open?: boolean;
}) {
  const c = useAttachmentPreviewModal({ attachment, onClose: () => {} }, readText ? { readText } : {});
  return (
    <dialog ref={c.dialogRef} open={open} data-status={c.status} data-loading={String(c.textLoading)}>
      <pre>{c.text?.content ?? ''}</pre>
    </dialog>
  );
}
function deferred() {
  let resolve!: (value: string) => void, reject!: (error: unknown) => void;
  const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function cached(path: string, name: string): ChatAttachment {
  cacheAttachmentPreviewSource({ path, file: new File(['bytes'], name) });
  return { path, name, kind: 'file' };
}
const dialogOf = (container: HTMLElement) => container.querySelector('dialog')!;

afterEach(() => { cleanup(); __resetAttachmentPreviewCacheForTests(); });

describe('readFileAsText', () => {
  function fakeReader(result: unknown, error: DOMException | null = null) {
    const reader = {
      result, error, onload: null as null | (() => void), onerror: null as null | (() => void),
      readAsText: vi.fn(() => { queueMicrotask(() => (error || result === 'fail' ? reader.onerror : reader.onload)?.()); }),
    };
    return reader;
  }

  it('resolves an empty string when the reader produced no string', async () => {
    const reader = fakeReader(null);
    await expect(readFileAsText({ file: new File(['x'], 'a.txt') }, { createReader: () => reader as unknown as FileReader })).resolves.toBe('');
  });

  it('rejects with the reader error, or a named fallback when the reader has none', async () => {
    const failure = new DOMException('denied', 'NotReadableError');
    await expect(readFileAsText({ file: new File(['x'], 'a.txt') }, { createReader: () => fakeReader('', failure) as unknown as FileReader })).rejects.toBe(failure);
    await expect(readFileAsText({ file: new File(['x'], 'a.txt') }, { createReader: () => fakeReader('fail') as unknown as FileReader }))
      .rejects.toThrow('Failed to read attachment as text');
  });

  it('reads a real file through the platform reader by default', async () => {
    await expect(readFileAsText({ file: new File(['hello'], 'a.txt') })).resolves.toBe('hello');
  });
});

describe('useAttachmentPreviewModal', () => {
  it('treats a cached file without an extension as unsupported', () => {
    const { container } = render(<Harness attachment={cached('a:1', 'README')} />);
    expect(dialogOf(container).dataset.status).toBe('unsupported');
  });

  it('ignores a late read from the previous attachment after switching', async () => {
    const first = deferred(), second = deferred();
    const readText = vi.fn(({ file }: { file: File }) => (file.name === 'one.txt' ? first.promise : second.promise));
    const one = cached('a:1', 'one.txt'), two = cached('a:2', 'two.txt');
    const { container, rerender } = render(<Harness attachment={one} readText={readText} />);
    rerender(<Harness attachment={two} readText={readText} />);
    await act(async () => { second.resolve('second'); });
    await act(async () => { first.resolve('first'); });
    expect(dialogOf(container).textContent).toBe('second');
    expect(dialogOf(container).dataset.loading).toBe('false');
  });

  it('ignores a late failure from the previous attachment after switching', async () => {
    const first = deferred(), second = deferred();
    const readText = vi.fn(({ file }: { file: File }) => (file.name === 'one.txt' ? first.promise : second.promise));
    const one = cached('a:1', 'one.txt'), two = cached('a:2', 'two.txt');
    const { container, rerender } = render(<Harness attachment={one} readText={readText} />);
    rerender(<Harness attachment={two} readText={readText} />);
    await act(async () => { second.resolve('second'); });
    await act(async () => { first.reject(new Error('stale')); });
    expect(dialogOf(container).textContent).toBe('second');
  });

  it('a failed read leaves no text and stops loading', async () => {
    const read = deferred();
    const { container } = render(<Harness attachment={cached('a:1', 'notes.md')} readText={() => read.promise} />);
    expect(dialogOf(container).dataset.loading).toBe('true');
    await act(async () => { read.reject(new Error('undecodable')); });
    expect(dialogOf(container).textContent).toBe('');
    expect(dialogOf(container).dataset.loading).toBe('false');
  });

  describe('in a browser with the modal dialog API', () => {
    function withModalApi() {
      const showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', ''); });
      const close = vi.fn(function (this: HTMLDialogElement) { this.removeAttribute('open'); });
      Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: showModal });
      Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: close });
      return { showModal, close, restore() {
        delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal;
        delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).close;
      } };
    }

    it('opens with showModal on mount and closes with close on unmount', () => {
      const api = withModalApi();
      try {
        const { unmount } = render(<Harness attachment={{ path: 'a:9', name: 'x.zip', kind: 'file' }} />);
        expect(api.showModal).toHaveBeenCalledTimes(1);
        unmount();
        expect(api.close).toHaveBeenCalledTimes(1);
      } finally { api.restore(); }
    });

    it('keeps the dialog open across re-renders: the ref is stable, so React never detaches it', () => {
      const api = withModalApi();
      try {
        const attachment: ChatAttachment = { path: 'a:9', name: 'x.zip', kind: 'file' };
        const { rerender } = render(<Harness attachment={attachment} />);
        rerender(<Harness attachment={{ ...attachment }} />);
        expect(api.showModal).toHaveBeenCalledTimes(1);
        expect(api.close).not.toHaveBeenCalled();
      } finally { api.restore(); }
    });

    it('does not reopen an open dialog or close one the browser already closed', () => {
      const api = withModalApi();
      try {
        const { container, unmount } = render(<Harness attachment={{ path: 'a:9', name: 'x.zip', kind: 'file' }} open />);
        expect(api.showModal).not.toHaveBeenCalled();
        dialogOf(container).removeAttribute('open');
        unmount();
        expect(api.close).not.toHaveBeenCalled();
      } finally { api.restore(); }
    });
  });
});
