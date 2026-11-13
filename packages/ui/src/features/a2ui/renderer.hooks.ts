import { createElement, type ComponentType, type ReactNode } from 'react';
import type { A2uiInterpreter } from './protocol.js';
import type { NodeProps } from './renderer.js';

/** Resolve this node's text values and render explicit child IDs. */
export function createA2uiNodeHelpers({ interpreter, surfaceId, childProps, renderNode: Node }: {
  interpreter: A2uiInterpreter;
  surfaceId: string;
  childProps: Omit<NodeProps, 'componentId'>;
  renderNode: ComponentType<NodeProps>;
}, _options = {}) {
  function resolveText(value: unknown): string {
    const result = interpreter.resolve({ surfaceId, value: value as Parameters<A2uiInterpreter['resolve']>[0]['value'] });
    if (!result.ok) return `⚠ unresolved (${result.reason})`;
    return typeof result.value === 'string' ? result.value : JSON.stringify(result.value);
  }
  function renderChildList(children: unknown): ReactNode {
    if (Array.isArray(children)) {
      return children.map((childId) => createElement(Node, { key: String(childId), componentId: String(childId), ...childProps }));
    }
    return createElement('span', { className: 'a2ui-placeholder', 'data-a2ui-status': 'unimplemented-template-list' },
      '⚠ dynamic (template) child lists are not implemented by this port');
  }
  return { resolveText, renderChildList };
}

/** Dispatch only actions declared on a component in the selected surface. */
export function createA2uiActionHandler({ interpreter, surfaceId }: { interpreter: A2uiInterpreter; surfaceId: string }, _options = {}) {
  return (componentId: string) => {
    const component = interpreter.getSurface({ surfaceId })?.components.get(componentId);
    if (component?.props.action !== undefined) interpreter.buildAction({ surfaceId, componentId });
  };
}
