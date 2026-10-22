/** Every checkpoint, settlement and attempt CAS shares this message lock. */
import type { RunRef } from "./ledger-contracts.js";
export function runLockKey(run: RunRef, _optional = {}): string {
  return `chat-run:${run.conversationId}:${run.messageId}`;
}
