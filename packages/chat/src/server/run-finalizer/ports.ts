import type { Clock } from '@jini-ai/core/primitives';
import type { AgentEvent } from '../../core/events.js';
import type { ChatRunStatus } from '../../core/messages.js';

import type { RunRef, RunProgress, RunSettlement } from "../../core/durable-runs/run-contracts.js";
export type { RunRef, RunProgress, RunSettlement } from "../../core/durable-runs/run-contracts.js";
/** Storage contract only. Both methods must atomically reject a different run or terminal row.
 * First terminal write wins; a late checkpoint cannot reopen or replace that row. */
export interface RunLedger {
  checkpoint(args: RunProgress): Promise<boolean>;
  settle(args: RunSettlement): Promise<boolean>;
}
/** Host adapter owns URL, auth, headers and transport timeout policy. Events replay from zero. */
export interface RunDaemonClient {
  openEvents(args: { runId: string; principalId: string }): Promise<Response>;
  runStatus(args: { runId: string; principalId: string }): Promise<number | null>;
}

/** Scheduling returns an opaque handle; a host Node adapter can unref its timer here. */
export interface Scheduler {
  schedule(args: { task: () => void; delayMs: number }): unknown;
  cancel(args: { handle: unknown }): void;
  sleep(args: { delayMs: number }): Promise<void>;
}
export interface RunIdClassifier { isDaemonRunId(args: { runId: string }): boolean }
