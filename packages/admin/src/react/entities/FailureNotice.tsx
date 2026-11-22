import { useState, type ReactNode } from 'react';
import type { EntityTranslate } from './types.js';

/** What the host says about a failed save or delete. `action: 'reload'` offers to read the row again. */
export interface EntityFailureView {
  readonly message: string;
  /** Technical text a person can copy into a report; never shown as the message. */
  readonly details: string;
  readonly action?: 'reload';
}

type CopyState = 'idle' | 'copied' | 'failed';

/** The default words: a plain sentence, with the error itself kept in `details`. */
export function describeEntityFailure(
  { error, translate }: { readonly error: unknown; readonly translate: EntityTranslate },
): EntityFailureView {
  return { message: translate({ key: 'Operation failed' }), details: errorDetails({ error }) };
}

function errorDetails({ error }: { readonly error: unknown }): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

/** The browser clipboard; a host or test passes its own through `copyText`. */
export function copyToClipboard({ text }: { readonly text: string }): Promise<void> {
  return navigator.clipboard.writeText(text);
}

/** An inline alert: plain words, the technical details to copy, and the way forward (Reload or Try again). */
export function FailureNotice({ view, translate, onReload, onRetry, copyText }: {
  readonly view: EntityFailureView;
  readonly translate: EntityTranslate;
  readonly onReload: () => void;
  readonly onRetry: () => void;
  readonly copyText: (required: { readonly text: string }) => Promise<void>;
}): ReactNode {
  const [copy, setCopy] = useState<CopyState>('idle');
  const copyDetails = (): void => {
    copyText({ text: view.details }).then(() => setCopy('copied'), () => setCopy('failed'));
  };
  return <div role="alert">
    <p>{view.message}</p>
    <details><summary>{translate({ key: 'Details' })}</summary><pre>{view.details}</pre></details>
    <button type="button" onClick={copyDetails}>{translate({ key: 'Copy details' })}</button>
    {view.action === 'reload'
      ? <button type="button" onClick={onReload}>{translate({ key: 'Reload' })}</button>
      : <button type="button" onClick={onRetry}>{translate({ key: 'Try again' })}</button>}
    {copy === 'copied' ? <span role="status">{translate({ key: 'Copied' })}</span> : null}
    {copy === 'failed' ? <span role="status">{translate({ key: 'Could not copy details' })}</span> : null}
  </div>;
}
