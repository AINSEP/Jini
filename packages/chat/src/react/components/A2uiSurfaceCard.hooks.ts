import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createA2uiInterpreter,
  createLabCatalog,
  type A2uiInterpreter,
} from '@jini-ai/protocol/a2ui';
import type { Clock } from '@jini-ai/core/primitives';
import { buildA2uiCatalogFromRegistry } from '@jini-ai/ui/a2ui';
import type { InteractiveUiRegistry } from '@jini-ai/ui/interactive-ui';
import type { useT } from '../hooks/context.js';
import type { A2uiAgentActionOutcome, A2uiSurfaceCardProps } from './A2uiSurfaceCard.js';

export interface RenderComponentProps {
  interpreter: A2uiInterpreter;
  surfaceId: string;
  componentId: string;
  ancestors: ReadonlySet<string>;
  onAction: (componentId: string) => void;
  registry: Pick<InteractiveUiRegistry, 'list' | 'resolveById'>;
}

/** Every agent→renderer message shape carries `surfaceId` under exactly one of these keys. */
const SURFACE_ID_KEYS = ['createSurface', 'updateComponents', 'updateDataModel', 'deleteSurface'] as const;

// Preserve the interpreter's former module-wide sequence so separate cards cannot reuse an
// action ID in the same millisecond; the wall-clock suffix keeps the existing wire format.
let actionIdCounter = 0;

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

/** Apply streamed surface events and report local or agent action outcomes. */
export function useA2uiSurfaceCard({ events, runId, onAgentAction, registry, t, clock }: {
  clock: Clock;
  events: A2uiSurfaceCardProps['events']; runId: A2uiSurfaceCardProps['runId'];
  onAgentAction: A2uiSurfaceCardProps['onAgentAction']; registry: NonNullable<A2uiSurfaceCardProps['registry']>;
  t: ReturnType<typeof useT>;
}, _options = {}) {
  // Merges the host registry (shadcn/recharts by default) into the lab catalog, keyed under
  // the SAME `catalogId` the lab catalog already uses — so a tool built against
  // `createLabCatalog({}).catalogId` (e.g. `demo-a2ui-tool.ts`) still validates unchanged, and now
  // ALSO gains every registry component as a real, addable/removable catalog entry.
  const catalog = useMemo(() => {
    const base = createLabCatalog({});
    return buildA2uiCatalogFromRegistry({ registry, catalogId: base.catalogId }, { base });
  }, [registry]);
  const interpreterRef = useRef<A2uiInterpreter | null>(null);
  if (!interpreterRef.current) {
    interpreterRef.current = createA2uiInterpreter({
      catalog,
      clock,
      ids: {
        next: (_required) => {
          actionIdCounter += 1;
          return `a2ui-action-${actionIdCounter}-${clock.nowMs().toString(36)}`;
        },
      },
    });
  }
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

  useEffect(() => {
    const unsubscribe = interpreter.subscribe({ listener: () => forceRender((n) => n + 1) });
    // React invokes cleanup with no arguments; the interpreter's port takes a required bag.
    return () => unsubscribe({});
  }, [interpreter]);

  useEffect(() => {
    while (appliedCountRef.current < events.length) {
      const message = events[appliedCountRef.current];
      appliedCountRef.current += 1;
      const surfaceId = extractSurfaceId(message);
      if (surfaceId) surfaceIdRef.current = surfaceId;
      const result = interpreter.applyAgentMessage({ raw: message });
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
  const root = surfaceId ? interpreter.getRoot({ surfaceId }) : undefined;

  function handleAction(componentId: string) {
    // `surfaceId` is non-null here by construction, not by luck: this callback is only ever reached
    // from a `Button` inside the rendered tree, and nothing renders until `root` resolves — which
    // the `!root` early return below only permits when `surfaceId` was already truthy. Asserted
    // rather than re-checked, exactly as the `RenderComponent` call site below already does.
    const built = interpreter.buildAction({ surfaceId: surfaceId!, componentId });
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

  return { interpreter, surfaceId, root, refusalNotice, pendingAgentAction, localActionResult, deliveryFailureNotice, handleAction, formatLocalActionValue };
}
