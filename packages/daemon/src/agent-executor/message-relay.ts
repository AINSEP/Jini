import type { RuntimeAgentDef } from '@jini-ai/agent-runtime';
import type { RunAgentPayload, RelayedUserMessage, MessageRelayVia } from '@jini-ai/protocol';

export interface RunMessageRelay {
  enqueue(input: { id: string; text: string; hasAttachments: boolean }): 'delivered' | 'not-running';
  claim(input: { via: MessageRelayVia }): readonly RelayedUserMessage[];
  close(): void;
}

/**
 * Whether a def's live process can take another user message mid-run: only a stream-json stdin
 * transport keeps stdin open for more JSONL user lines (see `RuntimeAgentDef.promptInputFormat`).
 * Deliberately not `resolveContinuationTransport`: that answers how a tool result gets back, and
 * reports `'mcp-callback'` for Claude even though its stdin takes user lines all the same.
 * Native stream-json input wins even when the engine also has MCP.
 */
export function acceptsMidRunUserMessages({ def }: { def: RuntimeAgentDef }, _options = {}): boolean {
  return def.promptViaStdin === true && def.promptInputFormat === 'stream-json';
}

/** A definition without an injected MCP bridge must retain next-turn fallback. */
export function supportsMessageRelay({ def }: { def: RuntimeAgentDef }, _options = {}): boolean {
  return def.externalMcpInjection !== undefined && !acceptsMidRunUserMessages({ def });
}

/** One synchronous FIFO claim per process: parallel tool results get disjoint prefixes.
 * The browser retains the fallback copy until the emitted consumption receipt arrives.
 * @param emit - Enqueues receipts on the driver's existing lifecycle FIFO; never waits on I/O.
 * @returns A text-only inbox, closed synchronously before the driver's terminal event.
 * @complexity O(n) retained messages; each claim scans its prefix and removes it in one splice.
 */
export function createMessageRelay({ emit }: { emit: (payload: RunAgentPayload) => void }, { maxChars = 32_000 }: { maxChars?: number } = {}): RunMessageRelay {
  const pending: Array<RelayedUserMessage & { hasAttachments: boolean }> = [];
  let seq = 0;
  let closed = false;
  return {
    enqueue({ id, text, hasAttachments }) {
      if (closed) return 'not-running';
      seq += 1;
      pending.push({ id, text, hasAttachments, seq });
      emit({ type: 'user_message', id, text, deliveryState: 'queued' });
      return 'delivered';
    },
    claim({ via }) {
      if (closed) return [];
      let count = 0;
      let chars = 0;
      for (const message of pending) {
        // Whole messages only, stopping at an attachment; a single oversized message is delivered alone.
        const size = message.hasAttachments ? 0 : JSON.stringify({ id: message.id, seq: message.seq, text: message.text }).length;
        if (message.hasAttachments || (count > 0 && chars + size > maxChars)) break;
        chars += size;
        count++;
      }
      return pending.splice(0, count).map(({ id, seq, text }) => {
        emit({ type: 'user_message', id, text, deliveryState: 'consumed', via });
        return { id, seq, text };
      });
    },
    close() { closed = true; pending.length = 0; },
  };
}
