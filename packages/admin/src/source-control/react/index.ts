import { bindReact } from '../../core/react/bind-react.js';
import { sourceControlModule } from '../source-control.module.js';
import { SourceControlPortsContext } from './hooks/SourceControlPorts.hooks.js';
export { useSourceControlPorts } from './hooks/SourceControlPorts.hooks.js';
export function sourceControl(_required: Record<string, never>, _optional = {}) {
  const module = { ...sourceControlModule };
  const react = bindReact({ module, views: { sourceControl: { page: () => import('./pages/SourceControlPage.js'), tabs: { providers: () => import('./tabs/ProvidersTab.js') } } } }, { context: SourceControlPortsContext });
  return Object.assign(module, { react });
}
