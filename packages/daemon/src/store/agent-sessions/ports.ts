/** Underlying CLI resume ids; distinct from rich legacy agent_sessions records. */
export interface AgentSessionStore {
 /** A missing pair starts a fresh CLI session; do not attempt a resume without an id. */
 getSessionId(args: { readonly conversationId: string; readonly agentId: string }):Promise<string|null>;
 /** Each resumed turn can return a successor id, so overwrite the previous id rather than append. */
 setSessionId(args: { readonly conversationId: string; readonly agentId: string; readonly sessionId: string }):Promise<void>;
 /**
  * Clear when a resumed run ends without confirming a session id. Retaining a dead id would
  * make every later turn repeat the same failed resume until someone repairs storage manually.
  * Clearing an absent pair is a silent no-op, making repeated terminal-event handling safe.
  */
 clearSessionId(args: { readonly conversationId: string; readonly agentId: string }):Promise<void>;
}
