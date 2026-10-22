import { bindReact } from '../../core/react/bind-react.js';
import { playgroundModule } from '../playground.module.js';
import { PlaygroundPortsContext } from './hooks/PlaygroundPorts.hooks.js';
export { usePlaygroundPorts } from './hooks/PlaygroundPorts.hooks.js';
export function playground(_required: Record<string, never>, _optional = {}) {
  const module = { ...playgroundModule };
  const react = bindReact({ module, views: { playground: { page: () => import('./pages/PlaygroundPage.js'), tabs: { canvas: () => import('./tabs/CanvasTab.js') } } } }, { context: PlaygroundPortsContext });
  return Object.assign(module, { react });
}
