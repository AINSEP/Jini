import type { ExecuteCommandFn } from "@jini-ai/core/contracts/events";
import { executeCommand } from "../commands/command.js";

/** Compile-time proof that the cms gateway implements the neutral core signature. */
export const executeCommandIsExecuteCommandFn = executeCommand satisfies ExecuteCommandFn;
