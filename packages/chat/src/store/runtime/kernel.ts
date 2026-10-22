import type { StorageKernel } from "@jini-ai/db/kernel";
import type { ChatDatabase as TranscriptDatabase } from "../sql/tables.js";

/** Borrowed existing chat tables; the host owns migrations and connection lifetime. */
export type ChatDatabase = TranscriptDatabase & {
  assistant_agent_sessions: { conversation_id: string; agent_id: string; session_id: string; updated_at: number };
  assistant_run_attempts: {
    message_id: string;
    engine: string;
    accepted_json: string;
    recovery_count: number;
    recovery_deadline: number | null;
    recovery_elapsed_ms: number;
    attempt_started_at: number;
    last_progress_at: number;
    cancel_reason: string | null;
    session_id: string | null;
    session_confirmed: number;
    child_pid: number | null;
    child_started_at: string | null;
    attempt_base_json: string;
  };
};
export type ChatKernel<DB extends ChatDatabase = ChatDatabase> = StorageKernel<DB>;
