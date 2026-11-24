import type { ChatMessage } from "../../react/kit.js";

/** Structural slice of the host chat library's conversation summary, as the chats endpoint lists it. */
export interface AssistantConversation {
  id: string;
  title: string | null;
  titleSource: "fallback" | "generated" | "manual";
  messageCount: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * @file What `useAssistantChats` needs from the outside world, as an interface rather than a set of
 * module imports.
 *
 * The hook used to import the host's assistant-chats client functions directly, which meant the only way to
 * test it was to stub the global `fetch` and assert on the URLs and methods that came out — the
 * tests described HTTP when what they meant to describe was "which conversation did this message
 * get written to". Worse, behaviour that has nothing to do with transport (the write retry and its
 * backoff) could only be exercised by hand-building `Response` objects with the right status codes.
 *
 * Declaring the seam here follows the `useX(dependencies)` / `useWiredX()` pair this workspace
 * already uses throughout the UI library (see its present-mode hook for the canonical shape).
 * This port declares, the host's assistant-chats dependencies module binds, and nothing else imports the
 * real provider.
 *
 * `AssistantConversation` is restated above as a type, which is erased at compile time — so this
 * file still has no runtime dependency on the host's assistant-chats client, and the host's dependencies
 * module remains the single place the real implementation is reached.
 *
 * ## What is deliberately NOT in this port
 *
 * `persistableMessages` and `HttpError`. The first is a pure rule — no I/O, no host — and per the
 * pattern a hook imports rules directly rather than having them injected; making it swappable would
 * let a fake quietly change which messages count as settled, which is the one thing every test here
 * needs to hold still. The second is the error type an implementation is expected to throw for a
 * non-2xx response, and it is part of this contract even though it is not a method: {@link
 * AssistantChatsPort.saveMessage}'s retry classifies failures by it.
 */
export interface AssistantChatsPort {
  listConversations(): Promise<AssistantConversation[]>;
  /** `firstMessage` seeds the server-side title heuristic; omit it for an untitled empty chat. */
  createConversation(required: Record<string, never>, options?: { firstMessage?: string }): Promise<AssistantConversation>;
  renameConversation(required: { id: string; title: string }): Promise<void>;
  deleteConversation(required: { id: string }): Promise<void>;
  loadMessages(required: { conversationId: string }): Promise<ChatMessage[]>;
  /**
   * Writes one message.
   *
   * Expected to reject with an `HttpError` for a non-2xx response and with anything else for a
   * transport failure — the hook retries the second kind, and the first only for 429/5xx. An
   * implementation that swallows failures into a resolved promise silently disables the retry.
   */
  saveMessage(required: { conversationId: string; message: ChatMessage }): Promise<void>;
}
