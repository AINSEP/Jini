import type { RoutineRow, RoutineSchedule } from "@jini-ai/core/contracts/site/routines";
import type { RoutinesT } from "./Routines.js";

/**
 * @file Turns a contract row into the strings the table shows. Why: every label rule (hourly shows
 * its minute, daily shows its zone, approval and catch-up both show, an affirmative receipt reads
 * "owner said yes" and never "done") lives in one pure, testable place instead of inside JSX.
 */
export type RoutineViewRow = Readonly<{
  id: string; name: string; scheduleLabel: string; paused: boolean; agentLabel: string; modelLabel: string | null;
  nextRunLabel: string | null; lastRunLabel: string; outcomeLabel: string | null; outcomeAtLabel: string | null;
  badges: readonly string[]; conversationId: string | null; revision: number; source: RoutineRow;
}>;

const fill = (text: string, values: Record<string, string>): string => text.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);

/** Weekday names come from Intl, not a dictionary: the platform already knows every locale's. */
function weekdayName({ weekday, locale }: { weekday: number; locale: string }): string {
  return new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2023, 0, 1 + weekday)));
}

function scheduleLabelOf({ schedule, locale, t }: { schedule: RoutineSchedule; locale: string; t: RoutinesT }): string {
  if (schedule.kind === "hourly") return fill(t({ locale, key: "Every hour, {minute} minutes past the hour" }), { minute: String(schedule.minute) });
  const values = { time: schedule.time, timezone: schedule.timezone };
  if (schedule.kind === "daily") return fill(t({ locale, key: "Every day at {time} ({timezone})" }), values);
  if (schedule.kind === "weekdays") return fill(t({ locale, key: "Weekdays at {time} ({timezone})" }), values);
  return fill(t({ locale, key: "Every week on {weekday} at {time} ({timezone})" }), { ...values, weekday: weekdayName({ weekday: schedule.weekday, locale }) });
}

const STATUS_KEYS = { succeeded: "Succeeded", failed: "Failed", running: "Running", queued: "Running", canceled: "Canceled", interrupted: "Interrupted" } as const;
const APPROVAL_KEYS = { waiting: "Waiting for approval", approved: "owner said yes", declined: "Approval declined", expired: "Approval expired" } as const;

/** Both labels can apply to one run: a catch-up run can still be waiting for approval. */
function badgesOf({ row, locale, t }: { row: RoutineRow; locale: string; t: RoutinesT }): string[] {
  const run = row.lastRun;
  if (run === null) return [];
  const badges: string[] = [];
  if (run.catchUp === true) badges.push(t({ locale, key: "Catch-up run" }));
  const approval = run.approvalState;
  if (approval !== undefined && approval !== "none") badges.push(t({ locale, key: APPROVAL_KEYS[approval] }));
  return badges;
}

export function projectRoutineRow({ row, locale, t }: { row: RoutineRow; locale: string; t: RoutinesT }, _optional: Record<string, never> = {}): RoutineViewRow {
  const formatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  const when = (millis: number | null | undefined): string | null => (typeof millis === "number" ? formatter.format(new Date(millis)) : null);
  const run = row.lastRun;
  return {
    id: row.id, name: row.name, scheduleLabel: scheduleLabelOf({ schedule: row.schedule, locale, t }), paused: !row.enabled,
    agentLabel: row.agentId ?? t({ locale, key: "Agent default" }), modelLabel: row.model,
    nextRunLabel: row.enabled ? when(row.nextRunAt) : null,
    lastRunLabel: when(run?.startedAt) ?? t({ locale, key: "Never run" }),
    outcomeLabel: run === null ? null : t({ locale, key: STATUS_KEYS[run.status] }),
    outcomeAtLabel: when(run?.completedAt), badges: badgesOf({ row, locale, t }),
    conversationId: run?.conversationId ? run.conversationId : null, revision: row.revision, source: row,
  };
}
