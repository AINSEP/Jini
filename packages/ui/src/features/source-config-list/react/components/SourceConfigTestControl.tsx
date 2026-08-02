import { useT } from '../../../i18n/index.js';
import type { SourceTestResult } from '../../types.js';

export interface SourceConfigTestControlProps {
  /** `true` while a test request is in flight for this item. */
  running: boolean;
  /** The last test result for this item, if any has completed. */
  result?: SourceTestResult;
  disabled?: boolean;
  onTest: () => void;
}

/**
 * A generic per-item "test this source" control: a status line + a
 * Test/Retry button. Ported in spirit from `byok/ByokConnectionTestControl.tsx`
 * and `McpClientSection.tsx`'s `McpOAuthControl` status/action shape, but
 * deliberately simplified — the OAuth-specific postMessage/polling handshake
 * and the "ready to test" pre-flight hint are origin-source-specific UX, not
 * part of this generic primitive. See `packages/ui/source-map.md`.
 */
export function SourceConfigTestControl({ running, result, disabled = false, onTest }: SourceConfigTestControlProps) {
  const t = useT();
  return (
    <div className="source-config-test-control">
      <div className="source-config-test-control-status">
        {running ? (
          <span className="source-config-test-status is-running" role="status" aria-live="polite">
            {t('Testing…')}
          </span>
        ) : result ? (
          <span
            className={result.ok ? 'source-config-test-status is-success' : 'source-config-test-status is-error'}
            role={result.ok ? 'status' : 'alert'}
          >
            {result.message ?? (result.ok ? t('Connection ok.') : t('Connection failed.'))}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        className="source-config-test-button"
        onClick={onTest}
        disabled={disabled || running}
      >
        {running ? t('Testing…') : result && !result.ok ? t('Retry') : t('Test')}
      </button>
    </div>
  );
}
