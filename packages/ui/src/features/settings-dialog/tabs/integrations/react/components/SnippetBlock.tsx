import { useEffect, useRef, useState } from 'react';
import { useT } from '../../../../../../features/i18n/index.js';
import { Icon } from '../../../../../../react/components/Icon.js';
import { copyToClipboard } from '../../../../../../utils/copy-to-clipboard.js';
import type { McpSnippetLanguage } from '@jini-ai/ui-core';

export interface SnippetBlockProps {
  snippet: string;
  language: McpSnippetLanguage;
  /** Shown in place of the snippet while it isn't ready yet (e.g. install
   *  info still loading). */
  placeholder?: string;
  copyAriaLabel?: string;
  copyLabel?: string;
  copiedLabel?: string;
}

/**
 * A read-only code block with a copy-to-clipboard button. Origin: the
 * `<pre>`/copy-button markup inline in `IntegrationsSection`.
 */
export function SnippetBlock({ snippet, language, placeholder, copyAriaLabel, copyLabel, copiedLabel }: SnippetBlockProps) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Reset the "Copied" badge whenever the snippet changes (e.g. the user
  // switched clients) — otherwise a stale green check sits next to a
  // snippet they haven't actually copied.
  useEffect(() => {
    setCopied(false);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, [snippet]);

  const resolvedCopyLabel = copyLabel ?? t('Copy');
  const resolvedCopiedLabel = copiedLabel ?? t('Copied');

  // No `if (!snippet) return` guard here (the origin has one — see
  // `onCopy` inline in `IntegrationsSection`): the only caller is the copy
  // button below, which is already `disabled={!snippet}`, and a disabled
  // button never receives a click event at all (browsers don't dispatch
  // one, and jsdom matches — verified `fireEvent.click` on a disabled
  // button doesn't invoke its handler either). The origin's guard was a
  // dead duplicate of that same disablement; removed rather than carried
  // forward or tested around.
  async function onCopy() {
    const ok = await copyToClipboard(snippet);
    if (!ok) return;
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="jini-snippet-block">
      <pre className="jini-snippet-pre" data-lang={language}>
        <code className="jini-snippet-code">{snippet || placeholder || ''}</code>
      </pre>
      <button
        type="button"
        className="jini-button jini-button-ghost jini-snippet-copy-btn"
        onClick={() => {
          void onCopy();
        }}
        disabled={!snippet}
        title={copyAriaLabel ?? t('Copy to clipboard')}
      >
        <Icon name={copied ? 'check' : 'copy'} size={14} />
        <span>{copied ? resolvedCopiedLabel : resolvedCopyLabel}</span>
      </button>
    </div>
  );
}
