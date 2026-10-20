import { useT } from '../../../i18n/index.js';
import { sourceConfigAgentProps } from '../../agent-handles.js';
import type { SourceTestResult } from '../../types.js';

export interface SourceConfigTestControlProps {
  /** `true` while a test request is in flight for this item. */
  running: boolean;
  /** The last test result for this item, if any has completed. */
  result?: SourceTestResult;
  disabled?: boolean;
  /**
   * This control's own agent handle — publishes the Test/Retry button as
   * `<agentHandle>` and the status line as `<agentHandle>-status`. A plain
   * string, not a per-element map: the caller names the control, this
   * component names its own parts. Omit and no `data-agent-*` markup is
   * emitted at all. See `../../agent-handles.ts` for the full scheme.
   */
  agentHandle?: string;
  onTest: () => void;
}

/**
 * A generic per-item "test this source" control: a status line + a
 * Test/Retry button. Ported in spirit from `byok/ByokConnectionTestControl.tsx`
 * and `McpClientSection.tsx`'s `McpOAuthControl` status/action shape, but
 * deliberately simplified — the OAuth-specific postMessage/polling handshake
 * and the "ready to test" pre-flight hint are origin-source-specific UX, not
 * part of this generic primitive. See `packages/ui/source-map.md`.
 *
 * ## Agent handles
 *
 * Given `agentHandle="mcp-add-test"`: the button is `mcp-add-test` (role
 * `button`) and the status line is `mcp-add-test-status` (role `status`).
 * The status handle sits on the always-rendered wrapper rather than on the
 * message span, so a caller can read the result of its own click through one
 * stable handle instead of one that only exists once there is something to
 * say.
 */
export function SourceConfigTestControl({ running, result, disabled = false, agentHandle, onTest }: SourceConfigTestControlProps) {
  const t = useT();
  return (
    <div className="source-config-test-control">
      <div
        className="source-config-test-control-status"
        {...sourceConfigAgentProps(agentHandle, {
          role: 'status',
          label: t('Connection test result'),
          action: 'status',
        })}
      >
        <TestStatusMessage running={running} result={result} />
      </div>
      <button
        type="button"
        className="source-config-test-button"
        {...sourceConfigAgentProps(agentHandle, { role: 'button', label: t('Test connection') })}
        onClick={onTest}
        disabled={disabled || running}
      >
        {testButtonLabel({ running, t }, { result })}
      </button>
    </div>
  );
}

type Translate = ReturnType<typeof useT>;

/** The status line's content: "Testing…" while running, the last result once one exists, nothing before the first test. */
function TestStatusMessage({ running, result }: { running: boolean; result?: SourceTestResult | undefined }) {
  const t = useT();
  if (running) {
    return (
      <span className="source-config-test-status is-running" role="status" aria-live="polite">
        {t('Testing…')}
      </span>
    );
  }
  if (!result) return null;
  return (
    <span
      className={result.ok ? 'source-config-test-status is-success' : 'source-config-test-status is-error'}
      role={result.ok ? 'status' : 'alert'}
    >
      {result.message ?? (result.ok ? t('Connection ok.') : t('Connection failed.'))}
    </span>
  );
}

/** "Testing…" while running, "Retry" after a failed result, otherwise "Test". */
function testButtonLabel({ running, t }: { running: boolean; t: Translate }, { result }: { result?: SourceTestResult | undefined }): string {
  if (running) return t('Testing…');
  return result && !result.ok ? t('Retry') : t('Test');
}
