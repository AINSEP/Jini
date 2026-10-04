import { useCallback } from 'react';
import { useController } from '../../../react/use-controller.js';
import { createPlaygroundController } from '../../controllers/playground.controller.js';
import { canMountPlayground } from '../../rules.js';
import type { TabViewProps } from '../../../react/bind-react.js';
import { usePlaygroundPorts } from './PlaygroundPorts.hooks.js';
export function useCanvas({ permissions = [] }: TabViewProps, _optional = {}) {
  const { playgroundTargets } = usePlaygroundPorts({}); const key = permissions.join('\0');
  const { controller } = useController({ create: () => createPlaygroundController({ targets: playgroundTargets, permissions }), dependencies: [playgroundTargets, key] });
  // Stable ref callback registers the actual node on attach and releases on detach;
  // an ordinary rerender must never temporarily revert assistant routing to inline.
  const registerCanvas = useCallback((node: HTMLDivElement | null) => controller?.attach({ target: node }), [controller]);
  return { denied: !canMountPlayground({ permissions }), registerCanvas,
    // CSS sibling matching keeps the canvas a pure portal target, with no React-owned children.
    styles: '.jini-playground-canvas{display:flex;flex-direction:column;gap:1rem}.jini-playground-empty{display:none}.jini-playground-canvas:empty + .jini-playground-empty{display:block}',
  };
}
