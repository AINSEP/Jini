/** Owner policy: 30-day activity and final send identities, 24-hour captured bodies.
 * Unresolved reservations and verified feedback event IDs retain their replay protection. */
import { sql } from "kysely";
import type { MailRepoDeps } from "./ledger.repo.js";
export const MAIL_ACTIVITY_RETENTION_MS = 30 * 24 * 60 * 60_000;
export const MAIL_CAPTURE_RETENTION_MS = 24 * 60 * 60_000;
export const MAIL_RETENTION_INTERVAL_MS = 60_000;

/** One atomic privacy pass; timestamps and the clock are injected for deterministic boundary tests.
 * @complexity Five statements using 0031 timestamp-leading indexes; work is proportional to expired candidates, no body reads. */
export async function purgeExpiredMail<DB>({ db }: MailRepoDeps<DB>, { now = Date.now }: { now?: () => number } = {}): Promise<void> {
  const activityBefore = new Date(now() - MAIL_ACTIVITY_RETENTION_MS).toISOString();
  const captureBefore = new Date(now() - MAIL_CAPTURE_RETENTION_MS).toISOString();
  await db.transaction(async () => {
    await db.execute(sql`DELETE FROM mail_capture WHERE created_at <= ${captureBefore}`);
    await db.execute(sql`DELETE FROM mail_activity_attempts WHERE created_at <= ${activityBefore}`);
    // No caller requires final-result replay beyond 30 days. A recent retry still needs its window:
    // created_at is the original reservation time; updated_at is the last reserve/mark time.
    await db.execute(sql`DELETE FROM mail_send_ledger WHERE created_at <= ${activityBefore}
      AND updated_at <= ${activityBefore} AND outcome IN ('sent', 'failed', 'unknown')`);
    // In-flight reservations cannot be deleted: that would authorize a duplicate delivery.
    await db.execute(sql`UPDATE mail_send_ledger SET activity_retained = 0, provider_message_id = NULL, error_code = NULL
      WHERE created_at <= ${activityBefore} AND activity_retained = 1`);
    // Keep verified event IDs and suppression state; discard completed feedback's activity metadata.
    await db.execute(sql`UPDATE mail_feedback_inbox SET recipient = '', provider_message_id = '', occurred_at = received_at
      WHERE received_at <= ${activityBefore} AND processed_at IS NOT NULL AND (recipient <> '' OR provider_message_id <> '')`);
  });
}

/** Reuse the store's owner/close lifecycle. There is no existing mail purge or general sweep runner.
 * Boot and minute passes never overlap; disposal stops ticks and drains the active transaction. */
export function startMailRetention<DB>(required: MailRepoDeps<DB>, options: { now?: () => number; intervalMs?: number; onError?: () => void; every?: (run: () => void, ms: number) => () => void } = {}): () => Promise<void> {
  const intervalMs = options.intervalMs ?? MAIL_RETENTION_INTERVAL_MS;
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) throw new RangeError("mail retention interval must be positive");
  let active: Promise<void> | undefined;
  let stopped = false;
  const pass = () => {
    if (stopped || active) return;
    active = purgeExpiredMail(required, options).catch(() => { try { if (options.onError) options.onError(); else console.warn("[mail-retention] purge failed"); } catch { /* Logging cannot reject timer work. */ } }).finally(() => { active = undefined; });
  };
  const every = options.every ?? ((run, ms) => { const timer = setInterval(run, ms); timer.unref(); return () => clearInterval(timer); });
  pass();
  const cancel = every(pass, intervalMs);
  return async () => { stopped = true; cancel(); await active; };
}
