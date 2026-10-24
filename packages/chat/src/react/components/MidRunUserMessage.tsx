/**
 * @module MidRunUserMessage
 *
 * Renders a message the human sent while a run was going (`ChatPane`'s `deliverMidRunMessage`) as a
 * user bubble inside the running turn, at the point in the stream where the live agent received it.
 * The daemon records each one as a `user_message` run event (`AgentExecutor.sendUserMessage`), which
 * the run-event translator surfaces as `kind: 'ext'` with that name; this claims it.
 *
 * It is an event of the assistant turn, not a `ChatMessage` of its own, because the agent folded it
 * into the turn it was already running — there is no separate reply to hang off it.
 */
import { acceptedInputEvent, type AcceptedChatInput } from '../../core/accepted-input.js';
import { SentAttachmentButton } from './SentAttachment.js';
import { AttachmentPreviewModal } from './AttachmentPreviewModal.js';
import { useAttachmentGallery } from './AttachmentGallery.hooks.js';
import { useT } from '../hooks/context.js';
import { MID_RUN_USER_MESSAGE_EVENT_NAME } from '../../core/turn-usage.js';
import { registerExtEventRenderer, type ExtEventRenderProps } from '../ext-event-renderer-registry.js';

/** The ext-event name the daemon's mid-run `user_message` run event arrives under. One source with
 * the core reply split (`replySegments`), which ends a reply's usage at this same event. */
export const MID_RUN_USER_MESSAGE_EXT_EVENT_NAME = MID_RUN_USER_MESSAGE_EVENT_NAME;

function field(data: unknown, key: 'id' | 'text'): string | undefined {
  const value = typeof data === 'object' && data !== null ? (data as Record<string, unknown>)[key] : undefined;
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** One slot per message id, so each mid-run message renders where it arrived rather than folding into the first. */
export function midRunUserMessageSlotKey({ data }: { data: unknown }): string | undefined {
  return field(data, 'id');
}

/** The bubble for one mid-run message — the same classes as a sent user message, so it reads as one. */
export function MidRunUserMessage({ events, runStreaming = false }: Pick<ExtEventRenderProps, 'events'> & Partial<Pick<ExtEventRenderProps, 'runStreaming'>>) {
  const data = events.at(-1);
  const text = field(data, 'text');
  if (text === undefined) return null;
  const receipt = acceptedInputEvent({ event: { kind: 'ext', name: MID_RUN_USER_MESSAGE_EVENT_NAME, data } });
  // MOVE: A single live delivery may contain several queued inputs; display their original receipts.
  const inputs: readonly AcceptedChatInput[] = receipt?.data.inputs ?? [{ id: field(data, 'id') ?? 'mid-run', text }];
  // A run that ended without reading the message hands it to the next turn; it is no longer queued here.
  return <>{inputs.map(input => <MidRunInput key={input.id} input={input}
    queued={runStreaming && (input.deliveryState ?? receipt?.data.deliveryState) === 'queued'} />)}</>;
}

function MidRunInput({ input, queued }: { input: AcceptedChatInput; queued: boolean }) {
  const t = useT();
  const attachments = input.attachments ?? [];
  const gallery = useAttachmentGallery({ attachments });
  return (
    <div className="jini-message jini-message-user jini-message-user--mid-run" data-agent-role="region" data-agent-label="A message from the user, sent while the agent was working">
      {queued && <div className="jini-message-user__queued" role="status">{t('Queued — read after the current step')}</div>}
      <div className="jini-message-content">{input.text}</div>
      {attachments.length > 0 && <div className="jini-message-attachments">
        {attachments.map(attachment => <SentAttachmentButton key={attachment.path} attachment={attachment} onOpen={gallery.open} />)}
      </div>}
      {gallery.opened !== null && <AttachmentPreviewModal attachment={gallery.opened} onClose={gallery.close} navigation={gallery.navigation} />}
    </div>
  );
}

/**
 * Registers {@link MidRunUserMessage} against the ext-event registry.
 *
 * @returns An unregister handle, so a test or a hot reload can dispose cleanly.
 */
export function registerMidRunUserMessageRenderer(): () => void {
  return registerExtEventRenderer(
    { name: MID_RUN_USER_MESSAGE_EXT_EVENT_NAME, renderer: (props) => <MidRunUserMessage events={props.events} runStreaming={props.runStreaming} /> },
    { slotKey: midRunUserMessageSlotKey },
  );
}
