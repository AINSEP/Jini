import { defaultPlatformMessages, type PlatformMessages } from "../../messages.js";

/** A pre-connect policy decision; callerSafeMessage never includes resolved private addresses.
 * Export the refusal class so tool/HTTP boundaries can recognize a policy decision with instanceof
 * instead of fragile message matching. A caller can correct a refused target; DNS failures and
 * timeouts are operational failures. Reporting a policy refusal as an internal crash hides that fix.
 * The full message is for server audit/logs. Only callerSafeMessage belongs at an external boundary:
 * exposing resolved private addresses would let callers enumerate internal DNS one request at a time.
 * Public address classifications remain actionable without revealing deployment-specific IPs.
 * The safe message defaults to a generic refusal, never the full message, so omitted redaction fails
 * toward disclosing less. Recognition of this class grants no access to an unguarded transport.
 */
export class EgressRefusedError extends Error {
  readonly callerSafeMessage: string;
  constructor({ message }: { message: string }, { callerSafeMessage, messages = defaultPlatformMessages }: { callerSafeMessage?: string; messages?: PlatformMessages } = {}) {
    super(message); this.name = "EgressRefusedError"; this.callerSafeMessage = callerSafeMessage ?? messages.egressRefused();
  }
}
