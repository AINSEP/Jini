import { act, renderHook } from '@testing-library/react';
import type { ChangeEvent, DragEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { readMediaFile, useUploadButton } from '../hooks/UploadButton.hooks.js';
import type { UploadButtonProps } from '../hooks/UploadButton.hooks.js';
import type { UploadInput } from '../../models.js';

// A hand-written FileReader stand-in: the test decides when (and how) the read settles.
function fakeReader() {
  const reader = {
    result: null as string | null,
    onload: null as (() => void) | null,
    onerror: null as (() => void) | null,
    abort: vi.fn(),
    readAsDataURL: vi.fn(),
  };
  return { reader, createReader: () => reader as unknown as FileReader };
}

const file = (name: string, type = 'image/png') => new File(['bytes'], name, { type });
const input = (name: string): UploadInput => ({ filename: name, contentType: 'image/png', dataBase64: 'Ynl0ZXM=' });
const changeEvent = (files: File[] | null) => ({ currentTarget: { files } }) as unknown as ChangeEvent<HTMLInputElement>;
const dropEvent = (files: File[]) => ({ preventDefault: vi.fn(), dataTransfer: { files } }) as unknown as DragEvent & { preventDefault: ReturnType<typeof vi.fn> };

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('readMediaFile', () => {
  it('resolves the base64 payload after the data-URL comma with the file name and type', async () => {
    const { reader, createReader } = fakeReader();
    const read = readMediaFile({ file: file('a.png') }, { createReader });
    expect(reader.readAsDataURL).toHaveBeenCalledTimes(1);
    reader.result = 'data:image/png;base64,QUJD';
    reader.onload!();
    await expect(read).resolves.toEqual({ filename: 'a.png', contentType: 'image/png', dataBase64: 'QUJD' });
  });

  it('treats a null reader result as empty bytes', async () => {
    const { reader, createReader } = fakeReader();
    const read = readMediaFile({ file: file('a.png') }, { createReader });
    reader.onload!();
    await expect(read).resolves.toMatchObject({ dataBase64: '' });
  });

  it('reads through the platform FileReader by default', async () => {
    await expect(readMediaFile({ file: file('real.png') })).resolves.toEqual({ filename: 'real.png', contentType: 'image/png', dataBase64: 'Ynl0ZXM=' });
  });

  it('rejects on a read error and detaches its abort listener', async () => {
    const { reader, createReader } = fakeReader();
    const abort = new AbortController();
    const read = readMediaFile({ file: file('a.png') }, { signal: abort.signal, createReader });
    reader.onerror!();
    await expect(read).rejects.toThrow('Failed to read file');
    abort.abort();
    expect(reader.abort).not.toHaveBeenCalled();
  });

  it('detaches its abort listener after a successful read', async () => {
    const { reader, createReader } = fakeReader();
    const abort = new AbortController();
    const read = readMediaFile({ file: file('a.png') }, { signal: abort.signal, createReader });
    reader.onload!();
    await read;
    abort.abort();
    expect(reader.abort).not.toHaveBeenCalled();
  });

  it('aborts the in-flight read when the signal fires', async () => {
    const { reader, createReader } = fakeReader();
    const abort = new AbortController();
    const read = readMediaFile({ file: file('a.png') }, { signal: abort.signal, createReader });
    abort.abort();
    expect(reader.abort).toHaveBeenCalledTimes(1);
    await expect(read).rejects.toThrow('File read aborted');
  });

  it('refuses to start when the signal is already aborted', async () => {
    const { reader, createReader } = fakeReader();
    const abort = new AbortController();
    abort.abort();
    await expect(readMediaFile({ file: file('a.png') }, { signal: abort.signal, createReader })).rejects.toThrow();
    expect(reader.readAsDataURL).not.toHaveBeenCalled();
  });
});

function mount(props: Partial<UploadButtonProps> = {}, readFile = vi.fn(async ({ file }: { file: File }, _optional?: { signal?: AbortSignal }) => input(file.name))) {
  const upload = vi.fn<UploadButtonProps['upload']>(async () => true);
  const view = renderHook((p: Partial<UploadButtonProps>) => useUploadButton({ upload, ...p }, { readFile }), { initialProps: props });
  return { ...view, upload, readFile };
}

describe('useUploadButton', () => {
  it('exposes the upload toolbar defaults', () => {
    const { result } = mount();
    expect(result.current).toMatchObject({
      alt: '', withAlt: true, multiple: true, chooseLabel: 'Choose file', altLabel: 'Upload alt text',
      handles: { toolbar: 'media-upload-toolbar', file: 'media-upload-file', alt: 'media-upload-alt', submit: 'media-upload-submit' },
      selectedFileName: 'No file chosen', uploadDisabled: false, disabled: false, label: 'Upload', error: null, success: null,
    });
  });

  it('exposes the single-file replacement toolbar', () => {
    const { result } = mount({ label: 'Replace file', multiple: false, withAlt: false, disabled: true });
    expect(result.current).toMatchObject({
      withAlt: false, multiple: false, altLabel: 'Alt text', label: 'Replace file', uploadDisabled: true, disabled: true,
      handles: { toolbar: 'media-replace-toolbar', file: 'media-replace-file', alt: 'media-replace-alt', submit: 'media-replace-submit' },
    });
  });

  it('selects picked files, keeps only the first when single, and ignores picks while disabled', () => {
    const multi = mount();
    act(() => multi.result.current.onFile(changeEvent([file('a.png'), file('b.png')])));
    expect(multi.result.current.selectedFileName).toBe('a.png, b.png');
    act(() => multi.result.current.onFile(changeEvent(null)));
    expect(multi.result.current.selectedFileName).toBe('No file chosen');
    const single = mount({ multiple: false });
    act(() => single.result.current.onFile(changeEvent([file('a.png'), file('b.png')])));
    expect(single.result.current.selectedFileName).toBe('a.png');
    single.rerender({ multiple: false, disabled: true });
    act(() => single.result.current.onFile(changeEvent([file('c.png')])));
    expect(single.result.current.selectedFileName).toBe('a.png');
  });

  it('treats an empty selection as a no-op', async () => {
    const { result, upload } = mount();
    await act(async () => result.current.onUpload());
    expect(upload).not.toHaveBeenCalled();
    expect(result.current.success).toBeNull();
  });

  it('uploads with trimmed alt text, clears the alt and file input, and reports success', async () => {
    const { result, upload, readFile } = mount();
    const element = document.createElement('input');
    Object.defineProperty(element, 'value', { value: 'C:\\fakepath\\a.png', writable: true });
    (result.current.inputRef as { current: HTMLInputElement | null }).current = element;
    act(() => { result.current.onFile(changeEvent([file('a.png')])); result.current.setAlt({ value: '  A cat  ' }); });
    await act(async () => result.current.onUpload());
    expect(upload).toHaveBeenCalledWith({ input: input('a.png'), alt: 'A cat' });
    // The read is bound to the mount's lifetime so an unmount cancels it.
    expect(readFile.mock.calls[0]![1]).toEqual({ signal: expect.objectContaining({ aborted: false }) });
    expect(element.value).toBe('');
    expect(result.current).toMatchObject({ alt: '', success: 'Uploaded a.png', error: null, selectedFileName: 'No file chosen', disabled: false });
  });

  it('omits blank alt text and tolerates a detached file input', async () => {
    const { result, upload } = mount();
    act(() => { result.current.onFile(changeEvent([file('a.png')])); result.current.setAlt({ value: '   ' }); });
    await act(async () => result.current.onUpload());
    expect(upload).toHaveBeenCalledWith({ input: input('a.png') });
    expect(result.current.success).toBe('Uploaded a.png');
  });

  it('keeps the failed and unattempted files after a partial batch so a retry cannot duplicate successes', async () => {
    const { result, upload } = mount();
    upload.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    act(() => result.current.onFile(changeEvent([file('a.png'), file('b.png'), file('c.png')])));
    await act(async () => result.current.onUpload());
    expect(upload).toHaveBeenCalledTimes(2);
    expect(result.current).toMatchObject({ error: 'Upload failed for b.png', success: 'Uploaded a.png', selectedFileName: 'b.png, c.png' });
  });

  it('reports a generic message for a non-Error failure', async () => {
    const readFile = vi.fn(async () => { throw 'boom'; });
    const { result, upload } = mount({}, readFile);
    act(() => result.current.onFile(changeEvent([file('a.png')])));
    await act(async () => result.current.onUpload());
    expect(upload).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ error: 'Upload failed', success: null, selectedFileName: 'a.png' });
  });

  it('ignores new picks, uploads and drops while a batch is in flight', async () => {
    const read = deferred<UploadInput>();
    const readFile = vi.fn(() => read.promise);
    const { result, upload } = mount({}, readFile);
    act(() => result.current.onFile(changeEvent([file('a.png')])));
    act(() => result.current.onUpload());
    expect(result.current.disabled).toBe(true);
    act(() => { result.current.onUpload(); result.current.onFile(changeEvent([file('b.png')])); });
    const drop = dropEvent([file('c.png')]);
    act(() => result.current.onDrop(drop));
    expect(drop.preventDefault).toHaveBeenCalled();
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(result.current.selectedFileName).toBe('a.png');
    await act(async () => read.resolve(input('a.png')));
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('does not upload a selection once the host disables the toolbar', async () => {
    const { result, rerender, readFile } = mount();
    act(() => result.current.onFile(changeEvent([file('a.png')])));
    rerender({ disabled: true });
    await act(async () => result.current.onUpload());
    const drop = dropEvent([file('b.png')]);
    act(() => result.current.onDrop(drop));
    expect(drop.preventDefault).toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
  });

  it('uploads dropped files immediately, keeping only the first when single', async () => {
    const multi = mount();
    await act(async () => multi.result.current.onDrop(dropEvent([file('a.png'), file('b.png')])));
    expect(multi.upload).toHaveBeenCalledTimes(2);
    expect(multi.result.current.success).toBe('Uploaded a.png, b.png');
    const single = mount({ multiple: false });
    await act(async () => single.result.current.onDrop(dropEvent([file('a.png'), file('b.png')])));
    expect(single.upload).toHaveBeenCalledTimes(1);
  });

  it('prevents the default drag-over so the drop target accepts files', () => {
    const { result } = mount();
    const event = { preventDefault: vi.fn() } as unknown as DragEvent;
    result.current.onDragOver(event);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('opens the native picker through the attached input and is inert without one', () => {
    const { result } = mount();
    expect(() => result.current.onPress()).not.toThrow();
    const element = document.createElement('input');
    const click = vi.spyOn(element, 'click');
    (result.current.inputRef as { current: HTMLInputElement | null }).current = element;
    result.current.onPress();
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('drops a read that settles after unmount without uploading', async () => {
    const read = deferred<UploadInput>();
    const { result, upload, unmount } = mount({}, vi.fn(() => read.promise));
    act(() => result.current.onFile(changeEvent([file('a.png')])));
    act(() => result.current.onUpload());
    unmount();
    await act(async () => read.resolve(input('a.png')));
    expect(upload).not.toHaveBeenCalled();
  });

  it('stops the batch when unmounted while the upload is in flight', async () => {
    const sent = deferred<boolean>();
    const { result, upload, unmount, readFile } = mount();
    upload.mockReturnValueOnce(sent.promise);
    act(() => result.current.onFile(changeEvent([file('a.png'), file('b.png')])));
    act(() => result.current.onUpload());
    await act(async () => {});
    unmount();
    await act(async () => sent.resolve(true));
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('swallows a failure that lands after unmount', async () => {
    const read = deferred<UploadInput>();
    const { result, unmount } = mount({}, vi.fn(() => read.promise));
    act(() => result.current.onFile(changeEvent([file('a.png')])));
    act(() => result.current.onUpload());
    unmount();
    // React silently discards an update to an unmounted hook, so the rendered result cannot
    // show a late setError. The failure's message is read only to build that error, so an
    // unread message proves the hook dropped the failure instead of reporting it.
    const messageRead = vi.fn(() => 'late');
    const late = new Error();
    Object.defineProperty(late, 'message', { get: messageRead });
    await act(async () => read.reject(late));
    expect(messageRead).not.toHaveBeenCalled();
  });
});
