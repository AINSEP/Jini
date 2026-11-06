import { formatErrorForLog } from '@jini-ai/core';
const RUNNING_TITLE_CLASS = ' shimmer-text';

/**
 * @module ToolCard
 *
 * Renders a single `tool_use` (optionally paired with its `tool_result`) as
 * an inline card. Lookup order: (1) a user-registered renderer
 * (`registerToolRenderer` — `../../tool-renderer-registry.js`), (2) a
 * hardcoded family card for tools shipped with this package (TodoWrite /
 * Write / Edit / Read / Bash / Glob / Grep / WebFetch / WebSearch), (3) a
 * generic command/output fallback.
 *
 * Ported from OD's `components/ToolCard.tsx` (verified 0 OD product
 * references) — `op-*` classNames and structure kept verbatim (this package
 * ships unstyled semantic markup; a host supplies CSS), every user-facing
 * string wrapped in `useT()`. The legacy `AskUserQuestion` read-only-history
 * card and its `op-generic`-shaped answer-recovery parsing are intentionally
 * NOT ported: that mechanism only exists in OD's persisted chat history
 * pre-dating the `<question-form>` flow, which is out of scope for a fresh
 * `@jini-ai/chat-react` consumer — an unrecognized tool name (including
 * `AskUserQuestion`) falls through to `GenericCard`, which is a correct,
 * generic rendering for it.
 */
import { createContext, useContext, useId, useMemo, useState, type ReactNode } from 'react';
import type { AgentEvent, ToolResultMediaBlock } from '../../core/index.js';
import { COLLAPSED_DETAIL_MAX_CHARS, describeCollapsedToolCall, describeToolCallDetail, humanizeToolName, isDelegatedWrapperToolName, isTodoWriteToolName, parseTodoWriteInput, redactUserText, toRenderProps } from '../../core/index.js';
import { useT, useToolRendererRegistry } from '../hooks/context.js';
import type { ToolRendererRegistry } from '../tool-renderer-registry.js';
import { Icon } from './Icon.js';
import { SAFE_LINK_HREF } from './Markdown.js';
import { TodoCard } from './TodoCard.js';
import { toolRowTarget } from './ToolCard.rules.js';
import { toolPresentation, type ToolPresentation } from '../../core/tool-presentation.js';

type ToolUseEvent = Extract<AgentEvent, { kind: 'tool_use' }>;
type ToolResultEvent = Extract<AgentEvent, { kind: 'tool_result' }>;

export interface ToolCardProps {
  use: ToolUseEvent;
  result?: ToolResultEvent | undefined;
  /** Whether the owning run is still streaming. Forwarded to registered renderers via `status`. */
  runStreaming?: boolean;
  /** Whether the owning run reached a successful terminal status. Missing tool results in a succeeded run render as done. */
  runSucceeded?: boolean;
  /** Basenames known to exist in the host's project/workspace — gates the "open" affordance on file-shaped tools. Omit to always show it. */
  projectFileNames?: Set<string>;
  /** Lifts a basename up to the host so it can focus the matching tab in its own file viewer. */
  onRequestOpenFile?: (name: string) => void;
  /** A later call of the same tool in this turn succeeded (`retriedToolRowIds`): a failure shows a neutral "Retried" badge, not red. */
  retried?: boolean;
}

/**
 * Read by `ErrorBadge` only. A context, not one more prop threaded through every family card,
 * because each card renders its own badge and all of them must agree.
 */
const RetriedContext = createContext(false);

/** A Jini registry tool id: dotted, lowercase, snake_case segments — `page.fill`, `daemon.db.vacuum`, `chat.send_message`. Never matches an agent-vendor tool name (`Bash`, `Write`, `mcp__jini__execute_delegated_tool`), which is the point — this is how a canonical delegated-tool event is told apart from everything else. */
const JINI_TOOL_ID_PATTERN = /^[a-z][a-z_]*(\.[a-z][a-z_]*)+$/;

export function ToolCard({ use, result, runStreaming, runSucceeded, projectFileNames, onRequestOpenFile, retried = false }: ToolCardProps) {
  const registry = useToolRendererRegistry();
  // Resolve vendor dialects for rendering only; tool ids and stored events stay intact.
  const presentation = toolPresentation(use);
  use = { ...use, ...presentation };
  const name = use.name;
  const card: CardProps = { input: use.input, result: result, runStreaming: runStreaming ?? false, runSucceeded: runSucceeded ?? false };
  const content = renderToolCardBody({ use, card, wrapper: presentation.wrapper, fileCtx: { projectFileNames, onRequestOpenFile }, registry });
  if (content === null) return null;
  // Tagged once here, at the single dispatch point every branch below funnels through, rather than
  // in each of the dozen card variants — one place to keep correct, and every variant (including a
  // host's own custom-registered renderer) gets it automatically. `use.id` is this tool call's own
  // stable identifier (unique per call within a message), never reused, so this handle is never
  // ambiguous the way a repeated literal handle would be.
  return (
    <div data-agent-element={`tool-call-${use.id}`} data-agent-role="region" data-agent-label={`A ${humanizeToolName({ name: name })} tool call the AI made`}>
      <RetriedContext.Provider value={retried}>{content}</RetriedContext.Provider>
    </div>
  );
}

interface ToolCardBodyArgs {
  use: ToolUseEvent;
  card: CardProps;
  fileCtx: FileToolCtx;
  registry: ToolRendererRegistry;
  wrapper?: ToolPresentation['wrapper'];
}

type FamilyCardRender = (card: CardProps, fileCtx: FileToolCtx) => ReactNode;

// Hardcoded family cards for tools shipped with this package, keyed by every name each tool goes
// by. A `Map`, not an object literal, so a tool named `constructor`/`toString` can never resolve
// to an inherited `Object.prototype` member.
const FAMILY_CARDS: ReadonlyMap<string, FamilyCardRender> = new Map(
  ([
    [['Write', 'write', 'create_file'], (card, fileCtx) => <FileWriteCard {...card} ctx={fileCtx} />],
    [['Edit', 'str_replace_edit'], (card, fileCtx) => <FileEditCard {...card} ctx={fileCtx} />],
    [['Read', 'read_file'], (card, fileCtx) => <FileReadCard {...card} ctx={fileCtx} />],
    [['Bash'], (card) => <BashCard {...card} />],
    [['Glob', 'list_files'], (card) => <GlobCard {...card} />],
    [['Grep'], (card) => <GrepCard {...card} />],
    [['WebFetch', 'web_fetch'], (card) => <WebFetchCard {...card} />],
    [['WebSearch', 'web_search'], (card) => <WebSearchCard {...card} />],
    [['search_tools', 'mcp__jini__search_tools'], (card) => <SearchToolsCard {...card} />],
    [['describe_tool', 'mcp__jini__describe_tool'], (card) => <DescribeToolCard {...card} />],
  ] satisfies [string[], FamilyCardRender][]).flatMap(([names, render]) => names.map((name) => [name, render] as const)),
);

/** A host-registered renderer's output, or `undefined` when none is registered, it renders nothing, or it throws (logged) — every one of those falls back to the built-in cards. */
function renderRegistered({ use, card, registry }: ToolCardBodyArgs): ReactNode {
  const custom = registry.get({ name: use.name });
  if (!custom) return undefined;
  try {
    const node = custom(toRenderProps({ use: use, result: card.result, runStreaming: card.runStreaming }, { runSucceeded: card.runSucceeded }));
    if (node !== undefined && node !== null && node !== false) return node;
  } catch (err) {
    console.error(`[ToolCard] custom renderer for "${use.name}" threw; falling back`, formatErrorForLog({ error: err }));
  }
  return undefined;
}

function renderToolCardBody(args: ToolCardBodyArgs): ReactNode {
  const custom = renderRegistered(args);
  if (custom !== undefined) return custom;

  const { use, card, fileCtx } = args;
  const name = use.name;
  // `execute_delegated_tool` is a transport wrapper: `@jini-ai/daemon`'s `delegated-tool-bridge.ts`
  // always emits a second, canonical `tool_use` named after the real Jini tool id (`page.fill`,
  // not `execute_delegated_tool`) alongside it — before calling `ToolExecutor`, so it exists even
  // when the call fails at the tool-execution layer. Showing both floods the pane with the same
  // action twice. Suppressed only on a *successful* result: a wrapper-level failure (a genuine
  // transport error, not a tool-execution failure — those come back as a normal 'completed' result
  // with status:'failed' inside it) has no matching canonical row to fall back on, so it must stay
  // visible rather than disappear silently. (A wrapper that failed AFTER the bridge emitted its
  // canonical row — e.g. a 400 on a refused input — never reaches here when rendered through
  // `useToolTimeline`: `foldDelegatedWrapperCalls` drops it in favour of that canonical row. This
  // check still covers a host that renders `<ToolCard>` straight from raw events.)
  // Covers the read-only gateway (`execute_readonly_delegated_tool`) too.
  // An outer transport receipt may have no bridge row; keep its inner call visible.
  if (!args.wrapper && isDelegatedWrapperToolName({ name: name }) && card.result && !card.result.isError) return null;

  if (isTodoWriteToolName({ name: name })) return <TodoCard todos={parseTodoWriteInput({ input: use.input })} runStreaming={card.runStreaming} />;
  // Jini tool ids are dotted and wrapper names are `execute_*delegated_tool`, so neither ever
  // collides with a family name — the search/describe cards can sit in the same table as the rest
  // even though they are looked up ahead of the Jini-id check below.
  const family = FAMILY_CARDS.get(name);
  if (family) return family(card, fileCtx);
  if (JINI_TOOL_ID_PATTERN.test(name) || isDelegatedWrapperToolName({ name: name })) {
    // The unsuppressed (failed-wrapper) case falls through here too: `name` is still
    // `execute_delegated_tool`, so `jiniToolIdFromInput` recovers the real id from
    // `{toolId, input}` instead of `DelegatedToolCard` receiving its own wrapper name as the title.
    return <DelegatedToolCard name={name} {...card} />;
  }
  return <GenericCard name={name} {...card} />;
}

/**
 * The head every Jini/MCP/unknown tool row shares: status, "<Humanized Name>" (announced as
 * "Tool call · <Humanized Name>"), and the
 * target ({@link toolRowTarget}). One place, so a tool id the family table doesn't know (`content_post_update`,
 * `mcp__acme__theme_list_files`) still reads as a label and never as its raw name and JSON args.
 */
function ToolRowHead({ name, input, result, runStreaming, runSucceeded }: CardProps & { name: string }) {
  const t = useT();
  // Streaming deltas recreate result envelopes; parse only when the target's inputs change.
  // A failed event's payload describes the error even when it contains human-looking names.
  const resultContent = result?.content;
  const resultIsError = result?.isError;
  const target = useMemo(() => toolRowTarget({ input: input, resultContent: resultIsError ? undefined : resultContent }), [input, resultContent, resultIsError]);
  const summary = target ? headSummary({ text: target }) : undefined;
  const prefix = `${t('Tool call')} · `;
  const toolName = humanizeToolName({ name: name });
  const isRunning = runStreaming && !result;
  // Name and target each carry their full text as a tooltip: on a narrow dock the name truncates
  // first and the target is capped (styles.ts `.op-title`/`.op-meta`), so either can be cut.
  // The "Tool call · " prefix is visually hidden (owner bug 11-01: it took half a ~333px dock row, so
  // names read "Tool call · Cont…") but stays in the row's accessible name. The name's tooltip must
  // not repeat it: trees that read a child's title before its text announced "Tool call · Tool call ·".
  return (
    <>
      <ResultBadge result={result} runStreaming={runStreaming} runSucceeded={runSucceeded} />
      <span className="op-sr-prefix">{prefix}</span>
      <span className={`op-title${isRunning ? RUNNING_TITLE_CLASS : ''}`} title={toolName}>{toolName}</span>
      {summary ? <span className="op-meta op-target" title={summary}>{summary}</span> : null}
    </>
  );
}

interface DelegatedToolCardProps extends CardProps {
  name: string;
}

/**
 * A card for one `page.*`/`daemon.db.*`/`chat.*`/… call — the canonical event
 * `delegated-tool-bridge.ts` emits, named after the real Jini tool id. Collapsed by default with a
 * title of the shape "Tool call · Page Fill · signup-name-input", matching every other card's
 * accordion pattern rather than the raw `execute_delegated_tool{"toolId":...,"input":{...}}` JSON
 * blob this replaces.
 */
function DelegatedToolCard({ name, input, result, runStreaming, runSucceeded }: DelegatedToolCardProps) {
  // Wrapper form (only reached on a failed wrapper call, per ToolCard's suppression comment):
  // the real id and args are nested under {toolId, input}, not `input` itself.
  const wrapper = (input ?? {}) as { toolId?: string; input?: unknown };
  const toolId = isDelegatedWrapperToolName({ name: name }) ? (wrapper.toolId ?? name) : name;
  const args = isDelegatedWrapperToolName({ name: name }) ? wrapper.input : input;
  return (
    <ExpandableCard
      className="op-jini-tool"
      call={{ input: args ?? {}, result: result, runStreaming: runStreaming, runSucceeded: runSucceeded }}
      head={<ToolRowHead name={toolId} input={args} result={result} runStreaming={runStreaming} runSucceeded={runSucceeded} />}
      after={<FileErrorDetail result={result} />}
    >
      <ToolCallDetail input={args ?? {}} result={result} runStreaming={runStreaming} runSucceeded={runSucceeded}>
        <ToolResultMedia result={result} />
      </ToolCallDetail>
    </ExpandableCard>
  );
}

function SearchToolsCard({ input, result, runStreaming, runSucceeded }: CardProps) {
  const t = useT();
  const obj = (input ?? {}) as { query?: string; limit?: number };
  const isRunning = runStreaming && !result;
  return (
    <ExpandableCard
      className="op-jini-tool"
      call={{ input: input, result: result, runStreaming: runStreaming, runSucceeded: runSucceeded }}
      head={
        <>
          <ResultBadge result={result} runStreaming={runStreaming} runSucceeded={runSucceeded} />
          <span className={`op-title${isRunning ? RUNNING_TITLE_CLASS : ''}`}>{t('Search tools')}</span>
          {obj.query ? <span className="op-meta">{obj.query}</span> : null}
        </>
      }
      after={<FileErrorDetail result={result} />}
    >
      <ToolCallDetail input={input} result={result} runStreaming={runStreaming} runSucceeded={runSucceeded} />
    </ExpandableCard>
  );
}

function DescribeToolCard({ input, result, runStreaming, runSucceeded }: CardProps) {
  const t = useT();
  const obj = (input ?? {}) as { id?: string };
  const isRunning = runStreaming && !result;
  return (
    <ExpandableCard
      className="op-jini-tool"
      call={{ input: input, result: result, runStreaming: runStreaming, runSucceeded: runSucceeded }}
      head={
        <>
          <ResultBadge result={result} runStreaming={runStreaming} runSucceeded={runSucceeded} />
          <span className={`op-title${isRunning ? RUNNING_TITLE_CLASS : ''}`}>{t('Describe tool')}</span>
          {obj.id ? <span className="op-meta">{obj.id}</span> : null}
        </>
      }
      after={<FileErrorDetail result={result} />}
    >
      <ToolCallDetail input={input} result={result} runStreaming={runStreaming} runSucceeded={runSucceeded} />
    </ExpandableCard>
  );
}

interface FileToolCtx {
  projectFileNames?: Set<string> | undefined;
  onRequestOpenFile?: ((name: string) => void) | undefined;
}

function OpenInTabButton({ filePath, ctx }: { filePath: string; ctx: FileToolCtx }) {
  const t = useT();
  if (!ctx.onRequestOpenFile) return null;
  if (!filePath || filePath === '(unnamed)') return null;
  // `String.prototype.split` always returns a non-empty array, so `.pop()` on it can
  // never be `undefined` here — the `??` fallback TS's return type demands is dead code.
  const baseName = filePath.split('/').pop()!;
  if (!baseName) return null;
  if (ctx.projectFileNames && !ctx.projectFileNames.has(baseName)) return null;
  const open = ctx.onRequestOpenFile;
  return (
    <button type="button" className="op-open" onClick={() => open(baseName)} title={t('Open {name} in a tab', { name: baseName })}>
      {t('Open')}
    </button>
  );
}

interface CardProps {
  input: unknown;
  result?: ToolResultEvent | undefined;
  runStreaming: boolean;
  runSucceeded: boolean;
}

function FileWriteCard({ input, result, runStreaming, runSucceeded, ctx }: CardProps & { ctx: FileToolCtx }) {
  const t = useT();
  const obj = (input ?? {}) as { file_path?: string; filePath?: string; path?: string; content?: string };
  const file = obj.file_path ?? obj.filePath ?? obj.path ?? '(unnamed)';
  // See OpenInTabButton's baseName comment: `.split('/').pop()` is never undefined.
  const baseName = file.split('/').pop()!;
  const lines = typeof obj.content === 'string' ? obj.content.split('\n').length : null;
  const isRunning = runStreaming && !result;
  return (
    <ExpandableCard
      className="op-file"
      call={{ input: input, result: result, runStreaming: runStreaming, runSucceeded: runSucceeded }}
      head={
        <>
            <ResultBadge result={result} runStreaming={runStreaming} runSucceeded={runSucceeded} />
            <span className={`op-title${isRunning ? RUNNING_TITLE_CLASS : ''}`}>{t('Write')}</span>
            <span className="op-meta">
              {baseName}
              {lines !== null ? ` · ${t('{n} lines', { n: lines })}` : ''}
            </span>
        </>
      }
      after={<FileErrorDetail result={result} />}
    >
      <div className="op-card-detail op-card-file-detail">
        <code className="op-path">{file}</code>
        <OpenInTabButton filePath={file} ctx={ctx} />
      </div>
      <ToolCallDetail input={input} result={result} runStreaming={runStreaming} runSucceeded={runSucceeded} />
    </ExpandableCard>
  );
}

function FileEditCard({ input, result, runStreaming, runSucceeded, ctx }: CardProps & { ctx: FileToolCtx }) {
  const t = useT();
  const obj = (input ?? {}) as { file_path?: string; filePath?: string; path?: string; edits?: { old_string?: string; new_string?: string }[] };
  const file = obj.file_path ?? obj.filePath ?? obj.path ?? '(unnamed)';
  // See OpenInTabButton's baseName comment: `.split('/').pop()` is never undefined.
  const baseName = file.split('/').pop()!;
  const editCount = Array.isArray(obj.edits) ? obj.edits.length : 1;
  const isRunning = runStreaming && !result;
  return (
    <ExpandableCard
      className="op-file"
      call={{ input: input, result: result, runStreaming: runStreaming, runSucceeded: runSucceeded }}
      head={
        <>
            <ResultBadge result={result} runStreaming={runStreaming} runSucceeded={runSucceeded} />
            <span className={`op-title${isRunning ? RUNNING_TITLE_CLASS : ''}`}>{t('Edit')}</span>
            <span className="op-meta">
              {baseName} · {editCount} {editCount === 1 ? t('change') : t('changes')}
            </span>
        </>
      }
      after={<FileErrorDetail result={result} />}
    >
      <div className="op-card-detail op-card-file-detail">
        <code className="op-path">{file}</code>
        <OpenInTabButton filePath={file} ctx={ctx} />
      </div>
      <ToolCallDetail input={input} result={result} runStreaming={runStreaming} runSucceeded={runSucceeded} />
    </ExpandableCard>
  );
}

function FileReadCard({ input, result, runStreaming, runSucceeded, ctx }: CardProps & { ctx: FileToolCtx }) {
  const t = useT();
  const obj = (input ?? {}) as { file_path?: string; filePath?: string; path?: string; offset?: unknown };
  const file = obj.file_path ?? obj.filePath ?? obj.path ?? '(unnamed)';
  // See OpenInTabButton's baseName comment: `.split('/').pop()` is never undefined.
  const baseName = toolRowTarget({ input: { path: file.split('/').pop()!, offset: obj.offset } });
  const isRunning = runStreaming && !result;
  return (
    <ExpandableCard
      className="op-file"
      call={{ input: input, result: result, runStreaming: runStreaming, runSucceeded: runSucceeded }}
      head={
        <>
            <ResultBadge result={result} runStreaming={runStreaming} runSucceeded={runSucceeded} />
            <span className={`op-title${isRunning ? RUNNING_TITLE_CLASS : ''}`}>{t('Read')}</span>
            <span className="op-meta">{baseName}</span>
        </>
      }
      after={<FileErrorDetail result={result} />}
    >
      <div className="op-card-detail op-card-file-detail">
        <code className="op-path">{file}</code>
        <OpenInTabButton filePath={file} ctx={ctx} />
      </div>
      <ToolCallDetail input={input} result={result} runStreaming={runStreaming} runSucceeded={runSucceeded} />
    </ExpandableCard>
  );
}

function BashCard({ input, result, runStreaming, runSucceeded }: CardProps) {
  const t = useT();
  const obj = (input ?? {}) as { command?: string; description?: string };
  const command = obj.command ?? '';
  const desc = obj.description;
  const isRunning = runStreaming && !result;
  return (
    <ExpandableCard
      className="op-bash"
      call={{ input: input, result: result, runStreaming: runStreaming, runSucceeded: runSucceeded }}
      head={
        <>
            <ResultBadge result={result} runStreaming={runStreaming} runSucceeded={runSucceeded} />
            <span className={`op-title${isRunning ? RUNNING_TITLE_CLASS : ''}`}>{t('Bash')}</span>
            {desc ? <span className="op-meta op-desc">{desc}</span> : null}
        </>
      }
    >
      <ToolCallDetail input={command} result={result} runStreaming={runStreaming} runSucceeded={runSucceeded} />
    </ExpandableCard>
  );
}

function GlobCard({ input, result, runStreaming, runSucceeded }: CardProps) {
  const t = useT();
  const obj = (input ?? {}) as { pattern?: string; path?: string };
  return (
    <ExpandableCard
      className="op-search"
      call={{ input: input, result: result, runStreaming: runStreaming, runSucceeded: runSucceeded }}
      head={
        <>
          <ResultBadge result={result} runStreaming={runStreaming} runSucceeded={runSucceeded} />
          <span className="op-title">{t('Search files')}</span>
          <span className="op-meta">
            {obj.pattern ?? '*'}
            {obj.path ? ` in ${obj.path}` : ''}
          </span>
        </>
      }
    >
      <ToolCallDetail input={input} result={result} runStreaming={runStreaming} runSucceeded={runSucceeded} />
    </ExpandableCard>
  );
}

function GrepCard({ input, result, runStreaming, runSucceeded }: CardProps) {
  const t = useT();
  const obj = (input ?? {}) as { pattern?: string; path?: string };
  return (
    <ExpandableCard
      className="op-search"
      call={{ input: input, result: result, runStreaming: runStreaming, runSucceeded: runSucceeded }}
      head={
        <>
          <ResultBadge result={result} runStreaming={runStreaming} runSucceeded={runSucceeded} />
          <span className="op-title">{t('Search content')}</span>
          <span className="op-meta">
            {obj.pattern ?? ''}
            {obj.path ? ` in ${obj.path}` : ''}
          </span>
        </>
      }
    >
      <ToolCallDetail input={input} result={result} runStreaming={runStreaming} runSucceeded={runSucceeded} />
    </ExpandableCard>
  );
}

function WebFetchCard({ input, result, runStreaming, runSucceeded }: CardProps) {
  const t = useT();
  const obj = (input ?? {}) as { url?: string };
  return (
    <ExpandableCard
      className="op-web"
      call={{ input: input, result: result, runStreaming: runStreaming, runSucceeded: runSucceeded }}
      head={
        <>
          <ResultBadge result={result} runStreaming={runStreaming} runSucceeded={runSucceeded} />
          <span className="op-title">{t('Fetch')}</span>
          <span className="op-meta">{obj.url ?? ''}</span>
        </>
      }
    >
      <ToolCallDetail input={input} result={result} runStreaming={runStreaming} runSucceeded={runSucceeded} />
    </ExpandableCard>
  );
}

function WebSearchCard({ input, result, runStreaming, runSucceeded }: CardProps) {
  const t = useT();
  const obj = (input ?? {}) as { query?: string };
  return (
    <ExpandableCard
      className="op-web"
      call={{ input: input, result: result, runStreaming: runStreaming, runSucceeded: runSucceeded }}
      head={
        <>
          <ResultBadge result={result} runStreaming={runStreaming} runSucceeded={runSucceeded} />
          <span className="op-title">{t('Search')}</span>
          <span className="op-meta">{obj.query ?? ''}</span>
        </>
      }
    >
      <ToolCallDetail input={input} result={result} runStreaming={runStreaming} runSucceeded={runSucceeded} />
    </ExpandableCard>
  );
}

/** Any tool this package has no family card for — an MCP tool, or a card tool such as `assistant_ask_choice` whose form renders elsewhere in the turn. The row still opens to the full call. */
function GenericCard({ name, input, result, runStreaming, runSucceeded }: CardProps & { name: string }) {
  return (
    <ExpandableCard
      className="op-generic"
      call={{ input: input, result: result, runStreaming: runStreaming, runSucceeded: runSucceeded }}
      head={<ToolRowHead name={name} input={input} result={result} runStreaming={runStreaming} runSucceeded={runSucceeded} />}
      after={<ToolResultMedia result={result} />}
    >
      <ToolCallDetail input={input} result={result} runStreaming={runStreaming} runSucceeded={runSucceeded} />
    </ExpandableCard>
  );
}

/**
 * The one row shell every card shares: a real `<button>` head (Enter/Space toggle it) that reports
 * `aria-expanded` and points `aria-controls` at its panel. The panel's `children` mount only while
 * open: a long chat mounts hundreds of collapsed rows, and keeping every full detail mounted made a
 * 38-message chat carry ~13k DOM nodes and 3.45 MB of hidden text. Collapsed, the card holds one
 * screen-reader node outside the collapsed panel with the call's capped gist instead, so a
 * `page.*` DOM reader can inspect the same public text without anyone clicking.
 * `after` renders outside the panel, for content that must stay visible collapsed (an error, media).
 */
function ExpandableCard({ className, head, after, call, children }: { className: string; head: ReactNode; after?: ReactNode; call: CardProps; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className={`op-card ${className}`}>
      <button type="button" className="op-card-head" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((o) => !o)}>
        {head}
        <span className="op-expand-chev" aria-hidden>
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={11} />
        </span>
      </button>
      <div id={panelId} className={`accordion-collapsible${open ? ' open' : ''}`}>
        {open ? <div className="accordion-collapsible-inner">{children}</div> : null}
      </div>
      {open ? null : <CollapsedReaderText call={call} />}
      {after}
    </div>
  );
}

/** The collapsed row's stand-in for its panel — see {@link ExpandableCard} and `describeCollapsedToolCall`. */
function CollapsedReaderText({ call }: { call: CardProps }) {
  const input = call.input;
  const resultContent = call.result?.content;
  const resultIsError = call.result?.isError ?? false;
  // Streaming deltas recreate envelopes; only changed reader text needs formatting/redaction.
  // Run state explains a missing result, but cannot change the text of a recorded result.
  const runStreaming = !call.result && call.runStreaming;
  const runSucceeded = !call.result && call.runSucceeded;
  const text = useMemo(() => describeCollapsedToolCall(
    { input, result: resultContent === undefined ? undefined : { content: resultContent, isError: resultIsError } },
    { runStreaming, runSucceeded },
  ), [input, resultContent, resultIsError, runStreaming, runSucceeded]);
  return <span className="op-card-reader-text op-sr-prefix">{text}</span>;
}

/** The call's input, its result (or why there is none), and any extra `children` — see `describeToolCallDetail` for the redaction and formatting rules. */
function ToolCallDetail({ input, result, runStreaming, runSucceeded, children }: CardProps & { children?: ReactNode }) {
  const t = useT();
  // Only mounted on expansion: keep the compact preview cheap without losing any of the stored
  // call when the person opens it. The core formatter still owns formatting and secret redaction.
  const detail = describeToolCallDetail({ input: input, result: result }, { runStreaming: runStreaming, runSucceeded: runSucceeded, maxChars: Infinity });
  return (
    <div className="op-card-detail">
      {detail.inputText !== null ? <pre className="op-command op-input">{detail.inputText}</pre> : null}
      {detail.outputText !== null ? <pre className="op-output">{detail.outputText}</pre> : null}
      {detail.noteKey !== null ? <p className="op-detail-note">{t(detail.noteKey)}</p> : null}
      {children}
    </div>
  );
}

/** A failed result: neutral "Retried" when a later call of the same tool succeeded, else red. */
function ErrorBadge({ result }: { result: ToolResultEvent }) {
  const t = useT();
  if (useContext(RetriedContext))
    return (
      <span className="op-status op-status-retried" title={t('Retried')}>
        <Icon name="retry" size={14} />
      </span>
    );
  return (
    <span className="op-status op-status-error" title={describeToolCallDetail({ input: null, result }, { maxChars: COLLAPSED_DETAIL_MAX_CHARS }).outputText ?? t('Error')}>
      <Icon name="close" size={14} />
    </span>
  );
}

function ResultBadge({ result, runStreaming, runSucceeded }: { result?: ToolResultEvent | undefined; runStreaming: boolean; runSucceeded: boolean }) {
  const t = useT();
  if (!result && runStreaming)
    return (
      <span className="op-status op-status-running" title={t('Running')}>
        <Icon name="spinner" size={14} />
      </span>
    );
  if (!result && !runSucceeded)
    return (
      <span className="op-status op-status-error" title={t('Error')}>
        <Icon name="close" size={14} />
      </span>
    );
  if (result?.isError) return <ErrorBadge result={result} />;
  return (
    <span className="op-status op-status-ok" title={t('Done')}>
      <Icon name="check" size={14} />
    </span>
  );
}

/**
 * Renders the `image` blocks a tool result's `media` field carries — the one media type this slice
 * proves end to end (`ToolResultMediaBlock`'s `text` arm is never collected into `media` in the
 * first place; see `@jini-ai/daemon`'s `tool-result-media.ts`, so there is nothing to render for
 * it). `null` for the overwhelming majority of results, which carry no `media` at all — every
 * existing card that renders this stays visually unchanged.
 *
 * Styled only with an inline `max-width` safety net, not a class-driven layout: this package ships
 * unstyled semantic markup (this module's own header) and a host supplies CSS via `.op-media`/
 * `.op-media-image`. Without the inline rule, a handler-supplied image at its native pixel size
 * could blow out the card's width before any host stylesheet loads.
 */
function ToolResultMedia({ result }: { result?: ToolResultEvent | undefined }) {
  const blocks = result?.media;
  if (!blocks || blocks.length === 0) return null;
  const images = blocks.filter((block): block is ToolResultImage => block.type === 'image');
  if (images.length === 0) return null;
  return (
    <div className="op-media">
      {images.map((block, index) => <ToolResultImageFigure key={index} block={block} />)}
    </div>
  );
}

type ToolResultImage = Extract<ToolResultMediaBlock, { type: 'image' }>;

/**
 * One tool image: captioned by its `title` (also the alt text) and linked to its `href` in a new
 * tab, so a picture a tool just saved opens full size. The href is tool output, so it gets the same
 * safe-target rule as chat links (`Markdown.tsx`); `javascript:`/`data:` stays an unlinked image.
 */
function ToolResultImageFigure({ block }: { block: ToolResultImage }) {
  const img = (
    <img
      className="op-media-image"
      src={`data:${block.mimeType};base64,${block.data}`}
      alt={block.title ?? ''}
      style={{ maxWidth: '100%', height: 'auto', display: 'block' }}
    />
  );
  const linked = block.href !== undefined && SAFE_LINK_HREF.test(block.href) && !block.href.startsWith('#')
    ? <a className="op-media-link" href={block.href} target="_blank" rel="noopener noreferrer">{img}</a>
    : img;
  if (block.title === undefined) return linked;
  return (
    // No host stylesheet styles op-media yet; reset the UA figure margin (40px sides) inline, like the img.
    <figure className="op-media-figure" style={{ margin: 0 }}>
      {linked}
      <figcaption className="op-media-caption">{block.title}</figcaption>
    </figure>
  );
}

function FileErrorDetail({ result }: { result?: ToolResultEvent | undefined }) {
  if (!result?.isError) return null;
  // This block and the badge tooltip stay mounted even when collapsed. Share the reader's cap
  // and redactor so large failures cannot retain their full output in those alternate DOM sinks.
  const detail = describeToolCallDetail({ input: null, result }, { maxChars: COLLAPSED_DETAIL_MAX_CHARS });
  return detail.outputText === null ? null : <pre className="op-output">{detail.outputText}</pre>;
}

/**
 * A head's one-line summary of an arbitrary argument. Heads stay mounted for every collapsed row,
 * and the fallback argument can be a 20k-char payload or a key, so it gets the reader text's
 * order: redact first (a cut could split a key past its pattern), then cap.
 */
function headSummary({ text }: { text: string }): string {
  return truncate(redactUserText({ text: text }).text, 200);
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}
