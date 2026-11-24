/**
 * `@jini-ai/chat/react/bridged-chat` — `ChatPane` surfaces for a host that reaches its runtime,
 * working directories and attachment staging through one injected bridge instead of HTTP.
 */
export { createStagedAttachmentUploader } from './create-staged-attachment-uploader.js';
export { useBridgedChatTransport } from './hooks/useBridgedChatTransport.hooks.js';
export type {
  AttachmentStagingPort,
  BridgedChatTransport,
  ChatBridgePort,
  DisposableChatTransport,
} from './types.js';
