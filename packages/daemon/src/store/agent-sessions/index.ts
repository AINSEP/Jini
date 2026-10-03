/** Neutral session-id port and reference adapter; never imports SQL or a driver. */
import type { AgentSessionStore } from './ports.js';
export type { AgentSessionStore } from './ports.js';
export { AgentSessionStoreError } from './errors.js';

/**
 * Private in-memory mapping for opaque (conversation, agent) pairs.
 * JSON pair encoding prevents delimiter collisions; overwrite/clear affect only that pair.
 * @returns Independent store with asynchronous get/set/clear contracts.
 * @complexity Each operation O(k) for encoding k identity characters, plus expected O(1) map access.
 */
export function createInMemoryAgentSessionStore(_requiredArgs: Record<string, never>): AgentSessionStore {
 // This reference store owns no conversation foreign key, so test/lazy compositions need only
 // a map; opening an in-memory SQL database and running DDL would add no invariant to enforce.
 const sessions = new Map<string,string>();
 const key = (conversationId:string,agentId:string) => JSON.stringify([conversationId,agentId]);
 return {
  async getSessionId({ conversationId, agentId }: { readonly conversationId: string; readonly agentId: string }) { return sessions.get(key(conversationId,agentId)) ?? null; },
  async setSessionId({ conversationId, agentId, sessionId }: { readonly conversationId: string; readonly agentId: string; readonly sessionId: string }) { sessions.set(key(conversationId,agentId),sessionId); },
  async clearSessionId({ conversationId, agentId }: { readonly conversationId: string; readonly agentId: string }) { sessions.delete(key(conversationId,agentId)); },
 };
}
