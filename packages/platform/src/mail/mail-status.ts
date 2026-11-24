/** Shared safe status/configuration contracts are owned by Jini; the host retains selection control.
 * The provider verdict remains separate from credential presence and delivery evidence.
 * Setup copy is plugin/host data, and credential summaries expose presence without values.
 */
import type { MailProviderConfigurationReport } from "./ports.js";

/** Explicit provider selection: `check` validates without sending, `select` writes both lanes. */
export interface MailProviderControl {
  check(required: { id: string }): Promise<{ ok: true; label: string } | { ok: false; reason: string }>;
  select(required: { id: string; principalId: string; expectedRevisionSeq?: number }): Promise<void>;
  /** Exact addressed setting value and revision, read before an access approval. */
  readSelection?(): Promise<{ setting: MailProviderConfigurationReport["setting"]; revisionSeq: number }>;
  /** The safe configuration DTO for every installed provider. Absent in older roots. */
  describe?(): Promise<MailProviderConfigurationReport>;
  /** Drops cached provider mailers and status so the next send and status read start fresh. */
  invalidate?(): void;
}
