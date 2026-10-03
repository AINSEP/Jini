import type { ReactNode } from 'react';
import type { InteractiveUiRegistry } from '../interactive-ui/registry.js';
import type { A2uiInterpreter } from './protocol.js';
import { useA2uiSurfaceRoot } from './use-a2ui-surface.js';

// Explicit provider contracts, not a guessed common callback. Display-only cards/charts
// have no action callback; custom interactive entries can declare their own `actionProp`.
const PROVIDER_ACTION_PROPS: ReadonlyMap<string, string> = new Map([
  ['native.data-table', 'onRowClick'],
  ['shadcn.data-table', 'onRowClick'],
  ['shadcn.button', 'onPress'],
  ['shadcn.checkbox', 'onCheckedChange'],
  ['shadcn.radio-group', 'onValueChange'],
  ['shadcn.text-input', 'onValueChange'],
  ['shadcn.select', 'onValueChange'],
]);

export interface A2uiSurfaceRendererProps {
  readonly interpreter: A2uiInterpreter;
  readonly surfaceId: string;
  readonly registry: InteractiveUiRegistry;
  /** Rendered when the surface has no root component yet (still streaming in, or doesn't exist). */
  readonly fallback?: ReactNode;
}

interface NodeProps {
  readonly interpreter: A2uiInterpreter;
  readonly surfaceId: string;
  readonly registry: InteractiveUiRegistry;
  readonly componentId: string;
  readonly ancestors: ReadonlySet<string>;
  readonly onAction: (componentId: string) => void;
}

/**
 * Recursively walks a surface's component map from `componentId` — same shape as
 * `@jini-ai/chat/react`'s `A2uiSurfaceCard`'s `RenderComponent` (cycle guard via `ancestors`,
 * degrade-sanely placeholders, never a crash), extended with one more fallback: a catalog type
 * this switch has no basic-primitive case for is resolved against `registry` before falling back
 * to the "no renderer" placeholder — that's what lets a `native.data-table`/`shadcn.data-table`
 * sit inside a `Column` alongside `Text`/`Button`, which the basic-only renderer can't do.
 *
 * Basic-type coverage mirrors `A2uiSurfaceCard`'s own (Text/Column/Row/Button) plus `Card`, since
 * a single-child wrapper is needed to usefully contain one registry component. The remaining
 * basic types (List/Tabs/Modal/Divider/inputs) are not implemented here either — same honest
 * "not done yet" as the component this one is modeled on, not a silent gap.
 */
function RenderNode({ interpreter, surfaceId, registry, componentId, ancestors, onAction }: NodeProps): ReactNode {
  if (ancestors.has(componentId)) {
    return (
      <span className="a2ui-placeholder a2ui-placeholder-cycle" data-a2ui-status="cycle" data-a2ui-component-id={componentId}>
        ⟲ circular reference at "{componentId}"
      </span>
    );
  }
  const surface = interpreter.getSurface({ surfaceId });
  const component = surface?.components.get(componentId);
  if (!component) {
    return (
      <span className="a2ui-placeholder a2ui-placeholder-missing" data-a2ui-status="missing" data-a2ui-component-id={componentId}>
        ⚠ missing component "{componentId}"
      </span>
    );
  }

  const nextAncestors = new Set(ancestors);
  nextAncestors.add(componentId);
  const childProps = { interpreter, surfaceId, registry, ancestors: nextAncestors, onAction };

  function resolveText(value: unknown): string {
    const result = interpreter.resolve({ surfaceId, value: value as Parameters<A2uiInterpreter['resolve']>[0]['value'] });
    if (!result.ok) return `⚠ unresolved (${result.reason})`;
    return typeof result.value === 'string' ? result.value : JSON.stringify(result.value);
  }

  function renderChildList(children: unknown): ReactNode {
    if (Array.isArray(children)) {
      return children.map((childId) => <RenderNode key={String(childId)} componentId={String(childId)} {...childProps} />);
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
      return (
        <div className="a2ui-card" data-a2ui-component-id={componentId}>
          <RenderNode {...childProps} componentId={String(component.props.child)} />
        </div>
      );
    case 'Button':
      return (
        <button
          type="button"
          className={`a2ui-button a2ui-button-${String(component.props.variant)}`}
          data-a2ui-component-id={componentId}
          onClick={() => onAction(componentId)}
        >
          <RenderNode {...childProps} componentId={String(component.props.child)} />
        </button>
      );
    default: {
      const entry = registry.resolveById({ id: component.component });
      if (!entry) {
        return (
          <span className="a2ui-placeholder" data-a2ui-status="unrenderable-type" data-a2ui-component-id={componentId}>
            ⚠ no renderer yet for component type "{component.component}"
          </span>
        );
      }
      const RegistryComponent = entry.Component;
      // `onRowClick` belongs to `native.data-table`/`shadcn.data-table`, not a generic
      // per-component-type feedback convention — each non-table provider needs an explicit
      // callback contract, supplied by the built-in map or its registry entry, not a guess.
      // Unannotated custom entries retain the old table callback for compatibility.
      const actionProp = entry.actionProp ?? PROVIDER_ACTION_PROPS.get(entry.id) ?? 'onRowClick';
      return <RegistryComponent {...component.props} {...{ [actionProp]: () => onAction(componentId) }} />;
    }
  }
}

/**
 * Resolves an A2UI surface's full component tree — root and its recursive children — mixing
 * basic layout/text primitives with `registry`-sourced components. See `RenderNode`'s own doc
 * for coverage and the fallback resolution order.
 */
export function A2uiSurfaceRenderer({ interpreter, surfaceId, registry, fallback }: A2uiSurfaceRendererProps) {
  const root = useA2uiSurfaceRoot({ interpreter: interpreter, surfaceId: surfaceId });
  if (!root) return fallback ?? null;

  const onAction = (componentId: string) => {
    const component = interpreter.getSurface({ surfaceId })?.components.get(componentId);
    if (component?.props.action !== undefined) interpreter.buildAction({ surfaceId, componentId });
  };

  return (
    <RenderNode
      interpreter={interpreter}
      surfaceId={surfaceId}
      registry={registry}
      componentId={root.id}
      ancestors={new Set()}
      onAction={onAction}
    />
  );
}
