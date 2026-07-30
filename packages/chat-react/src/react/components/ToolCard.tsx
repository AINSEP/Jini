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
import { useState, type ReactNode } from 'react';
import type { AgentEvent } from '@jini-ai/chat-core';
import { isTodoWriteToolName, parseTodoWriteInput, toRenderProps } from '@jini-ai/chat-core';
import { useT } from '../hooks/context.js';
import { getToolRenderer } from '../../tool-renderer-registry.js';
import { Icon } from './Icon.js';
import { TodoCard } from './TodoCard.js';

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
}

/** A Jini registry tool id: dotted, lowercase, snake_case segments — `page.fill`, `daemon.db.vacuum`, `chat.send_message`. Never matches an agent-vendor tool name (`Bash`, `Write`, `mcp__jini__execute_delegated_tool`), which is the point — this is how a canonical delegated-tool event is told apart from everything else. */
const JINI_TOOL_ID_PATTERN = /^[a-z][a-z_]*(\.[a-z][a-z_]*)+$/;

const EXECUTE_DELEGATED_TOOL_NAMES = new Set(['execute_delegated_tool', 'mcp__jini__execute_delegated_tool']);
const SEARCH_TOOLS_NAMES = new Set(['search_tools', 'mcp__jini__search_tools']);
const DESCRIBE_TOOL_NAMES = new Set(['describe_tool', 'mcp__jini__describe_tool']);

export function ToolCard({ use, result, runStreaming, runSucceeded, projectFileNames, onRequestOpenFile }: ToolCardProps) {
  const name = use.name;
  const isStreaming = runStreaming ?? false;
  const isSucceeded = runSucceeded ?? false;
  const content = renderToolCardBody(name, use, result, isStreaming, isSucceeded, { projectFileNames, onRequestOpenFile });
  if (content === null) return null;
  // Tagged once here, at the single dispatch point every branch below funnels through, rather than
  // in each of the dozen card variants — one place to keep correct, and every variant (including a
  // host's own custom-registered renderer) gets it automatically. `use.id` is this tool call's own
  // stable identifier (unique per call within a message), never reused, so this handle is never
  // ambiguous the way a repeated literal handle would be.
  return (
    <div data-agent-element={`tool-call-${use.id}`} data-agent-role="region" data-agent-label={`A ${humanizeToolId(name)} tool call the AI made`}>
      {content}
    </div>
  );
}

function renderToolCardBody(
  name: string,
  use: ToolUseEvent,
  result: ToolResultEvent | undefined,
  isStreaming: boolean,
  isSucceeded: boolean,
  fileCtx: FileToolCtx,
): ReactNode {
  const custom = getToolRenderer(name);
  if (custom) {
    try {
      const node = custom(toRenderProps(use, result, isStreaming, isSucceeded));
      if (node !== undefined && node !== null && node !== false) return node;
    } catch (err) {
      console.error(`[ToolCard] custom renderer for "${name}" threw; falling back`, err);
    }
  }

  // `execute_delegated_tool` is a transport wrapper: `@jini-ai/daemon`'s `delegated-tool-bridge.ts`
  // always emits a second, canonical `tool_use` named after the real Jini tool id (`page.fill`,
  // not `execute_delegated_tool`) alongside it — before calling `ToolExecutor`, so it exists even
  // when the call fails at the tool-execution layer. Showing both floods the pane with the same
  // action twice. Suppressed only on a *successful* result: a wrapper-level failure (a genuine
  // transport error, not a tool-execution failure — those come back as a normal 'completed' result
  // with status:'failed' inside it) has no matching canonical row to fall back on, so it must stay
  // visible rather than disappear silently.
  if (EXECUTE_DELEGATED_TOOL_NAMES.has(name) && result && !result.isError) return null;

  if (isTodoWriteToolName(name)) return <TodoCard todos={parseTodoWriteInput(use.input)} runStreaming={isStreaming} />;
  if (name === 'Write' || name === 'write' || name === 'create_file') return <FileWriteCard input={use.input} result={result} runStreaming={isStreaming} runSucceeded={isSucceeded} ctx={fileCtx} />;
  if (name === 'Edit' || name === 'str_replace_edit') return <FileEditCard input={use.input} result={result} runStreaming={isStreaming} runSucceeded={isSucceeded} ctx={fileCtx} />;
  if (name === 'Read' || name === 'read_file') return <FileReadCard input={use.input} result={result} runStreaming={isStreaming} runSucceeded={isSucceeded} ctx={fileCtx} />;
  if (name === 'Bash') return <BashCard input={use.input} result={result} runStreaming={isStreaming} runSucceeded={isSucceeded} />;
  if (name === 'Glob' || name === 'list_files') return <GlobCard input={use.input} result={result} runStreaming={isStreaming} runSucceeded={isSucceeded} />;
  if (name === 'Grep') return <GrepCard input={use.input} result={result} runStreaming={isStreaming} runSucceeded={isSucceeded} />;
  if (name === 'WebFetch' || name === 'web_fetch') return <WebFetchCard input={use.input} result={result} runStreaming={isStreaming} runSucceeded={isSucceeded} />;
  if (name === 'WebSearch' || name === 'web_search') return <WebSearchCard input={use.input} result={result} runStreaming={isStreaming} runSucceeded={isSucceeded} />;
  if (JINI_TOOL_ID_PATTERN.test(name) || EXECUTE_DELEGATED_TOOL_NAMES.has(name)) {
    // The unsuppressed (failed-wrapper) case falls through here too: `name` is still
    // `execute_delegated_tool`, so `jiniToolIdFromInput` recovers the real id from
    // `{toolId, input}` instead of `DelegatedToolCard` receiving its own wrapper name as the title.
    return <DelegatedToolCard name={name} input={use.input} result={result} runStreaming={isStreaming} runSucceeded={isSucceeded} />;
  }
  if (SEARCH_TOOLS_NAMES.has(name)) return <SearchToolsCard input={use.input} result={result} runStreaming={isStreaming} runSucceeded={isSucceeded} />;
  if (DESCRIBE_TOOL_NAMES.has(name)) return <DescribeToolCard input={use.input} result={result} runStreaming={isStreaming} runSucceeded={isSucceeded} />;
  return <GenericCard name={name} input={use.input} result={result} runStreaming={isStreaming} runSucceeded={isSucceeded} />;
}

/** `"page.fill"` -> `"Page Fill"`, `"daemon.db.vacuum"` -> `"Daemon Db Vacuum"`. Cosmetic only — never used to make a routing decision. */
function humanizeToolId(id: string): string {
  return id
    .split('.')
    .map((segment) => segment.split('_').map((word) => (word ? word[0]!.toUpperCase() + word.slice(1) : word)).join(' '))
    .join(' ');
}

/** The one argument that best identifies *what* a call acted on, for the card's collapsed summary — an element handle, a page id, or (for tools with neither) whatever the first string-valued argument is. */
function primaryTarget(input: unknown): string | undefined {
  if (input == null || typeof input !== 'object') return undefined;
  const obj = input as Record<string, unknown>;
  for (const key of ['element', 'page', 'handle', 'toolId', 'id']) {
    const v = obj[key];
    if (typeof v === 'string' && v) return v;
  }
  for (const v of Object.values(obj)) {
    if (typeof v === 'string' && v) return v;
  }
  return undefined;
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
  const t = useT();
  const [open, setOpen] = useState(false);
  // Wrapper form (only reached on a failed wrapper call, per ToolCard's suppression comment):
  // the real id and args are nested under {toolId, input}, not `input` itself.
  const wrapper = (input ?? {}) as { toolId?: string; input?: unknown };
  const toolId = EXECUTE_DELEGATED_TOOL_NAMES.has(name) ? (wrapper.toolId ?? name) : name;
  const args = EXECUTE_DELEGATED_TOOL_NAMES.has(name) ? wrapper.input : input;
  const target = primaryTarget(args);
  const isRunning = runStreaming && !result;
  return (
    <div className="op-card op-jini-tool">
      <button type="button" className="op-card-head" onClick={() => setOpen((o) => !o)}>
        <ResultBadge result={result} runStreaming={runStreaming} runSucceeded={runSucceeded} />
        <span className={`op-title${isRunning ? ' shimmer-text' : ''}`}>{t('Tool call')} · {humanizeToolId(toolId)}</span>
        {target ? <span className="op-meta">{target}</span> : null}
        <span className="op-expand-chev" aria-hidden>
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={11} />
        </span>
      </button>
      <div className={`accordion-collapsible${open ? ' open' : ''}`}>
        <div className="accordion-collapsible-inner">
          <div className="op-card-detail">
            <pre className="op-command">{JSON.stringify(args ?? {})}</pre>
            {result?.content ? <pre className="op-output">{truncate(result.content, 2000)}</pre> : null}
          </div>
        </div>
      </div>
      <FileErrorDetail result={result} />
    </div>
  );
}

function SearchToolsCard({ input, result, runStreaming, runSucceeded }: CardProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const obj = (input ?? {}) as { query?: string; limit?: number };
  const isRunning = runStreaming && !result;
  return (
    <div className="op-card op-jini-tool">
      <button type="button" className="op-card-head" onClick={() => setOpen((o) => !o)}>
        <ResultBadge result={result} runStreaming={runStreaming} runSucceeded={runSucceeded} />
        <span className={`op-title${isRunning ? ' shimmer-text' : ''}`}>{t('Search tools')}</span>
        {obj.query ? <span className="op-meta">{obj.query}</span> : null}
        <span className="op-expand-chev" aria-hidden>
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={11} />
        </span>
      </button>
      <div className={`accordion-collapsible${open ? ' open' : ''}`}>
        <div className="accordion-collapsible-inner">
          <div className="op-card-detail">
            {result?.content ? <pre className="op-output">{truncate(result.content, 2000)}</pre> : null}
          </div>
        </div>
      </div>
      <FileErrorDetail result={result} />
    </div>
  );
}

function DescribeToolCard({ input, result, runStreaming, runSucceeded }: CardProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const obj = (input ?? {}) as { id?: string };
  const isRunning = runStreaming && !result;
  return (
    <div className="op-card op-jini-tool">
      <button type="button" className="op-card-head" onClick={() => setOpen((o) => !o)}>
        <ResultBadge result={result} runStreaming={runStreaming} runSucceeded={runSucceeded} />
        <span className={`op-title${isRunning ? ' shimmer-text' : ''}`}>{t('Describe tool')}</span>
        {obj.id ? <span className="op-meta">{obj.id}</span> : null}
        <span className="op-expand-chev" aria-hidden>
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={11} />
        </span>
      </button>
      <div className={`accordion-collapsible${open ? ' open' : ''}`}>
        <div className="accordion-collapsible-inner">
          <div className="op-card-detail">
            {result?.content ? <pre className="op-output">{truncate(result.content, 2000)}</pre> : null}
          </div>
        </div>
      </div>
      <FileErrorDetail result={result} />
    </div>
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
  const [open, setOpen] = useState(false);
  const obj = (input ?? {}) as { file_path?: string; filePath?: string; path?: string; content?: string };
  const file = obj.file_path ?? obj.filePath ?? obj.path ?? '(unnamed)';
  // See OpenInTabButton's baseName comment: `.split('/').pop()` is never undefined.
  const baseName = file.split('/').pop()!;
  const lines = typeof obj.content === 'string' ? obj.content.split('\n').length : null;
  const isRunning = runStreaming && !result;
  return (
    <div className="op-card op-file">
      <button type="button" className="op-card-head" onClick={() => setOpen((o) => !o)}>
        <ResultBadge result={result} runStreaming={runStreaming} runSucceeded={runSucceeded} />
        <span className={`op-title${isRunning ? ' shimmer-text' : ''}`}>{t('Write')}</span>
        <span className="op-meta">
          {baseName}
          {lines !== null ? ` · ${t('{n} lines', { n: lines })}` : ''}
        </span>
        <span className="op-expand-chev" aria-hidden>
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={11} />
        </span>
      </button>
      <div className={`accordion-collapsible${open ? ' open' : ''}`}>
        <div className="accordion-collapsible-inner">
          <div className="op-card-detail op-card-file-detail">
            <code className="op-path">{file}</code>
            <OpenInTabButton filePath={file} ctx={ctx} />
          </div>
        </div>
      </div>
      <FileErrorDetail result={result} />
    </div>
  );
}

function FileEditCard({ input, result, runStreaming, runSucceeded, ctx }: CardProps & { ctx: FileToolCtx }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const obj = (input ?? {}) as { file_path?: string; filePath?: string; path?: string; edits?: { old_string?: string; new_string?: string }[] };
  const file = obj.file_path ?? obj.filePath ?? obj.path ?? '(unnamed)';
  // See OpenInTabButton's baseName comment: `.split('/').pop()` is never undefined.
  const baseName = file.split('/').pop()!;
  const editCount = Array.isArray(obj.edits) ? obj.edits.length : 1;
  const isRunning = runStreaming && !result;
  return (
    <div className="op-card op-file">
      <button type="button" className="op-card-head" onClick={() => setOpen((o) => !o)}>
        <ResultBadge result={result} runStreaming={runStreaming} runSucceeded={runSucceeded} />
        <span className={`op-title${isRunning ? ' shimmer-text' : ''}`}>{t('Edit')}</span>
        <span className="op-meta">
          {baseName} · {editCount} {editCount === 1 ? t('change') : t('changes')}
        </span>
        <span className="op-expand-chev" aria-hidden>
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={11} />
        </span>
      </button>
      <div className={`accordion-collapsible${open ? ' open' : ''}`}>
        <div className="accordion-collapsible-inner">
          <div className="op-card-detail op-card-file-detail">
            <code className="op-path">{file}</code>
            <OpenInTabButton filePath={file} ctx={ctx} />
          </div>
        </div>
      </div>
      <FileErrorDetail result={result} />
    </div>
  );
}

function FileReadCard({ input, result, runStreaming, runSucceeded, ctx }: CardProps & { ctx: FileToolCtx }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const obj = (input ?? {}) as { file_path?: string; filePath?: string; path?: string };
  const file = obj.file_path ?? obj.filePath ?? obj.path ?? '(unnamed)';
  // See OpenInTabButton's baseName comment: `.split('/').pop()` is never undefined.
  const baseName = file.split('/').pop()!;
  const isRunning = runStreaming && !result;
  return (
    <div className="op-card op-file">
      <button type="button" className="op-card-head" onClick={() => setOpen((o) => !o)}>
        <ResultBadge result={result} runStreaming={runStreaming} runSucceeded={runSucceeded} />
        <span className={`op-title${isRunning ? ' shimmer-text' : ''}`}>{t('Read')}</span>
        <span className="op-meta">{baseName}</span>
        <span className="op-expand-chev" aria-hidden>
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={11} />
        </span>
      </button>
      <div className={`accordion-collapsible${open ? ' open' : ''}`}>
        <div className="accordion-collapsible-inner">
          <div className="op-card-detail op-card-file-detail">
            <code className="op-path">{file}</code>
            <OpenInTabButton filePath={file} ctx={ctx} />
          </div>
        </div>
      </div>
      <FileErrorDetail result={result} />
    </div>
  );
}

function BashCard({ input, result, runStreaming, runSucceeded }: CardProps) {
  const t = useT();
  const obj = (input ?? {}) as { command?: string; description?: string };
  const command = obj.command ?? '';
  const desc = obj.description;
  const [open, setOpen] = useState(false);
  const isRunning = runStreaming && !result;
  return (
    <div className="op-card op-bash">
      <button type="button" className="op-card-head" onClick={() => setOpen((o) => !o)}>
        <ResultBadge result={result} runStreaming={runStreaming} runSucceeded={runSucceeded} />
        <span className={`op-title${isRunning ? ' shimmer-text' : ''}`}>{t('Bash')}</span>
        {desc ? <span className="op-meta op-desc">{desc}</span> : null}
        <span className="op-expand-chev" aria-hidden>
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={11} />
        </span>
      </button>
      <div className={`accordion-collapsible${open ? ' open' : ''}`}>
        <div className="accordion-collapsible-inner">
          <div className="op-card-detail">
            <pre className="op-command">{truncate(command, 400)}</pre>
            {result?.content ? <pre className="op-output">{truncate(result.content, 4000)}</pre> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function GlobCard({ input, result, runStreaming, runSucceeded }: CardProps) {
  const t = useT();
  const obj = (input ?? {}) as { pattern?: string; path?: string };
  return (
    <div className="op-card op-search">
      <div className="op-card-head">
        <ResultBadge result={result} runStreaming={runStreaming} runSucceeded={runSucceeded} />
        <span className="op-title">{t('Search files')}</span>
        <span className="op-meta">
          {obj.pattern ?? '*'}
          {obj.path ? ` in ${obj.path}` : ''}
        </span>
      </div>
    </div>
  );
}

function GrepCard({ input, result, runStreaming, runSucceeded }: CardProps) {
  const t = useT();
  const obj = (input ?? {}) as { pattern?: string; path?: string };
  return (
    <div className="op-card op-search">
      <div className="op-card-head">
        <ResultBadge result={result} runStreaming={runStreaming} runSucceeded={runSucceeded} />
        <span className="op-title">{t('Search content')}</span>
        <span className="op-meta">
          {obj.pattern ?? ''}
          {obj.path ? ` in ${obj.path}` : ''}
        </span>
      </div>
    </div>
  );
}

function WebFetchCard({ input, result, runStreaming, runSucceeded }: CardProps) {
  const t = useT();
  const obj = (input ?? {}) as { url?: string };
  return (
    <div className="op-card op-web">
      <div className="op-card-head">
        <ResultBadge result={result} runStreaming={runStreaming} runSucceeded={runSucceeded} />
        <span className="op-title">{t('Fetch')}</span>
        <span className="op-meta">{obj.url ?? ''}</span>
      </div>
    </div>
  );
}

function WebSearchCard({ input, result, runStreaming, runSucceeded }: CardProps) {
  const t = useT();
  const obj = (input ?? {}) as { query?: string };
  return (
    <div className="op-card op-web">
      <div className="op-card-head">
        <ResultBadge result={result} runStreaming={runStreaming} runSucceeded={runSucceeded} />
        <span className="op-title">{t('Search')}</span>
        <span className="op-meta">{obj.query ?? ''}</span>
      </div>
    </div>
  );
}

function GenericCard({ name, input, result, runStreaming, runSucceeded }: CardProps & { name: string }) {
  const summary = describeInput(input);
  return (
    <div className="op-card op-generic">
      <div className="op-card-head">
        <ResultBadge result={result} runStreaming={runStreaming} runSucceeded={runSucceeded} />
        <span className="op-title">{name}</span>
        {summary ? <span className="op-meta">{truncate(summary, 200)}</span> : null}
      </div>
    </div>
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
  if (result?.isError)
    return (
      <span className="op-status op-status-error" title={result.content || t('Error')}>
        <Icon name="close" size={14} />
      </span>
    );
  return (
    <span className="op-status op-status-ok" title={t('Done')}>
      <Icon name="check" size={14} />
    </span>
  );
}

function FileErrorDetail({ result }: { result?: ToolResultEvent | undefined }) {
  if (!result?.isError || !result.content.trim()) return null;
  return <pre className="op-output">{truncate(result.content, 1200)}</pre>;
}

function describeInput(input: unknown): string {
  if (input == null) return '';
  if (typeof input === 'string') return input;
  if (typeof input !== 'object') return String(input);
  const obj = input as Record<string, unknown>;
  for (const key of ['file_path', 'path', 'pattern', 'url', 'query', 'name', 'command']) {
    const v = obj[key];
    if (typeof v === 'string') return v;
  }
  try {
    return JSON.stringify(obj);
  } catch {
    return '';
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}
