import { useT } from '../../../i18n/index.js';
import { Icon } from '../../../../react/components/Icon.js';
import { useSnippetBlock } from './SnippetBlock.hooks.js';
import type { McpSnippetLanguage } from '../../types.js';

export interface SnippetBlockProps {
  snippet: string;
  language: McpSnippetLanguage;
  /** Shown in place of the snippet while it isn't ready yet (e.g. install
   *  info still loading). */
  placeholder?: string;
  copyAriaLabel?: string;
  copyLabel?: string;
  copiedLabel?: string;
  useTHook?: typeof useT;
  useSnippetBlockHook?: typeof useSnippetBlock;
}

/**
 * A read-only code block with a copy-to-clipboard button. Origin: the
 * `<pre>`/copy-button markup inline in `IntegrationsSection`.
 */
export function SnippetBlock({ snippet, language, placeholder, copyAriaLabel, copyLabel, copiedLabel, useTHook = useT, useSnippetBlockHook = useSnippetBlock }: SnippetBlockProps) {
  const t = useTHook();
  const { copied, onCopy } = useSnippetBlockHook({ snippet });

  const resolvedCopyLabel = copyLabel ?? t('Copy');
  const resolvedCopiedLabel = copiedLabel ?? t('Copied');

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
