import { useId, type ReactNode } from 'react';
import { WorkingDirPicker } from '@jini-ai/ui';
import { Composer } from '../../../components/Composer.js';
import { Icon } from '../../../components/Icon.js';
import type { ComposerSlots } from '../../../slots.js';
import { definedProps } from '../../../util/defined-props.js';
import type { ChatPaneProps, ChatPaneWorkingDirectoryAccess } from '../types.js';
import type { UseChatPaneResult } from '../hooks/useChatPane.hooks.js';
import type { ChatPaneFileDropTargetProps, UseChatPaneFileDropResult } from '../hooks/useChatPaneFileDrop.hooks.js';
import { chatPaneSendBlockerNeedsNotice, describeChatPaneSendBlocker } from '../rules.js';
type WorkingDirectoryControlPlacement = 'below' | 'composer' | 'none';

interface ChatPaneWorkingDirectoryBlockProps {
  workingDirectoryAccess: ChatPaneWorkingDirectoryAccess | undefined;
  workingDirectoryControlPlacement: WorkingDirectoryControlPlacement;
  pane: UseChatPaneResult;
  t: (key: string) => string;
}

function ChatPaneWorkingDirectoryBlock({
  workingDirectoryAccess,
  workingDirectoryControlPlacement,
  pane,
  t,
}: ChatPaneWorkingDirectoryBlockProps): ReactNode {
  if (workingDirectoryAccess && workingDirectoryControlPlacement === 'below') {
    return (
      <div className="jini-chat-pane__workdir">
        <WorkingDirPicker
          workingDir={pane.workingDirectory}
          recentDirs={[...pane.recentDirectories]}
          onPickDirectory={() => void pane.pickWorkingDirectory()}
          onSelectRecent={(directory) => void pane.selectRecentDirectory(directory)}
          placement="up"
          onClear={pane.clearWorkingDirectory}
          invalid={pane.workingDirectoryInvalid}
          onOpen={() => void pane.openWorkingDirectoryPicker()}
          labels={{ trigger: t('Select working directory') }}
        />
      </div>
    );
  }
  // Three cases render nothing here, for different reasons:
  // - No native `workingDirectoryAccess`: the static text line this replaced is gone entirely —
  //   see `ChatPaneComposerArea` below, which threads `pane.workingDirectory` and
  //   `pane.selectRecentDirectory` into `Composer`'s own folder-icon (popover) trigger instead.
  // - `workingDirectoryAccess` present but `workingDirectoryControlPlacement === 'composer'`: the
  //   host asked for the control next to "+" instead — `resolveComposerWorkingDirectory` wires
  //   `Composer`'s trigger straight to `pane.pickWorkingDirectory` in that case, so rendering this
  //   block too would put up a second, competing control below the composer.
  // - `workingDirectoryControlPlacement === 'none'`: the host asked for no working-directory
  //   control anywhere — `resolveComposerWorkingDirectory` supplies neither composer handler in
  //   this case either, so `Composer`'s own folder-icon gate (`onChangeWorkingDirectory ||
  //   onPickWorkingDirectory`) renders nothing too. Nothing here has a trigger to defer to.
  // In every case but `'none'`, the trigger this defers to already covers both "nothing set yet"
  // and "a value is set", so this block has nothing left to render.
  return null;
}

/** `uploadAttachments === undefined` gates BOTH of these — a temporarily-disabled composer still
 * consumes a file drop so the browser cannot navigate away to the local file (see
 * `useChatPaneFileDrop`'s module doc), so the drop handlers stay attached even when the picker
 * itself is hidden. Shared here so `ChatPaneComposerArea` pays for the branch once, at module
 * scope, instead of per call site. */
function resolveDropTargetProps(
  uploadAttachments: ChatPaneProps['uploadAttachments'],
  fileDrop: UseChatPaneFileDropResult,
): ChatPaneFileDropTargetProps | Record<string, never> {
  return uploadAttachments === undefined ? {} : fileDrop.targetProps;
}

function resolveComposerAttachmentPicker(
  uploadAttachments: ChatPaneProps['uploadAttachments'],
  pane: UseChatPaneResult,
  attachmentAccept: ChatPaneProps['attachmentAccept'],
): { attachmentPicker?: { onFiles: (files: File[]) => void; uploading: boolean; accept?: string } } {
  if (uploadAttachments === undefined) return {};
  return {
    attachmentPicker: definedProps({ source: {
      onFiles: pane.addAttachments,
      uploading: pane.isUploadingAttachments,
      accept: attachmentAccept,
    } }),
  };
}

/**
 * Resolves which of `Composer`'s two mutually-exclusive working-directory props (if either) this
 * render should supply, mirroring `ChatPaneWorkingDirectoryBlock`'s own four-way branch above so
 * the two never disagree about which control owns the composer's folder-icon slot:
 *
 * - `workingDirectoryControlPlacement === 'none'`: neither prop, regardless of whether
 *   `workingDirectoryAccess` is present — the host asked for no working-directory control
 *   anywhere, so `Composer`'s own gate (`onChangeWorkingDirectory || onPickWorkingDirectory`)
 *   renders nothing. Checked first because it overrides both cases below.
 * - No `workingDirectoryAccess`: the composer's lightweight text-input popover, via
 *   `onChangeWorkingDirectory`. `pane.selectRecentDirectory` is reused as the plain setter here
 *   rather than inventing one — `useChatPaneWorkingDirectory`'s own doc confirms it already writes
 *   the value directly (no native validation) whenever `access` is absent, which is exactly this
 *   case.
 * - `workingDirectoryAccess` present and `workingDirectoryControlPlacement === 'composer'`: the
 *   SAME folder-icon trigger, but wired to `onPickWorkingDirectory` instead — clicking it invokes
 *   the native OS dialog (`pane.pickWorkingDirectory`) directly, with no popover in between.
 * - `workingDirectoryAccess` present and placement is (default) `'below'`: neither prop — the
 *   composer renders no folder icon at all, and `ChatPaneWorkingDirectoryBlock` renders the richer
 *   `WorkingDirPicker` below instead, unchanged from every host's prior behavior.
 */
function resolveComposerWorkingDirectory(
  workingDirectoryAccess: ChatPaneWorkingDirectoryAccess | undefined,
  workingDirectoryControlPlacement: 'below' | 'composer' | 'none',
  pane: UseChatPaneResult,
): {
  workingDirectory?: string | null;
  onChangeWorkingDirectory?: (workingDirectory: string) => void;
  onPickWorkingDirectory?: () => void;
} {
  if (workingDirectoryControlPlacement === 'none') {
    return {};
  }
  if (!workingDirectoryAccess) {
    return {
      workingDirectory: pane.workingDirectory,
      onChangeWorkingDirectory: (directory: string) => void pane.selectRecentDirectory(directory),
    };
  }
  if (workingDirectoryControlPlacement === 'composer') {
    return {
      workingDirectory: pane.workingDirectory,
      onPickWorkingDirectory: () => void pane.pickWorkingDirectory(),
    };
  }
  return {};
}

interface ChatPaneComposerAreaProps {
  agentHandle: string | false;
  fileDrop: UseChatPaneFileDropResult;
  uploadAttachments: ChatPaneProps['uploadAttachments'];
  pane: UseChatPaneResult;
  disabled: boolean;
  unavailable: boolean;
  placeholder: string | undefined;
  slots: ComposerSlots;
  attachmentAccept: ChatPaneProps['attachmentAccept'];
  workingDirectoryAccess: ChatPaneWorkingDirectoryAccess | undefined;
  workingDirectoryControlPlacement: WorkingDirectoryControlPlacement;
  t: (key: string) => string;
}

/** Why Send is blocked (streaming is not a block), and whether that reason also shows as a notice. */
function resolveSendBlockerNotice(
  { pane, unavailable, t }: Pick<ChatPaneComposerAreaProps, 'pane' | 'unavailable' | 't'>,
  _optional = {},
): { sendDisabledReason: string | undefined; showsNotice: boolean } {
  const sendDisabledReason = pane.sendBlocker && pane.sendBlocker !== 'streaming'
    ? t(describeChatPaneSendBlocker(pane.sendBlocker))
    : undefined;
  // MOVE: the reason used to sit in the composer's footer row beside the folder and model buttons.
  // It is now a notice above the composer, with the other pane notices; Send's tooltip keeps it.
  // While the pane is unavailable its own banner (loading, no usable CLI) already says it.
  const showsNotice = sendDisabledReason !== undefined && !unavailable && chatPaneSendBlockerNeedsNotice({ blocker: pane.sendBlocker });
  return { sendDisabledReason, showsNotice };
}

/** The drop target, composer, and working-directory block — everything below the status banners
 * that reads/writes the live pane. Cancelling an in-flight run is not a separate control here: it
 * lives in the composer's own trailing button, which swaps from send to stop while streaming (see
 * `Composer`'s `running`/`onCancel` props) — the same control an operator's attention is already
 * on, rather than a second affordance elsewhere in the pane they'd have to go find.
 *
 * The pending-turn strip previously lived here (a banner bolted above the composer). It now
 * renders inside `<MessageList>` itself, as the newest transcript entry — see that component's
 * `pendingPrompts` prop and this component's own call site below. */
export function ChatPaneComposerArea({
  agentHandle, fileDrop, uploadAttachments, pane, disabled, unavailable, placeholder, slots,
  attachmentAccept, workingDirectoryAccess, workingDirectoryControlPlacement, t,
}: ChatPaneComposerAreaProps): ReactNode {
  const sendDisabledReasonId = useId();
  const { sendDisabledReason, showsNotice } = resolveSendBlockerNotice({ pane, unavailable, t });
  return (
    <div
      className={`jini-chat-pane__drop-target${fileDrop.draggingFiles ? ' is-dragging-files' : ''}`}
      data-testid="chat-pane-file-drop-target"
      data-dragging-files={fileDrop.draggingFiles ? 'true' : 'false'}
      {...resolveDropTargetProps(uploadAttachments, fileDrop)}
    >
      {fileDrop.draggingFiles ? (
        <span className="jini-chat-pane__drop-announcement" role="status">
          {t('Drop files to attach')}
        </span>
      ) : null}
      <ChatPaneComposerBlocker pane={pane} t={t} sendDisabledReasonId={sendDisabledReasonId}
        sendDisabledReason={sendDisabledReason} showsNotice={showsNotice} />
      <Composer
        agentHandle={agentHandle}
        composer={pane.composer}
        onSend={() => void pane.send()}
        // Streaming no longer locks the textarea: `pane.send()` queues a turn typed during a run
        // rather than refusing it, so the operator can keep writing while the agent thinks.
        disabled={disabled || unavailable}
        // The one blocker `send()` handles itself. Every other refusal still greys out the button.
        sendDisabled={!pane.canSend && pane.sendBlocker !== 'streaming'}
        {...definedProps({ source: { sendDisabledReason, sendDisabledReasonId: showsNotice ? sendDisabledReasonId : undefined } })}
        running={pane.conversation.isStreaming}
        onCancel={pane.conversation.cancel}
        {...definedProps({ source: { placeholder } })}
        slots={slots}
        {...resolveComposerAttachmentPicker(uploadAttachments, pane, attachmentAccept)}
        {...resolveComposerWorkingDirectory(workingDirectoryAccess, workingDirectoryControlPlacement, pane)}
      />
      <ChatPaneWorkingDirectoryBlock
        workingDirectoryAccess={workingDirectoryAccess}
        workingDirectoryControlPlacement={workingDirectoryControlPlacement}
        pane={pane}
        t={t}
      />
    </div>
  );
}

function ChatPaneComposerBlocker({ pane, t, sendDisabledReasonId, sendDisabledReason, showsNotice }: {
  pane: UseChatPaneResult; t: (key: string) => string; sendDisabledReasonId: string;
  sendDisabledReason: string | undefined; showsNotice: boolean;
}): ReactNode {
  return showsNotice ? (
        <div id={sendDisabledReasonId} className="jini-chat-pane__status jini-chat-pane__blocker" role="status">
          {pane.sendBlocker === 'uploads-pending' ? <Icon name="spinner" size={13} /> : null}
          <span>{sendDisabledReason}</span>
        </div>
  ) : null;
}
