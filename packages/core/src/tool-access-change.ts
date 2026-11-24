/** @file Tool-access lowering seam shared by every host that saves an OFF decision: the notify effect and the error for an unconfirmed stop. */
import type { ToolAccessChange } from "./contracts/site/daemon.js";

/** Host effect used after saving a decision that lowers tool access. */
export type NotifyToolAccessChanged = (input?: { readonly lowered?: ToolAccessChange }) => Promise<void>;

/** A durable OFF decision stands even when cleanup fails; never report an unconfirmed stop. */
export class ToolAccessLoweringError extends Error {
  readonly code = 'TOOL_ACCESS_STOP_FAILED';
  constructor() { super("Tool access changed, but affected answers could not be confirmed stopped."); }
}
