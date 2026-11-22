import { createElement, type ComponentType, type ReactNode } from 'react';
import { parseDynamicValue, type A2uiInterpreter } from '@jini-ai/protocol/a2ui';
import type { RenderComponentProps } from './A2uiSurfaceCard.hooks.js';

/** Resolve dynamic text and explicit child IDs for the card's renderer. */
export function createA2uiCardNodeHelpers({ interpreter, surfaceId, childProps, renderNode: Node }: {
  interpreter: A2uiInterpreter; surfaceId: string; childProps: Omit<RenderComponentProps, 'componentId'>;
  renderNode: ComponentType<RenderComponentProps>;
}, _options = {}) {
  function resolveText(value: unknown): string {
    // Text props already passed the catalog schema. Parsing preserves that wire type at this
    // Record<string, unknown> boundary without asserting a shape the compiler cannot verify.
    const parsed = parseDynamicValue({ value });
    if (!parsed.ok) throw new Error(parsed.error);
    const result = interpreter.resolve({ surfaceId, value: parsed.value });
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
