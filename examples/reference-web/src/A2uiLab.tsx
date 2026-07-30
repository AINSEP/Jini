import { useEffect, useMemo, useRef, useState } from 'react';
import { createA2uiInterpreter, createLabCatalog, type A2uiInterpreter } from '@jini-ai/agentic/a2ui';
import { A2uiSurfaceCard, registerExtEventRenderer } from '@jini-ai/ui/chat';

/**
 * A2UI Lab — a real, agent-driven A2UI (a2ui.org v1.0) surface, streamed from the actual Jini
 * daemon through the same durable RunLifecycle every other playground demo uses (see
 * `daemon.ts`'s `runA2uiDemo`), interpreted by `@jini-ai/agentic/a2ui`'s headless interpreter, and rendered
 * by the small React renderer below (Column/Row/Text/Button — the catalog validates all 18 of the
 * real basic catalog's components, but rendering still only draws these 4; see
 * `packages/agentic/source-map.md`'s "Folded from `@jini-ai/a2ui`" section for the renderer-coverage gap). Clicking the button builds a real,
 * spec-shaped `action` envelope and POSTs it to a dedicated relay (`/a2ui-action`, proxied to
 * `daemon.ts`'s `startA2uiActionRelay`), which delivers it back into the running daemon-side demo —
 * a genuine renderer -> agent round trip, not a client-only simulation.
 *
 * `window.__a2uiLab` exposes the live interpreter instance for adversarial testing via
 * `browser_evaluate` (malformed envelopes, cycles, unknown catalog types, etc.) — test-only, not
 * part of the actual product surface.
 */

/**
 * Registered once at module scope (this route's module is bundled eagerly, same as `AgentLab`'s
 * and `McpUiLab`'s — see `main.tsx`), so any page's `ChatPane` renders a live A2UI surface inline
 * whenever a real agent turn emits `type: 'a2ui'` events (`daemon-transport.ts` unwraps those into
 * `kind: 'ext', name: 'a2ui'` events before `ChatPane` ever sees them). `onAgentAction` is
 * deliberately omitted here — see `A2uiSurfaceCard`'s own module doc for why an agent-directed
 * action has nowhere real to go yet outside this fixed lab demo's own `/a2ui-action` relay.
 */
registerExtEventRenderer('a2ui', (props) => <A2uiSurfaceCard {...props} />);

const A2UI_DEMO_AGENT_ID = 'a2ui-demo';

interface RunStatusWire {
  id: string;
}
interface RunResponseWire {
  run: RunStatusWire;
}
interface SseEnvelope {
  kind: string;
  payload: unknown;
}

function encodeA2uiRunContext(): string {
  // The A2UI Lab's contextRef carries no real payload — daemon.ts's onRunStarted dispatches on
  // agentId alone for this demo (see the comment there). A short constant string keeps the
  // request shape symmetric with the playground's own base64url contextRef convention without
  // actually encoding anything meaningful.
  return 'a2ui:lab';
}

function parseSseFrame(frame: string): SseEnvelope | null {
  const data = frame
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (data.length === 0) return null;
  return JSON.parse(data) as SseEnvelope;
}

interface StreamCallbacks {
  onA2uiMessage: (message: unknown) => void;
  onStatus: (label: string) => void;
  onDone: (status: 'succeeded' | 'failed' | 'cancelled') => void;
  onError: (error: Error) => void;
}

async function streamA2uiRun(runId: string, callbacks: StreamCallbacks, signal: AbortSignal): Promise<void> {
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/events`, { signal });
  if (!response.ok) throw new Error(`daemon returned ${response.status} for the A2UI Lab run's event stream`);
  if (!response.body) throw new Error('the daemon returned an empty event stream');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  let reachedEnd = false;

  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffered += decoder.decode(value, { stream: !done }).replaceAll('\r\n', '\n');
      let boundary = buffered.indexOf('\n\n');
      while (boundary >= 0) {
        const frame = buffered.slice(0, boundary);
        buffered = buffered.slice(boundary + 2);
        boundary = buffered.indexOf('\n\n');
        const event = parseSseFrame(frame);
        if (!event) continue;

        if (event.kind === 'agent') {
          const payload = event.payload as { type?: string; label?: string; detail?: string; message?: unknown };
          if (payload.type === 'a2ui') callbacks.onA2uiMessage(payload.message);
          else if (payload.type === 'status') callbacks.onStatus(payload.detail ? `${payload.label ?? ''} — ${payload.detail}` : (payload.label ?? ''));
          continue;
        }
        if (event.kind === 'error') {
          const payload = event.payload as { message?: unknown };
          callbacks.onError(new Error(typeof payload.message === 'string' ? payload.message : 'the A2UI Lab run failed'));
          continue;
        }
        if (event.kind === 'end') {
          const payload = event.payload as { status?: unknown };
          reachedEnd = true;
          callbacks.onDone(payload.status === 'failed' ? 'failed' : payload.status === 'cancelled' ? 'cancelled' : 'succeeded');
        }
      }
      if (done) break;
    }
    if (!reachedEnd && !signal.aborted) throw new Error('the A2UI Lab event stream closed before the run ended');
  } finally {
    reader.releaseLock();
  }
}

async function readApiError(response: Response): Promise<Error> {
  const fallback = `${response.status} ${response.statusText}`.trim();
  try {
    const body = (await response.json()) as { error?: { message?: string }; message?: string };
    return new Error(body.error?.message ?? body.message ?? fallback);
  } catch {
    return new Error(fallback);
  }
}

/** Renders one component and its children by walking the surface's component map from `componentId`, degrading sanely (a visible, inert placeholder, never a crash) for a missing child id or a circular reference — the two adversarial cases `packages/agentic/src/a2ui/tree.ts` is built to answer. Only the static-array `ChildList` form is walked; a template (dynamic-list) `children` value renders a documented "not implemented" placeholder instead of expanding — see `packages/agentic/source-map.md`. */
function RenderComponent({
  interpreter,
  surfaceId,
  componentId,
  ancestors,
  onAction,
}: {
  interpreter: A2uiInterpreter;
  surfaceId: string;
  componentId: string;
  ancestors: ReadonlySet<string>;
  onAction: (componentId: string) => void;
}) {
  if (ancestors.has(componentId)) {
    return (
      <span className="a2ui-placeholder a2ui-placeholder-cycle" data-a2ui-status="cycle" data-a2ui-component-id={componentId}>
        ⟲ circular reference at “{componentId}”
      </span>
    );
  }
  const surface = interpreter.getSurface(surfaceId);
  const component = surface?.components.get(componentId);
  if (!component) {
    return (
      <span className="a2ui-placeholder a2ui-placeholder-missing" data-a2ui-status="missing" data-a2ui-component-id={componentId}>
        ⚠ missing component “{componentId}”
      </span>
    );
  }

  const nextAncestors = new Set(ancestors);
  nextAncestors.add(componentId);
  const childProps = { interpreter, surfaceId, ancestors: nextAncestors, onAction };

  function resolveText(value: unknown): string {
    const result = interpreter.resolve(surfaceId, value as Parameters<A2uiInterpreter['resolve']>[1]);
    if (!result.ok) return `⚠ unresolved (${result.reason})`;
    return typeof result.value === 'string' ? result.value : JSON.stringify(result.value);
  }

  function renderChildList(children: unknown): React.ReactNode {
    if (Array.isArray(children)) {
      return children.map((childId) => <RenderComponent key={String(childId)} componentId={String(childId)} {...childProps} />);
    }
    return (
      <span className="a2ui-placeholder" data-a2ui-status="unimplemented-template-list">
        ⚠ dynamic (template) child lists are not implemented by this port
      </span>
    );
  }

  switch (component.component) {
    case 'Text':
      return (
        <span className={`a2ui-text a2ui-text-${String(component.props.variant ?? 'body')}`} data-a2ui-component-id={componentId}>
          {resolveText(component.props.text)}
        </span>
      );
    case 'Column':
      return (
        <div className="a2ui-column" data-a2ui-component-id={componentId}>
          {renderChildList(component.props.children)}
        </div>
      );
    case 'Row':
      return (
        <div className="a2ui-row" data-a2ui-component-id={componentId}>
          {renderChildList(component.props.children)}
        </div>
      );
    case 'Button':
      return (
        <button
          type="button"
          className={`a2ui-button a2ui-button-${String(component.props.variant ?? 'default')}`}
          data-a2ui-component-id={componentId}
          onClick={() => onAction(componentId)}
        >
          <RenderComponent {...childProps} componentId={String(component.props.child)} />
        </button>
      );
    default:
      // Should be unreachable: `interpreter.applyAgentMessage` already refuses any component type
      // not in the active catalog before it ever reaches the component map (see
      // interpreter.ts's applyComponentsList) — this default case exists as a visible, honest
      // fallback rather than a silent `null` in case that invariant is ever violated.
      return (
        <span className="a2ui-placeholder" data-a2ui-status="unrenderable-type">
          ⚠ no renderer for component type “{component.component}”
        </span>
      );
  }
}

export function A2uiLab() {
  const catalog = useMemo(() => createLabCatalog(), []);
  const interpreterRef = useRef<A2uiInterpreter | null>(null);
  if (!interpreterRef.current) interpreterRef.current = createA2uiInterpreter(catalog);
  const interpreter = interpreterRef.current;

  const [, forceRender] = useState(0);
  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState('Connecting to daemon…');
  const [runState, setRunState] = useState<'starting' | 'streaming' | 'succeeded' | 'failed' | 'cancelled'>('starting');
  const [log, setLog] = useState<string[]>([]);
  const [lastActionError, setLastActionError] = useState<string | null>(null);

  const appendLog = (line: string) => setLog((prev) => [...prev.slice(-49), line]);

  useEffect(() => {
    const unsubscribe = interpreter.subscribe(() => forceRender((n) => n + 1));
    return unsubscribe;
  }, [interpreter]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    async function start() {
      try {
        const response = await fetch('/api/runs', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ contextRef: encodeA2uiRunContext(), agentId: A2UI_DEMO_AGENT_ID }),
          signal: controller.signal,
        });
        if (!response.ok) throw await readApiError(response);
        const body = (await response.json()) as RunResponseWire;
        if (cancelled) return;
        setRunId(body.run.id);
        setRunState('streaming');

        await streamA2uiRun(
          body.run.id,
          {
            onA2uiMessage: (message) => {
              const result = interpreter.applyAgentMessage(message);
              if (result.unattributedViolation) {
                appendLog(`[refused] ${result.unattributedViolation}`);
              } else {
                appendLog(`[a2ui] ${JSON.stringify(message)}`);
                for (const rendererMessage of result.rendererMessages) {
                  appendLog(`[renderer -> agent, local] ${JSON.stringify(rendererMessage)}`);
                }
              }
            },
            onStatus: setStatus,
            onDone: (finalStatus) => {
              if (!cancelled) setRunState(finalStatus);
            },
            onError: (error) => {
              if (!cancelled) {
                setRunState('failed');
                setStatus(error.message);
              }
            },
          },
          controller.signal,
        );
      } catch (error) {
        if (cancelled || controller.signal.aborted) return;
        setRunState('failed');
        setStatus(error instanceof Error ? error.message : 'the A2UI Lab run failed to start');
      }
    }

    void start();
    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one run per mount, matches AgentLab's daemon.ts pattern.
  }, []);

  useEffect(() => {
    (window as unknown as { __a2uiLab?: unknown }).__a2uiLab = { interpreter, catalog, runId, get surfaceId() {
      return runId ? `${runId}-surface` : undefined;
    } };
  }, [interpreter, catalog, runId]);

  async function handleAction(componentId: string) {
    if (!runId) return;
    const surfaceId = `${runId}-surface`;
    const built = interpreter.buildAction(surfaceId, componentId);
    if (!built.ok) {
      setLastActionError(built.reason);
      appendLog(`[action refused] ${built.reason}`);
      return;
    }
    setLastActionError(null);
    if (built.kind === 'local') {
      appendLog(`[local action result] ${JSON.stringify(built.result)}`);
      return;
    }
    appendLog(`[action -> agent] ${JSON.stringify(built.message)}`);
    try {
      const response = await fetch('/a2ui-action', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ runId, message: built.message }),
      });
      if (!response.ok) {
        const error = await readApiError(response);
        setLastActionError(error.message);
        appendLog(`[action relay refused] ${error.message}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'failed to reach the A2UI action relay';
      setLastActionError(message);
      appendLog(`[action relay error] ${message}`);
    }
  }

  const surfaceId = runId ? `${runId}-surface` : null;
  const root = surfaceId ? interpreter.getRoot(surfaceId) : undefined;

  return (
    <main className="a2ui-lab-shell">
      <header className="a2ui-lab-header">
        <div>
          <span className="section-kicker">Jini · A2UI Lab</span>
          <h1>Agent-driven surface</h1>
        </div>
        <a className="quiet-button" href="#/">
          ← Back to Playground
        </a>
      </header>

      <div className="a2ui-lab-body">
        <section className="a2ui-lab-surface" aria-label="A2UI surface">
          {surfaceId && root ? (
            <RenderComponent interpreter={interpreter} surfaceId={surfaceId} componentId="root" ancestors={new Set()} onAction={(id) => void handleAction(id)} />
          ) : (
            <p className="a2ui-lab-waiting">Waiting for the agent to send a root component…</p>
          )}
          {lastActionError ? <p className="a2ui-lab-error">Action refused: {lastActionError}</p> : null}
        </section>

        <aside className="a2ui-lab-inspector">
          <div className="activity-row">
            <span>Run state</span>
            <strong>{runState}</strong>
          </div>
          <div className="activity-row">
            <span>Status</span>
            <strong>{status}</strong>
          </div>
          <div className="activity-row">
            <span>Run id</span>
            <strong>{runId ?? '—'}</strong>
          </div>
          <div className="a2ui-lab-log-title">Message log</div>
          <pre className="a2ui-lab-log">{log.join('\n') || '(nothing yet)'}</pre>
        </aside>
      </div>
    </main>
  );
}
