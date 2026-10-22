/** Daemon/BYOK/AG-UI chat client lifecycles. Host routes, identity and authenticated I/O are ports. */
export { createAssistantTransportClient } from "./transport.js";
export type { AssistantTransportPorts, AssistantTransportOptions, AssistantTransportClient, ByokFrameContext, ByokStreamContext } from "./transport.js";
export type { AgUiClient, AgUiClientPorts, AgUiRunClient, AgUiEventContext } from "./ag-ui-transport.js";
export { followDurableRun } from "./durable-run-subscription.js";
export type { DurableRunBinding, DurableSubscriptionPorts } from "./durable-run-subscription.js";
export { activeRunStub, messageWriteKey, persistableMessages } from "./messages.js";
export type { AssistantConversation } from "./messages.js";

export { createChatAttachmentValidator } from "./attachment-liveness.js";
export type { ChatAttachmentValidatorInput, ChatAttachmentValidatorOptions } from "./attachment-liveness.js";
export { createA2uiActionPoster } from "./a2ui-action-poster.js";
export type { A2uiActionPosterInput, CreateA2uiActionPosterOptions, A2uiActionDeliveryOutcome } from "./a2ui-action-poster.js";
