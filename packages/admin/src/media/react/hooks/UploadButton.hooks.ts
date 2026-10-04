import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import type { UploadInput } from '../../models.js';
export interface UploadButtonProps {
  readonly upload: (
    required: { input: UploadInput; alt?: string },
    optional?: Record<string, never>,
  ) => Promise<boolean>;
  readonly disabled?: boolean;
  readonly label?: string;
  readonly multiple?: boolean;
  /** Replacement keeps the asset's metadata, so its toolbar has no alt input to fill. */
  readonly withAlt?: boolean;
}
/** Reads a browser File at the React boundary; headless controllers only receive bytes. */
export function readMediaFile(
  { file }: { file: File },
  { signal }: { signal?: AbortSignal } = {},
): Promise<UploadInput> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const reader = new FileReader();
    const abort = () => {
      reader.abort();
      reject(new Error('File read aborted'));
    };
    const cleanup = () => signal?.removeEventListener('abort', abort);
    signal?.addEventListener('abort', abort, { once: true });
    reader.onerror = () => {
      cleanup();
      reject(new Error('Failed to read file'));
    };
    reader.onload = () => {
      cleanup();
      const value = String(reader.result ?? '');
      resolve({
        filename: file.name,
        contentType: file.type,
        dataBase64: value.slice(value.indexOf(',') + 1),
      });
    };
    reader.readAsDataURL(file);
  });
}
export function useUploadButton(props: UploadButtonProps, _optional: Record<string, never> = {}) {
  // Advisory picker formats mirror the host's standard ceiling, including video. The
  // injected server still validates/sniffs bytes; a file picker is never a security boundary.
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedFiles, setSelectedFiles] = useState<readonly File[]>([]);
  const [alt, setAlt] = useState(''), [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null), [success, setSuccess] = useState<string | null>(null);
  const inFlight = useRef(false), lifetime = useRef<AbortController | null>(null);
  useEffect(() => {
    const abort = new AbortController(); lifetime.current = abort;
    return () => abort.abort();
  }, []);
  function onFile(event: ChangeEvent<HTMLInputElement>) {
    if (!inFlight.current && !props.disabled) {
      setSelectedFiles(Array.from(event.currentTarget.files ?? []).slice(0, props.multiple === false ? 1 : undefined)); setError(null); setSuccess(null);
    }
  }
  async function uploadFiles(files: readonly File[]) {
    if (!files.length || inFlight.current || props.disabled) return;
    const signal = lifetime.current?.signal;
    inFlight.current = true; setBusy(true); setError(null); setSuccess(null);
    const uploaded: string[] = [];
    let remaining = [...files];
    try {
      for (const file of files) {
        const input = await readMediaFile({ file }, signal ? { signal } : {});
        if (signal?.aborted) return;
        if (!await props.upload({ input, ...(alt.trim() ? { alt: alt.trim() } : {}) }))
          throw new Error(`Upload failed for ${file.name}`);
        if (signal?.aborted) return;
        uploaded.push(file.name); remaining = remaining.slice(1);
      }
      setAlt('');
      if (inputRef.current) inputRef.current.value = '';
    } catch (error) {
      if (!signal?.aborted) setError(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      inFlight.current = false;
      if (!signal?.aborted) {
        // Keep only failed/unattempted files: retry must not duplicate successes in a batch.
        setSelectedFiles(remaining); setBusy(false);
        if (uploaded.length) setSuccess(`Uploaded ${uploaded.join(', ')}`);
      }
    }
  }
  return {
    alt,
    withAlt: props.withAlt !== false,
    multiple: props.multiple !== false,
    chooseLabel: 'Choose file',
    altLabel: props.multiple === false ? 'Alt text' : 'Upload alt text',
    handles: props.label === 'Replace file'
      ? { toolbar: 'media-replace-toolbar', file: 'media-replace-file', alt: 'media-replace-alt', submit: 'media-replace-submit' }
      : { toolbar: 'media-upload-toolbar', file: 'media-upload-file', alt: 'media-upload-alt', submit: 'media-upload-submit' },
    selectedFileName: selectedFiles.map(file => file.name).join(', ') || 'No file chosen',
    onUpload: () => { void uploadFiles(selectedFiles); },
    onDragOver: (event: DragEvent) => { event.preventDefault(); },
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      if (inFlight.current || props.disabled) return;
      const files = Array.from(event.dataTransfer.files).slice(0, props.multiple === false ? 1 : undefined); setSelectedFiles(files); void uploadFiles(files);
    },
    // An empty selection is a no-op, as on the original toolbar; Upload stays enabled.
    uploadDisabled: busy || props.disabled === true,
    setAlt: ({ value }: { value: string }) => setAlt(value),
    inputRef, onFile, error, success,
    disabled: busy || props.disabled === true,
    onPress: () => inputRef.current?.click(),
    label: props.label ?? 'Upload',
  };
}
