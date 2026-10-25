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
import { a2uiSurfaceIdOf, displayOnlySurfaceIdOf } from '@jini-ai/agentic/a2ui';
import type { AgentEvent } from './events.js';
import { isDelegatedWrapperToolName } from './tool-events.js';
import { MID_RUN_USER_MESSAGE_EVENT_NAME } from './turn-usage.js';
import { SURFACE_QUESTION_META_KEY } from './question-answer.js';
import { acceptedInputEvent } from './accepted-input.js';

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

/** The A2UI ext name: its surfaces may declare themselves display-only (`@jini-ai/agentic/a2ui`). */
const A2UI_EXT_NAME = 'a2ui';

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
  standaloneCardIndex: number;
  pendingQuestionIndex: number;
  lastWorkIndex: number;
  retry: { index: number; data: unknown } | null;
  progress: { index: number; seconds: number } | null;
  visibleCount: number;
  /** A2UI surfaces whose `createSurface` declared display-only: a chart, not a question. */
  displayOnlySurfaces: Set<string>;
  /** See {@link RunActivityOptions.isAnsweredCard}. */
  isAnsweredCard: IsAnsweredCard | undefined;
  answeredSurfaces: ReadonlySet<string>;
}

/** Whether the person already answered a card, before its tool call returned. */
export type IsAnsweredCard = (card: { name: string; data: unknown }) => boolean;

export interface RunActivityOptions {
  /**
   * A card the person answered no longer waits on them, even though its tool call stays open while
   * the confirmed work runs (a publish can take minutes). Without this the line kept saying
   * "Waiting for your answer above" under a card that already read "Done." (owner, 2026-10-11).
   */
  isAnsweredCard?: IsAnsweredCard | undefined;
}

function isVisible(event: AgentEvent): boolean {
  return event.kind === 'text' ? event.text.length > 0 : event.kind === 'tool_use' || event.kind === 'tool_result' || event.kind === 'ext';
}

/**
 * Whether an ext event is a card the person must answer. A display-only A2UI surface shows
 * something and asks nothing, so a tool holding its call open after drawing one (assistant_render_ui
 * waits a few seconds to hear a browser refusal) must not read as "Waiting for your answer above"
 * (demo V3, 2026-10-05).
 */
function isAnswerCard(scan: Scan, name: string, data: unknown): boolean {
  if (!CARD_EXT_NAMES.has(name)) return false;
  if (hasSurfaceReceipt({ scan, name, data })) return false;
  if (scan.isAnsweredCard?.({ name, data }) === true) return false;
  if (name !== A2UI_EXT_NAME) return true;
  const displayOnlyId = displayOnlySurfaceIdOf({ message: data });
  if (displayOnlyId !== undefined) scan.displayOnlySurfaces.add(displayOnlyId);
  const surfaceId = a2uiSurfaceIdOf({ message: data });
  return surfaceId === undefined || !scan.displayOnlySurfaces.has(surfaceId);
}

/** A replayed standalone receipt closes only the resource it answered. O(1), no effects. */
function hasSurfaceReceipt({ scan, name, data }: { scan: Scan; name: string; data: unknown }, _options = {}): boolean {
  if (name !== 'mcp-ui' || !isRecord(data)) return false;
  const resource = data.resource;
  return isRecord(resource) && typeof resource.uri === 'string' && scan.answeredSurfaces.has(resource.uri);
}

function scanStatus(
  { scan, event, index }: { scan: Scan; event: Extract<AgentEvent, { kind: 'status' }>; index: number },
  _optional: {} = {},
): void {
  if (event.code === 'api_retry') {
    scan.retry = { index, data: event.data };
  } else if (event.code === 'tool_progress') {
    const seconds = numberField(event.data, 'elapsedSeconds');
    if (seconds !== undefined) scan.progress = { index, seconds };
  }
}

function scanEvent(scan: Scan, event: AgentEvent, index: number): void {
  // Queue acceptance/consumption is user input, not new agent activity. Neither restarts its clock.
  if (event.kind === 'ext' && event.name === MID_RUN_USER_MESSAGE_EVENT_NAME) return;
  if (WORK_EVENT_KINDS.has(event.kind)) scan.lastWorkIndex = index;
  if (isVisible(event)) {
    scan.lastVisible = { index, kind: event.kind };
    scan.visibleCount += 1;
  }
  // Tool work after an explicit question proves the run moved past it (expired, skipped or aborted
  // without a receipt); otherwise its waiting line would outlive the question for the whole run.
  if (event.kind === 'tool_use') {
    scan.pendingQuestionIndex = -1;
    scan.open = scan.open.filter((tool) => tool.id !== event.id);
    scan.open.push({ id: event.id, name: event.name, input: event.input, index });
  } else if (event.kind === 'tool_result') {
    scan.pendingQuestionIndex = -1;
    scan.open = scan.open.filter((tool) => tool.id !== event.toolUseId);
  } else if (event.kind === 'ext') {
    scanCard({ scan, event, index });
  } else if (event.kind === 'status') {
    scanStatus({ scan, event, index });
  }
}

/** Work after a standalone form proves the run has moved past that form. */
const WORK_EVENT_KINDS: ReadonlySet<AgentEvent['kind']> = new Set<AgentEvent['kind']>(['text', 'tool_use', 'tool_result']);

/** Standalone approval forms have no open tool call. Require interactive markup so outcome
 * documents do not acquire a waiting status. Inspect text only; this never executes a document. */
function scanCard({ scan, event, index }: {
  scan: Scan; event: Extract<AgentEvent, { kind: 'ext' }>; index: number;
}, _options = {}): void {
  if (!isAnswerCard(scan, event.name, event.data)) return;
  scan.lastCardIndex = index;
  const resource = isRecord(event.data) ? event.data.resource : undefined;
  const html = isRecord(resource) ? resource.text : undefined;
  const meta = isRecord(resource) ? resource._meta : undefined;
  // A producer can retain its question before flattening it into a document (including custom forms).
  const question = isRecord(meta) ? meta[SURFACE_QUESTION_META_KEY] : undefined;
  if (isRecord(question)) scan.pendingQuestionIndex = index;
  if (typeof html === 'string' && /<form\b|data-mcpui-action\s*=/i.test(html)) scan.standaloneCardIndex = index;
}

/** `{ a: 1, b: undefined }` → `{ a: 1 }`, so optional activity fields are absent rather than undefined. */
function definedFields<T extends Record<string, unknown>>(
  { fields }: { fields: T },
  _optional: {} = {},
): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as { [K in keyof T]?: Exclude<T[K], undefined> };
}

function retryingActivity({ data }: { data: unknown }, _optional: {} = {}): RunActivity {
  return {
    kind: 'retrying',
    ...definedFields({
      fields: {
        attempt: numberField(data, 'attempt'),
        maxAttempts: numberField(data, 'maxAttempts'),
        service: stringField(data, 'service'),
      },
    }),
  };
}

/** The signal while a tool call is open: a card waiting on the person, tool discovery, or the tool itself. */
function openToolSignal(
  { scan, newestOpen }: { scan: Scan; newestOpen: OpenTool },
  _optional: {} = {},
): Pick<RunActivityState, 'activity' | 'key'> {
  if (scan.lastCardIndex > newestOpen.index) {
    return { activity: { kind: 'awaiting-answer' }, key: `card:${scan.lastCardIndex}` };
  }
  const key = `tool:${newestOpen.id}`;
  if (DISCOVERY_TOOL_NAMES.has(newestOpen.name)) return { activity: { kind: 'finding-tool' }, key };
  const reported = scan.progress && scan.progress.index > newestOpen.index ? scan.progress.seconds : undefined;
  return {
    activity: {
      kind: 'running-tool',
      tool: humanizeToolName({ name: newestOpen.name }, { input: newestOpen.input }),
      ...definedFields({ fields: { reportedSeconds: reported } }),
    },
    key,
  };
}

function latestSignal({ scan }: { scan: Scan }, _optional: {} = {}): Pick<RunActivityState, 'activity' | 'key'> {
  // Explicit standalone questions wait for their receipt; unrelated startup/model activity cannot
  // establish that a person answered. Markup-only legacy cards retain their existing work heuristic.
  if (scan.pendingQuestionIndex >= 0) {
    return { activity: { kind: 'awaiting-answer' }, key: `card:${scan.pendingQuestionIndex}` };
  }
  const lastVisibleIndex = scan.lastVisible?.index ?? -1;
  if (scan.retry && scan.retry.index > lastVisibleIndex) {
    return { activity: retryingActivity({ data: scan.retry.data }), key: `retry:${lastVisibleIndex}` };
  }
  const newestOpen = scan.open[scan.open.length - 1];
  if (newestOpen) return openToolSignal({ scan, newestOpen });
  return idleSignal({ scan });
}

/** The no-open-tool fallback; legacy markup alone stops waiting when work follows it. O(1). */
function idleSignal({ scan }: { scan: Scan }, _options = {}): Pick<RunActivityState, 'activity' | 'key'> {
  const lastVisibleIndex = scan.lastVisible?.index ?? -1;
  if (scan.standaloneCardIndex > scan.lastWorkIndex) {
    return { activity: { kind: 'awaiting-answer' }, key: `card:${scan.standaloneCardIndex}` };
  }
  if (scan.lastVisible?.kind === 'text') {
    return { activity: { kind: 'writing' }, key: `writing:${lastVisibleIndex}` };
  }
  return { activity: { kind: 'thinking' }, key: `thinking:${lastVisibleIndex}` };
}

/**
 * The latest signal in a running turn's events.
 *
 * Precedence, newest wins: an API retry with nothing visible after it; a card that arrived while a
 * tool call is still open (the tool is waiting on the person; a display-only A2UI surface is not a
 * card); the newest open tool call; else
 * writing (last visible event is text) or thinking.
 *
 * @complexity O(n) time in events, O(open tool calls + answered surfaces) extra space.
 */
export function deriveRunActivity(
  { events }: { events: readonly AgentEvent[] | undefined },
  { isAnsweredCard }: RunActivityOptions = {},
): RunActivityState {
  const answeredSurfaces = new Set((events ?? []).flatMap(event => {
    const uri = acceptedInputEvent({ event })?.data.surfaceUri;
    return typeof uri === 'string' ? [uri] : [];
  }));
  const scan: Scan = { open: [], lastVisible: null, lastCardIndex: -1, standaloneCardIndex: -1, pendingQuestionIndex: -1, lastWorkIndex: -1, retry: null, progress: null, visibleCount: 0, displayOnlySurfaces: new Set(), isAnsweredCard, answeredSurfaces };
  (events ?? []).forEach((event, index) => scanEvent(scan, event, index));
  return { ...latestSignal({ scan }), visibleCount: scan.visibleCount };
}

/**
 * Whether the run is waiting on the person: a card (form, confirm, sign-in) arrived while its tool
 * call is still open. Hosts use it to hide "still working" notices, which read as a hung run while
 * the run is really waiting for an answer.
 *
 * @complexity O(n) in events.
 */
export function isAwaitingAnswer({ events }: { events: readonly AgentEvent[] | undefined }, options: RunActivityOptions = {}): boolean {
  return deriveRunActivity({ events }, options).activity.kind === 'awaiting-answer';
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
