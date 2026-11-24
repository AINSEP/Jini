/**
 * @file The host effect run after saving a decision that lowers tool access. The refusal raised when
 * the affected answers cannot be confirmed stopped is `ToolAccessLoweringError` in `@jini-ai/daemon`.
 */
import type { ToolAccessChange } from "./daemon.js";

/** Host effect used after saving a decision that lowers tool access. */
export type NotifyToolAccessChanged = (input?: { readonly lowered?: ToolAccessChange }) => Promise<void>;

