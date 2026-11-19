import type { ReactNode } from 'react';
import type { TypedAnswerNotice } from '../types.js';
import { describeAttachmentError, describeTypedAnswerNotice } from '../rules.js';

/**
 * The `unavailable` banner's copy and, where reachable, its actual fix — distinguishing three
 * CLI-less states so a pointer at BYOK is never shown as an option that would not actually help:
 *
 * - `executionMode === 'local'` with BYOK available: switching mode is a real fix. When the host
 *   wired `onExecutionModeChange` (the same callback the runtime picker's own mode buttons already
 *   call — see `AgentRuntimePicker.tsx`), this renders as a button that performs the switch
 *   directly rather than prose telling the operator to go hunting for the control themselves. A
 *   host that reports `apiModeAvailable` without wiring the callback still gets an honest, if
 *   inert, pointer as plain copy.
 * - `executionMode === 'local'` with BYOK NOT available: switching would not help — offering it
 *   anyway would be a lie — so this falls back to the original, unconditional message.
 * - `executionMode === 'api'` already: the operator is already on the one path that could work,
 *   so a "switch to BYOK" pointer would be nonsensical here; whatever is still missing (e.g. no
 *   model chosen) is `RuntimeByokDetails`' own job to explain inside the runtime picker, not this
 *   banner's.
 */
function ChatPaneNoUsableCliMessage({
  executionMode,
  apiModeAvailable,
  onExecutionModeChange,
  t,
}: {
  executionMode: 'local' | 'api';
  apiModeAvailable: boolean;
  onExecutionModeChange: ((mode: 'local' | 'api') => void) | undefined;
  t: (key: string) => string;
}): ReactNode {
  const byokIsARealFix = executionMode === 'local' && apiModeAvailable;
  if (!byokIsARealFix) {
    return <div className="jini-chat-pane__error" role="alert">{t('No usable CLI is selected.')}</div>;
  }
  if (!onExecutionModeChange) {
    return (
      <div className="jini-chat-pane__error" role="alert">
        {t('No usable CLI is selected — switch to BYOK to use your own API key.')}
      </div>
    );
  }
  return (
    <div className="jini-chat-pane__error" role="alert">
      {t('No usable CLI is selected.')}{' '}
      <button
        type="button"
        className="jini-chat-pane__error-action"
        onClick={() => onExecutionModeChange('api')}
      >
        {t('Switch to BYOK')}
      </button>
    </div>
  );
}

interface ChatPaneAvailabilityStatusProps {
  unavailable: boolean;
  scanningAgents: boolean;
  connectingAgents: boolean;
  executionMode: 'local' | 'api';
  apiModeAvailable: boolean;
  onExecutionModeChange: ((mode: 'local' | 'api') => void) | undefined;
  t: (key: string) => string;
}

/**
 * `unavailable` alone conflates "inventory still loading" with "inventory loaded, nothing
 * usable" — both present as `selectedAgent === undefined`. `scanningAgents` is the signal
 * that tells them apart, mirroring the `workingDirectoryPending`/`workingDirectoryInvalid`
 * pair below: a pending detection is a `status`, only a *finished* detection that found
 * nothing is an `alert`. `connectingAgents` is a third state: the inventory could not be
 * read at all (the host is unreachable, typically a daemon restart) and a retry is
 * pending — a plain status too, never "No usable CLI", which only a SUCCESSFUL answer can
 * establish.
 */
function ChatPaneAvailabilityStatus({
  unavailable,
  scanningAgents,
  connectingAgents,
  executionMode,
  apiModeAvailable,
  onExecutionModeChange,
  t,
}: ChatPaneAvailabilityStatusProps): ReactNode {
  if (!unavailable) return null;
  if (connectingAgents) {
    return (
      <div className="jini-chat-pane__status" role="status">
        {t('Connecting to the assistant…')}
      </div>
    );
  }
  if (scanningAgents) {
    return (
      <div className="jini-chat-pane__status" role="status">
        {t('Loading available CLIs')}
      </div>
    );
  }
  return (
    <ChatPaneNoUsableCliMessage
      executionMode={executionMode}
      apiModeAvailable={apiModeAvailable}
      onExecutionModeChange={onExecutionModeChange}
      t={t}
    />
  );
}

function ChatPaneWorkingDirectoryStatus({
  workingDirectoryPending,
  workingDirectoryInvalid,
  t,
}: {
  workingDirectoryPending: boolean;
  workingDirectoryInvalid: boolean;
  t: (key: string) => string;
}): ReactNode {
  if (workingDirectoryPending) {
    return (
      <div className="jini-chat-pane__status" role="status">
        {t('Checking working directory…')}
      </div>
    );
  }
  if (!workingDirectoryInvalid) return null;
  return (
    <div className="jini-chat-pane__error" role="alert">
      {t('Working directory is unavailable.')}
    </div>
  );
}

/**
 * The typed-answer delivery notice. Only `'failed'` ever reaches it: `useChatPane` queues a
 * `'not-pending'` refusal as one ordinary message itself (`answerWaitingQuestion`), without a notice.
 *
 * MOVE (from the retired "Send as a new message" button this notice once rendered for
 * `'not-pending'`): the held answer's only way into a new run besides clearing the draft — an
 * explicit choice, so a closed question never turns an answer into a paid run on a second Enter.
 * The hook's automatic one-time fallback now owns that guarantee, which left the button unreachable.
 */
function ChatPaneTypedAnswerNotice({
  typedAnswerNotice,
  t,
}: {
  typedAnswerNotice: TypedAnswerNotice | null;
  t: (key: string) => string;
}): ReactNode {
  if (!typedAnswerNotice) return null;
  return (
    <div className="jini-chat-pane__error" role="alert">
      {t(describeTypedAnswerNotice({ notice: typedAnswerNotice }))}
    </div>
  );
}

/** A failed upload, in plain words, with redacted details a person can copy into a report. */
function ChatPaneAttachmentError({ error, t }: { error: Error; t: (key: string) => string }): ReactNode {
  const { summary, details } = describeAttachmentError({ error });
  return (
    <div className="jini-chat-pane__error" role="alert">
      <div>{t(summary)}</div>
      {details ? <div className="jini-chat-pane__error-details">{t('Details:')} {details}</div> : null}
    </div>
  );
}

/** A send the server never accepted. Its text went back into the composer if that was still empty;
 * Retry sends it again either way (see `useChatPane`'s `retrySend`). */
function ChatPaneSendError({ sendError, onRetry, t }: { sendError: Error | null; onRetry: () => void; t: (key: string) => string }): ReactNode {
  if (!sendError) return null;
  return (
    <div className="jini-chat-pane__error" role="alert">
      {t('Not sent:')} {sendError.message}{' '}
      <button type="button" className="jini-chat-pane__error-action" onClick={onRetry}>{t('Retry')}</button>
    </div>
  );
}

interface ChatPaneStatusMessagesProps extends ChatPaneAvailabilityStatusProps {
  sendError: Error | null;
  onRetrySend: () => void;
  attachmentError: Error | null;
  dropReadError: string | null;
  workingDirectoryError: Error | null;
  workingDirectoryPending: boolean;
  workingDirectoryInvalid: boolean;
  runtimeInventoryError: Error | null;
  typedAnswerNotice: TypedAnswerNotice | null;
}

/** The pane's stack of mutually-independent error/status banners — each condition is its own
 * source of truth, so they are rendered as siblings rather than folded into one derived state. */
export function ChatPaneStatusMessages({
  sendError,
  onRetrySend,
  attachmentError,
  dropReadError,
  workingDirectoryError,
  workingDirectoryPending,
  workingDirectoryInvalid,
  runtimeInventoryError,
  typedAnswerNotice,
  ...availability
}: ChatPaneStatusMessagesProps): ReactNode {
  const { t } = availability;
  return (
    <>
      <ChatPaneAvailabilityStatus {...availability} />
      <ChatPaneSendError sendError={sendError} onRetry={onRetrySend} t={t} />
      {/* Run failures render once on their assistant message; pane banners remain for
          attachment, working-directory and other errors that have no message binding. */}
      {attachmentError ? <ChatPaneAttachmentError error={attachmentError} t={t} /> : null}
      {dropReadError ? (
        <div className="jini-chat-pane__error" role="alert">{dropReadError}</div>
      ) : null}
      {workingDirectoryError ? (
        <div className="jini-chat-pane__error" role="alert">{workingDirectoryError.message}</div>
      ) : null}
      <ChatPaneWorkingDirectoryStatus
        workingDirectoryPending={workingDirectoryPending}
        workingDirectoryInvalid={workingDirectoryInvalid}
        t={t}
      />
      {/* While connecting, the transport error is transient noise the retry is already handling. */}
      {runtimeInventoryError && !availability.connectingAgents ? (
        <div className="jini-chat-pane__error" role="alert">
          {runtimeInventoryError.message}
        </div>
      ) : null}
      <ChatPaneTypedAnswerNotice typedAnswerNotice={typedAnswerNotice} t={t} />
    </>
  );
}

