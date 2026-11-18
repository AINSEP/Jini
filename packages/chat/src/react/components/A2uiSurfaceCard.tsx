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
import type { ReactNode } from 'react';
import type { Clock } from '@jini-ai/core/primitives';
import { useChatSurfaces, type ChatSurfaceRegistry } from '../surfaces.js';
import type { ExtEventRenderProps } from '../ext-event-renderer-registry.js';
import { useT } from '../hooks/context.js';
import { useA2uiSurfaceCard, type RenderComponentProps } from './A2uiSurfaceCard.hooks.js';
import { createA2uiCardNodeHelpers } from './A2uiSurfaceCard.rules.js';

/** Renders one component and its children by walking the surface's component map from `componentId` — identical degrade-sanely behavior to `A2uiLab.tsx`'s `RenderComponent`. */
function RenderComponent({
  interpreter,
  surfaceId,
  componentId,
  ancestors,
  onAction,
  registry,
}: RenderComponentProps): ReactNode {
  if (ancestors.has(componentId)) {
    return (
      <span className="a2ui-placeholder a2ui-placeholder-cycle" data-a2ui-status="cycle" data-a2ui-component-id={componentId}>
        ⟲ circular reference at “{componentId}”
      </span>
    );
  }
  const surface = interpreter.getSurface({ surfaceId });
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
  const childProps = { interpreter, surfaceId, ancestors: nextAncestors, onAction, registry };

  const { resolveText, renderChildList } = createA2uiCardNodeHelpers({ interpreter, surfaceId, childProps, renderNode: RenderComponent });

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
      // the catalog below uses, so a type addable to the catalog and
      // renderable there is addable and renderable here too.
      const entry = registry.resolveById({ id: component.component });
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

export interface A2uiSurfaceCardProps extends ExtEventRenderProps {
  /** Host clock port; the card derives action ids and interpreter timing from it. */
  clock: Clock;
  /** Host registry used for both wire validation and rendering. Defaults to the host's `surfaces.interactiveUi.defaultRegistry`.
   * Supply a stable registry for the card's lifetime; remount the card to switch catalogs. */
  registry?: Pick<ChatSurfaceRegistry, 'list' | 'resolveById'>;
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

/** Hooks A2uiSurfaceCard calls; defaults to the real ones, a test hands in fakes. */
export const defaultA2uiSurfaceCardHooks = { useT, useChatSurfaces, useA2uiSurfaceCard };
export type A2uiSurfaceCardHooks = typeof defaultA2uiSurfaceCardHooks;

/** Registered against `ext-event-renderer-registry.ts`'s `'a2ui'` name — see module doc. */
export function A2uiSurfaceCard({ events, runId, onAgentAction, clock, registry: registryProp, hooks = defaultA2uiSurfaceCardHooks }: A2uiSurfaceCardProps & { hooks?: A2uiSurfaceCardHooks | undefined }) {
  const t = hooks.useT();
  const surfaces = hooks.useChatSurfaces();
  const registry = registryProp ?? surfaces.interactiveUi.defaultRegistry;
  const { interpreter, surfaceId, root, refusalNotice, pendingAgentAction, localActionResult, deliveryFailureNotice, handleAction, formatLocalActionValue } = hooks.useA2uiSurfaceCard({ events, runId, onAgentAction, registry, t, clock });

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
      <RenderComponent interpreter={interpreter} surfaceId={surfaceId!} componentId="root" ancestors={new Set()} onAction={handleAction} registry={registry} />
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
