/**
 * @module run-activity
 *
 * What a running turn is doing right now, as one short line ("Running Page Fill… 1 m 20 s").
 *
 * Why: once a turn's first tool row appeared, nothing on screen showed the run was still alive —
 * the old "Thinking…" placeholder only showed while the message was completely empty. Model think
 * time, long tool calls, held cards and API overload retries all looked identical: dead.
 *
 * Shape: {@link deriveRunActivity} reads the events the pane already has and returns the latest
 * signal; {@link RUN_ACTIVITY_LABELS} is the ONE table that turns a signal into words. The clock
 * (seconds since the signal began) is the caller's: the React hook ticks it once a second. Nothing
 * here special-cases a particular tool.
 *
 * Status events this reads (a host translates its runtime's heartbeats into them):
 * - `code: 'api_retry'`, `data: { attempt, maxAttempts, service? }` — the model API is overloaded.
 * - `code: 'tool_progress'`, `data: { elapsedSeconds }` — a tool call is still running.
 * - `code: 'thinking'` — the model is reasoning (keeps the idle timer honest).
 */
import type { AgentEvent } from './events.js';
import { isDelegatedWrapperToolName } from './tool-events.js';

/** The latest thing a running turn is doing. */
export type RunActivity =
  | { readonly kind: 'thinking' }
  | { readonly kind: 'writing' }
  | { readonly kind: 'finding-tool' }
  | { readonly kind: 'running-tool'; readonly tool: string; readonly reportedSeconds?: number }
  | { readonly kind: 'awaiting-answer' }
  | { readonly kind: 'retrying'; readonly attempt?: number; readonly maxAttempts?: number; readonly service?: string };

/** {@link deriveRunActivity}'s result: the signal, plus a key that changes whenever the signal restarts. */
export interface RunActivityState {
  readonly activity: RunActivity;
  /** Changes when a new signal begins, so the caller restarts its clock (e.g. `tool:<id>`). */
  readonly key: string;
  /** Count of events the person can see (text, tool rows, cards). A change means "something new". */
  readonly visibleCount: number;
}

/** Tool names whose only job is finding the right tool (MCP tool search / schema lookup). */
const DISCOVERY_TOOL_NAMES = new Set([
  'ToolSearch',
  'search_tools',
  'describe_tool',
  'mcp__jini__search_tools',
  'mcp__jini__describe_tool',
]);

/** Ext events that are a card for the person (a form, a confirm, a sign-in). */
const CARD_EXT_NAMES = new Set(['mcp-ui', 'a2ui']);

/** After this long with nothing new on screen, a thinking/writing line says "Still working…". */
export const RUN_ACTIVITY_IDLE_MS = 20_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function numberField(data: unknown, key: string): number | undefined {
  const value = isRecord(data) ? data[key] : undefined;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringField(data: unknown, key: string): string | undefined {
  const value = isRecord(data) ? data[key] : undefined;
  return typeof value === 'string' && value ? value : undefined;
}

/** `"page.fill"` → `"Page Fill"`, `"mcp__supabase__list_projects"` → `"List Projects"`. Display only. */
export function humanizeToolName({ name }: { name: string }, { input }: { input?: (unknown) | undefined } = {}): string {
  // A transport wrapper's real tool id is in `input.toolId`.
  const real = isDelegatedWrapperToolName({ name: name }) ? (stringField(input, 'toolId') ?? name) : name;
  const bare = real.startsWith('mcp__') ? real.split('__').slice(2).join('__') || real : real;
  return bare
    .split(/[._\s]+/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(' ');
}

interface OpenTool {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
  readonly index: number;
}

interface Scan {
  open: OpenTool[];
  lastVisible: { index: number; kind: AgentEvent['kind'] } | null;
  lastCardIndex: number;
  retry: { index: number; data: unknown } | null;
  progress: { index: number; seconds: number } | null;
  visibleCount: number;
}

function isVisible(event: AgentEvent): boolean {
  return event.kind === 'text' ? event.text.length > 0 : event.kind === 'tool_use' || event.kind === 'tool_result' || event.kind === 'ext';
}

function scanEvent(scan: Scan, event: AgentEvent, index: number): void {
  if (isVisible(event)) {
    scan.lastVisible = { index, kind: event.kind };
    scan.visibleCount += 1;
  }
  if (event.kind === 'tool_use') {
    scan.open = scan.open.filter((tool) => tool.id !== event.id);
    scan.open.push({ id: event.id, name: event.name, input: event.input, index });
  } else if (event.kind === 'tool_result') {
    scan.open = scan.open.filter((tool) => tool.id !== event.toolUseId);
  } else if (event.kind === 'ext' && CARD_EXT_NAMES.has(event.name)) {
    scan.lastCardIndex = index;
  } else if (event.kind === 'status' && event.code === 'api_retry') {
    scan.retry = { index, data: event.data };
  } else if (event.kind === 'status' && event.code === 'tool_progress') {
    const seconds = numberField(event.data, 'elapsedSeconds');
    if (seconds !== undefined) scan.progress = { index, seconds };
  }
}

/**
 * The latest signal in a running turn's events.
 *
 * Precedence, newest wins: an API retry with nothing visible after it; a card that arrived while a
 * tool call is still open (the tool is waiting on the person); the newest open tool call; else
 * writing (last visible event is text) or thinking.
 *
 * @complexity O(n) in events, O(open tool calls) extra space.
 */
export function deriveRunActivity({ events }: { events: readonly AgentEvent[] | undefined }): RunActivityState {
  const scan: Scan = { open: [], lastVisible: null, lastCardIndex: -1, retry: null, progress: null, visibleCount: 0 };
  (events ?? []).forEach((event, index) => scanEvent(scan, event, index));
  const visibleCount = scan.visibleCount;
  const lastVisibleIndex = scan.lastVisible?.index ?? -1;

  if (scan.retry && scan.retry.index > lastVisibleIndex) {
    const data = scan.retry.data;
    const attempt = numberField(data, 'attempt');
    const maxAttempts = numberField(data, 'maxAttempts');
    const service = stringField(data, 'service');
    return {
      activity: {
        kind: 'retrying',
        ...(attempt !== undefined ? { attempt } : {}),
        ...(maxAttempts !== undefined ? { maxAttempts } : {}),
        ...(service !== undefined ? { service } : {}),
      },
      key: `retry:${lastVisibleIndex}`,
      visibleCount,
    };
  }
  const newestOpen = scan.open[scan.open.length - 1];
  if (newestOpen) {
    if (scan.lastCardIndex > newestOpen.index) {
      return { activity: { kind: 'awaiting-answer' }, key: `card:${scan.lastCardIndex}`, visibleCount };
    }
    if (DISCOVERY_TOOL_NAMES.has(newestOpen.name)) {
      return { activity: { kind: 'finding-tool' }, key: `tool:${newestOpen.id}`, visibleCount };
    }
    const reported = scan.progress && scan.progress.index > newestOpen.index ? scan.progress.seconds : undefined;
    return {
      activity: {
        kind: 'running-tool',
        tool: humanizeToolName({ name: newestOpen.name }, { input: newestOpen.input }),
        ...(reported !== undefined ? { reportedSeconds: reported } : {}),
      },
      key: `tool:${newestOpen.id}`,
      visibleCount,
    };
  }
  if (scan.lastVisible?.kind === 'text') {
    return { activity: { kind: 'writing' }, key: `writing:${lastVisibleIndex}`, visibleCount };
  }
  return { activity: { kind: 'thinking' }, key: `thinking:${lastVisibleIndex}`, visibleCount };
}

/**
 * Whether the run is waiting on the person: a card (form, confirm, sign-in) arrived while its tool
 * call is still open. Hosts use it to hide "still working" notices, which read as a hung run while
 * the run is really waiting for an answer.
 *
 * @complexity O(n) in events.
 */
export function isAwaitingAnswer({ events }: { events: readonly AgentEvent[] | undefined }): boolean {
  return deriveRunActivity({ events }).activity.kind === 'awaiting-answer';
}

/** `4` → `"4 s"`, `80` → `"1 m 20 s"`, `120` → `"2 m 0 s"`. */
export function formatActivityClock({ totalSeconds }: { totalSeconds: number }): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes} m ${seconds % 60} s` : `${seconds} s`;
}

/** A translator: the chat package's `t(key, vars)`. */
export type RunActivityTranslate = (key: string, vars?: Record<string, string | number>) => string;

/** The clock values a label may use. */
export interface RunActivityClock {
  /** Seconds since this signal began (already corrected by any `tool_progress` report). */
  readonly seconds: number;
  /** Milliseconds since anything new appeared on screen. */
  readonly idleMs: number;
}

/**
 * THE event → words table. One entry per {@link RunActivity} kind; nothing else in the package
 * decides what the activity line says. Keys are English source strings for the host's `t()`.
 */
export const RUN_ACTIVITY_LABELS: {
  readonly [K in RunActivity['kind']]: (
    activity: Extract<RunActivity, { kind: K }>,
    clock: RunActivityClock,
    t: RunActivityTranslate,
  ) => string;
} = {
  thinking: (_a, clock, t) =>
    clock.idleMs >= RUN_ACTIVITY_IDLE_MS
      ? t('Still working… {time}', { time: formatActivityClock({ totalSeconds: clock.seconds }) })
      : t('Thinking… {time}', { time: formatActivityClock({ totalSeconds: clock.seconds }) }),
  writing: (_a, clock, t) =>
    clock.idleMs >= RUN_ACTIVITY_IDLE_MS
      ? t('Still working… {time}', { time: formatActivityClock({ totalSeconds: clock.seconds }) })
      : t('Writing…'),
  'finding-tool': (_a, clock, t) => t('Finding the right tool… {time}', { time: formatActivityClock({ totalSeconds: clock.seconds }) }),
  'running-tool': (a, clock, t) => t('Running {tool}… {time}', { tool: a.tool, time: formatActivityClock({ totalSeconds: clock.seconds }) }),
  // No clock: the run is waiting on the person, not working, and a ticking timer under an open
  // form read as a hung run (demo dry-run, 2026-10-05).
  'awaiting-answer': (_a, _clock, t) => t('Waiting for your answer above'),
  retrying: (a, _clock, t) => {
    const who = a.service ? t("{service}'s servers are busy", { service: a.service }) : t('The AI service is busy');
    return a.attempt !== undefined && a.maxAttempts !== undefined
      ? t('{who} — retrying ({attempt} of {max})…', { who, attempt: a.attempt, max: a.maxAttempts })
      : t('{who} — retrying…', { who });
  },
};

/**
 * The activity line's text for a signal and clock.
 *
 * @complexity O(1).
 */
export function describeRunActivity({ activity, clock, t }: { activity: RunActivity; clock: RunActivityClock; t: RunActivityTranslate }): string {
  const label = RUN_ACTIVITY_LABELS[activity.kind] as (a: RunActivity, c: RunActivityClock, tr: RunActivityTranslate) => string;
  return label(activity, clock, t);
}
