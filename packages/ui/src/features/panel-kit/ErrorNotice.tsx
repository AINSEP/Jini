import { useState } from 'react';
import type { UserFacingError } from '@jini-ai/core';
import { copyToClipboard, type CopyToClipboardOptions } from '../../utils/copy-to-clipboard.js';
import type { Translate } from '../i18n/index.js';

/** A formatted failure, optional host translation, and injectable clipboard ports. */
export interface ErrorNoticeProps extends CopyToClipboardOptions {
  readonly failure: UserFacingError;
  readonly t?: Translate;
  readonly className?: string;
  /** History surfaces use polite announcements; active form failures keep the alert default. */
  readonly role?: "alert" | "status";
}

/**
 * Disclose exactly the formatted copy block in native, selectable details. Copying has no recovery effects.
 * Failed writes leave the details available for manual copying; feedback resets with the incident.
 * @complexity O(copyText length) per render/copy; one clipboard write plus the existing fallback on rejection.
 */
export function ErrorNotice({ failure, t = text => text, className = 'notice error', role = 'alert', ...ports }: ErrorNoticeProps) {
  const [feedback, setFeedback] = useState<{ text: string; copied: boolean } | null>(null);
  async function copy() {
    const copied = await copyToClipboard({ text: failure.copyText }, ports);
    setFeedback({ text: failure.copyText, copied });
  }
  return (
    <div className={className} role={role}>
      <p>{failure.message}</p>
      <p>{failure.action}</p>
      <details>
        <summary>{t('Show details')}</summary>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', userSelect: 'text' }}>{failure.copyText}</pre>
        <button type="button" onClick={() => void copy()}>{t('Copy details')}</button>
        {feedback && feedback.text === failure.copyText ? <p role="status">{t(feedback.copied ? 'Copied' : 'Copy failed. Select the details and copy them manually.')}</p> : null}
      </details>
    </div>
  );
}
