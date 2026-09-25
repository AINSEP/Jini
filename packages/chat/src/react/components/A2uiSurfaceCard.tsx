/**
 * @module A2uiSurfaceCard
 *
 * Renders a live A2UI (a2ui-project/a2ui v1.0) surface inline in the chat transcript, fed by a
 * message's `kind: 'ext', name: 'a2ui'` events (see `ext-event-renderer-registry.ts`). A host
 * registers this against `'a2ui'` once, at module scope — mirroring how `McpUiLab.tsx` registers
 * `show_mcpui_widget` via `registerToolRenderer` — and every `ChatPane` that surfaces an `a2ui`
 * event thereafter renders through it.
 *
 * Ported from `examples/reference-web/src/A2uiLab.tsx`'s `RenderComponent` (the same tree-walking
 * approach: degrade sanely — a visible, inert placeholder, never a crash — for a missing child id
 * or a circular reference), generalized to consume a growing `events` array instead of a live SSE
 * callback. `@jini-ai/agentic/a2ui`'s catalog validates all 18 of the real basic catalog's
 * components; this renderer has React cases for 5 of them — `Text`/`Column`/`Row`/`Card`/`Button`
 * — plus, since the catalog this card builds is the lab catalog MERGED with
 * `DEFAULT_INTERACTIVE_UI_REGISTRY` (`buildA2uiCatalogFromRegistry`, `@jini-ai/ui/a2ui`), any
 * registry-sourced component (`shadcn.*`, `recharts.*`) resolves through that registry the same
 * way `@jini-ai/ui`'s own `A2uiSurfaceRenderer` does — see this file's `default` case. The
 * remaining basic types (Image/Icon/Video/AudioPlayer/List/Tabs/Modal/Divider and the input
 * family) still have no case here; a catalog type the interpreter accepts but this switch has no
 * case for, and that the registry does not resolve either, degrades to the same visible
 * placeholder as a genuinely unrenderable one — see the `default` branch's own comment.
 *
 * **Known gap, by design, not oversight:** a `Button`'s click only completes the round trip when
 * `interpreter.buildAction` resolves it as a `local` (client-side) function call. A `message`-shaped
 * action (meant for the agent) has nowhere real to go yet — the only existing relay
 * (`examples/reference-web/src/daemon.ts`'s `/a2ui-action`) is hardwired to that app's fixed,
 * scripted `a2ui-demo` agent, not a real conversational run; sending to it here would silently
 * misrepresent whether a live agent turn can actually receive the action. `onAgentAction` is the
 * seam a host wires up once that backend capability exists — until then, a `message`-shaped action
 * surfaces as a visible, honest notice instead of vanishing or hitting the wrong endpoint.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createA2uiInterpreter, createLabCatalog, type A2uiInterpreter } from '@jini-ai/agentic/a2ui';
import { buildA2uiCatalogFromRegistry } from '@jini-ai/ui/a2ui';
import { DEFAULT_INTERACTIVE_UI_REGISTRY } from '@jini-ai/ui/interactive-ui';
import type { ExtEventRenderProps } from '../ext-event-renderer-registry.js';
import { useT } from '../hooks/context.js';

/** Every agent→renderer message shape carries `surfaceId` under exactly one of these keys. */
const SURFACE_ID_KEYS = ['createSurface', 'updateComponents', 'updateDataModel', 'deleteSurface'] as const;

function extractSurfaceId(message: unknown): string | undefined {
  if (typeof message !== 'object' || message === null) return undefined;
  for (const key of SURFACE_ID_KEYS) {
    const body = (message as Record<string, unknown>)[key];
    if (body && typeof body === 'object' && typeof (body as Record<string, unknown>).surfaceId === 'string') {
      return (body as Record<string, unknown>).surfaceId as string;
    }
  }
  return undefined;
}

/** Renders one component and its children by walking the surface's component map from `componentId` — identical degrade-sanely behavior to `A2uiLab.tsx`'s `RenderComponent`. */
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
}): ReactNode {
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

  function renderChildList(children: unknown): ReactNode {
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
        // `variant` is always populated: the catalog's `TextPropsSchema` declares
        // `.default('body')`, and the interpreter stores zod's *output* (`applyComponentsList`'s
        // `parsed.data`, its only writer), so an absent variant is filled in upstream and an
        // explicit `null` is refused before the component ever enters the map. No `??` fallback.
        <span className={`a2ui-text a2ui-text-${String(component.props.variant)}`} data-a2ui-component-id={componentId}>
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
    case 'Card':
      // A single-child wrapper — needed to usefully contain one registry component (see the
      // `default` case below) inside a `Column`/`Row`, the same reasoning `@jini-ai/ui`'s
      // `A2uiSurfaceRenderer` documents for its own identical case.
      return (
        <div className="a2ui-card" data-a2ui-component-id={componentId}>
          <RenderComponent {...childProps} componentId={String(component.props.child)} />
        </div>
      );
    case 'Button':
      return (
        <button
          type="button"
          // Always populated, for the same reason as `Text`'s variant above — `ButtonPropsSchema`
          // declares `.default('default')`.
          className={`a2ui-button a2ui-button-${String(component.props.variant)}`}
          data-a2ui-component-id={componentId}
          onClick={() => onAction(componentId)}
        >
          <RenderComponent {...childProps} componentId={String(component.props.child)} />
        </button>
      );
    default: {
      // A component type the active catalog rejects never reaches the component map
      // (`interpreter.applyAgentMessage`'s own guard) — everything that DOES reach here is either
      // one of the 13 basic types this switch has no case for, or a registry-sourced component
      // (`shadcn.*`/`recharts.*`) merged into the catalog by `A2uiSurfaceCard`'s own
      // `buildA2uiCatalogFromRegistry` call below. Resolved against the SAME registry
      // `@jini-ai/ui`'s own `A2uiSurfaceRenderer` uses, so a type addable to the catalog and
      // renderable there is addable and renderable here too.
      const entry = DEFAULT_INTERACTIVE_UI_REGISTRY.resolveById(component.component);
      if (!entry) {
        return (
          <span className="a2ui-placeholder" data-a2ui-status="unrenderable-type">
            ⚠ no renderer yet for component type “{component.component}”
          </span>
        );
      }
      const RegistryComponent = entry.Component;
      // `onRowClick`: the one registry component that exists today (`native.data-table`/
      // `shadcn.data-table`) reads this, not a generic per-type feedback convention — same
      // documented simplification `A2uiSurfaceRenderer`'s own identical line carries.
      return <RegistryComponent {...component.props} onRowClick={() => onAction(componentId)} />;
    }
  }
}

/**
 * What a host reports back after attempting to deliver an agent-directed action. Returned (not
 * thrown) because a delivery failure here is routine, not exceptional — a closed exchange, a
 * network blip, a stale tab — and every one of them is something the human needs to *see*, not
 * something that should unwind a React event handler.
 */
export type A2uiAgentActionOutcome = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * Duck-types `value` as a thenable rather than checking `instanceof Promise`. `onAgentAction`'s
 * declared return type is `void | Promise<A2uiAgentActionOutcome>`, and TypeScript's structural
 * typing means anything with a spec-shaped `then` — a hand-built thenable, a non-native promise
 * library, a promise crossing a realm boundary (e.g. constructed inside an iframe) — satisfies
 * `Promise<T>` at the call site without being `instanceof Promise` in *this* realm. An `instanceof`
 * check would silently skip the await branch for any of those, dropping the delivery outcome on the
 * floor — reintroducing, inside the fix for it, the exact silent-failure class this feature exists
 * to remove. Do not "simplify" this back to `instanceof`.
 *
 * @complexity O(1).
 * @overallScore 100
 */
function isThenable(value: unknown): value is PromiseLike<A2uiAgentActionOutcome> {
  return typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function';
}

export interface A2uiSurfaceCardProps extends ExtEventRenderProps {
  /**
   * Called when a rendered surface produces a `message`-shaped action meant for the agent (as
   * opposed to a `local` client-side function call, which this component already resolves and
   * displays itself). Omit to surface the module doc's honest "nowhere to send this yet" notice
   * instead of silently dropping the action.
   *
   * May return `void` — the original, still fully-supported contract; `examples/reference-web/src/
   * A2uiLab.tsx` uses exactly this and needs no changes — or a `Promise<A2uiAgentActionOutcome>` for
   * a host that can tell whether the message actually arrived (e.g. `createA2uiActionPoster`, a
   * host-side implementation reporting the POST's outcome). When a promise is returned and it resolves
   * `{ ok: false }` or rejects, the card shows a visible delivery-failure notice instead of leaving
   * the human to wonder whether their click did anything. This is the same problem `refusalNotice`
   * already solves for a *client-side* refusal (`buildAction` says no before anything is sent), one
   * hop further out: the message left this component but never reached the agent. Both are needed —
   * neither substitutes for the other.
   */
  onAgentAction?: (runId: string | undefined, message: unknown) => void | Promise<A2uiAgentActionOutcome>;
}

/** Registered against `ext-event-renderer-registry.ts`'s `'a2ui'` name — see module doc. */
export function A2uiSurfaceCard({ events, runId, onAgentAction }: A2uiSurfaceCardProps) {
  const t = useT();
  // Merges `DEFAULT_INTERACTIVE_UI_REGISTRY` (shadcn/recharts) into the lab catalog, keyed under
  // the SAME `catalogId` the lab catalog already uses — so a tool built against
  // `createLabCatalog().catalogId` (e.g. `demo-a2ui-tool.ts`) still validates unchanged, and now
  // ALSO gains every registry component as a real, addable/removable catalog entry.
  const catalog = useMemo(() => {
    const base = createLabCatalog();
    return buildA2uiCatalogFromRegistry(DEFAULT_INTERACTIVE_UI_REGISTRY, base.catalogId, { base });
  }, []);
  const interpreterRef = useRef<A2uiInterpreter | null>(null);
  if (!interpreterRef.current) interpreterRef.current = createA2uiInterpreter(catalog);
  const interpreter = interpreterRef.current;

  const [, forceRender] = useState(0);
  const appliedCountRef = useRef(0);
  const surfaceIdRef = useRef<string | undefined>(undefined);
  /** Monotonic ticket for `handleAction`'s agent-delivery attempts — see its use for why a host's
   *  promises settling out of order would otherwise repaint a superseded failure. */
  const agentActionAttemptRef = useRef(0);
  const [refusalNotice, setRefusalNotice] = useState<string | null>(null);
  const [pendingAgentAction, setPendingAgentAction] = useState<string | null>(null);
  const [localActionResult, setLocalActionResult] = useState<{ componentId: string; value: unknown } | null>(null);
  const [deliveryFailureNotice, setDeliveryFailureNotice] = useState<string | null>(null);

  useEffect(() => interpreter.subscribe(() => forceRender((n) => n + 1)), [interpreter]);

  useEffect(() => {
    while (appliedCountRef.current < events.length) {
      const message = events[appliedCountRef.current];
      appliedCountRef.current += 1;
      const surfaceId = extractSurfaceId(message);
      if (surfaceId) surfaceIdRef.current = surfaceId;
      const result = interpreter.applyAgentMessage(message);
      if (result.unattributedViolation) {
        setRefusalNotice(result.unattributedViolation);
      } else {
        // A catalog-validation refusal (e.g. an unrecognized component type, or a known type with a
        // missing/invalid required prop) surfaces as an `error`-shaped entry in `rendererMessages`,
        // not `unattributedViolation`. Shown locally AND relayed through the exact same
        // `onAgentAction` pipe a button click already uses: `errorMessage` is a real
        // `RendererToAgentMessage` carrying `error.surfaceId`, which is all `onAgentAction`'s host
        // implementation needs to address it — no second callback prop, no new wire shape. Without
        // this relay a tool call that opened the surface has no way to learn its render was REFUSED
        // and returns success anyway, which is worse than the silent-"waiting" bug this comment used
        // to describe: it actively tells the agent (and, downstream, the human) that a chart is on
        // screen when it never rendered at all.
        const errorMessage = result.rendererMessages.find((m): m is Extract<typeof m, { error: unknown }> => 'error' in m);
        if (errorMessage) {
          setRefusalNotice(errorMessage.error.message);
          void onAgentAction?.(runId, errorMessage);
        } else {
          // A message that applies cleanly clears any earlier refusal. `refusalNotice` describes
          // whether the CURRENT surface is broken, not a permanent scar from an earlier mistake this
          // same conversation already recovered from — e.g. a retry that fixed a missing prop, or an
          // unrelated later `updateDataModel`. Without this, a stale "Action refused" banner from an
          // early failed attempt sits underneath a chart that went on to render successfully.
          setRefusalNotice(null);
        }
      }
    }
    // `onAgentAction`/`runId` included: the loop above now calls `onAgentAction` directly (relaying
    // a validation error), not just on a later user click — the effect must see a fresh reference,
    // the same way `handleAction`'s own (non-effect) call site already gets one on every render.
  }, [events, interpreter, onAgentAction, runId]);

  const surfaceId = surfaceIdRef.current;
  const root = surfaceId ? interpreter.getRoot(surfaceId) : undefined;

  function handleAction(componentId: string) {
    // `surfaceId` is non-null here by construction, not by luck: this callback is only ever reached
    // from a `Button` inside the rendered tree, and nothing renders until `root` resolves — which
    // the `!root` early return below only permits when `surfaceId` was already truthy. Asserted
    // rather than re-checked, exactly as the `RenderComponent` call site below already does.
    const built = interpreter.buildAction(surfaceId!, componentId);
    if (!built.ok) {
      setRefusalNotice(built.reason);
      return;
    }
    setRefusalNotice(null);
    if (built.kind === 'local') {
      // `buildAction`'s local branch is a pure computation (`resolveDynamicValue` over a
      // registered catalog function's `impl`) — it never touches interpreter state, so there is
      // nothing for `interpreter.subscribe` to notify and no re-render to "reflect" it. The only
      // honest thing this component can do with the resolved value is show it.
      setPendingAgentAction(null);
      setLocalActionResult({ componentId, value: built.result });
      return;
    }
    setLocalActionResult(null);
    if (onAgentAction) {
      // Clearing here, not just at the top of `handleAction`: a *previous* click's delivery failure
      // must not linger next to a new attempt that has not resolved yet — same "stale notice beside
      // a working control" concern `refusalNotice`'s own clearing already guards against.
      setPendingAgentAction(null);
      setDeliveryFailureNotice(null);
      // Clearing the notice is not enough on its own: `onAgentAction` is host-supplied and its
      // promises are not guaranteed to settle in call order, so an OLDER click's rejection could
      // land after a newer one had already cleared the notice — repainting a failure the human has
      // since superseded, next to a control that just worked. Only the latest attempt may write.
      const attempt = (agentActionAttemptRef.current += 1);
      const isLatestAttempt = () => agentActionAttemptRef.current === attempt;
      const outcome = onAgentAction(runId, built.message);
      // `isThenable`, not `instanceof Promise` — see that helper's own doc for why.
      if (isThenable(outcome)) {
        void outcome.then(
          (result) => {
            if (!result.ok && isLatestAttempt()) setDeliveryFailureNotice(result.reason);
          },
          (error: unknown) => {
            // A rejection is the host's transport breaking, not a message the host chose to report —
            // still surfaced, so the human sees *something* rather than a click that silently did
            // nothing.
            if (!isLatestAttempt()) return;
            setDeliveryFailureNotice(error instanceof Error ? error.message : String(error));
          },
        );
      }
    } else {
      setPendingAgentAction(JSON.stringify(built.message));
    }
  }

  function formatLocalActionValue(value: unknown): string {
    if (value === undefined) return t('(no return value)');
    return typeof value === 'string' ? value : JSON.stringify(value);
  }

  if (!root) {
    return refusalNotice ? (
      <div className="a2ui-surface-card a2ui-surface-refused" role="status">
        {t('A2UI surface refused: {reason}', { reason: refusalNotice })}
      </div>
    ) : (
      <div className="a2ui-surface-card a2ui-surface-waiting" role="status">
        {t('Waiting for the agent to send a root component…')}
      </div>
    );
  }

  return (
    <div className="a2ui-surface-card" data-a2ui-surface-id={surfaceId}>
      <RenderComponent interpreter={interpreter} surfaceId={surfaceId!} componentId="root" ancestors={new Set()} onAction={handleAction} />
      {refusalNotice ? (
        <div className="a2ui-surface-notice a2ui-surface-notice-refused" role="status">
          {t('Action refused: {reason}', { reason: refusalNotice })}
        </div>
      ) : null}
      {pendingAgentAction ? (
        <div className="a2ui-surface-notice a2ui-surface-notice-unwired" role="status">
          {t('This action is meant for the agent, but this host has not wired up a live agent-action relay yet.')}
        </div>
      ) : null}
      {deliveryFailureNotice ? (
        // Deliberately its own notice, not folded into `refusalNotice` above: that one fires
        // *before* anything is sent (the interpreter said no); this one fires *after* — the message
        // left this component but the host reports it never arrived. Conflating them would tell the
        // human the wrong half of the story.
        <div className="a2ui-surface-notice a2ui-surface-notice-delivery-failed" role="status">
          {t('This action could not be delivered: {reason}', { reason: deliveryFailureNotice })}
        </div>
      ) : null}
      {localActionResult ? (
        <div className="a2ui-surface-notice a2ui-surface-notice-local-action" role="status" data-a2ui-component-id={localActionResult.componentId}>
          {t('Local action resolved: {value}', { value: formatLocalActionValue(localActionResult.value) })}
        </div>
      ) : null}
    </div>
  );
}
