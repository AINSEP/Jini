import type { ExecuteCommandFn } from "@jini-ai/core/contracts/events";
import { executeCommand } from "../commands/command.js";

/** Compile-time proof that the cms gateway and the neutral core signature are the same contract: forms ports are typed with the core side and must accept the cms gateway, and the core side must not promise more than the gateway does. */
export const executeCommandIsExecuteCommandFn = executeCommand satisfies ExecuteCommandFn;
declare const fn: ExecuteCommandFn;
export const executeCommandFnIsExecuteCommand: typeof executeCommand = fn;
