import { Notice } from '../../../react/kit.js';
import type { TabViewProps } from '@jini-ai/core/contracts/admin-module';
import { useCanvas } from '../hooks/Canvas.hooks.js';
import { playgroundMessagesEn as m } from '../../messages.en.js';
export function Canvas({ useCanvasHook = useCanvas, ...props }: TabViewProps & { useCanvasHook?: typeof useCanvas }, _optional = {}) {
  const vm = useCanvasHook(props);
  return vm.denied ? <Notice tone="danger">{m.denied}</Notice> : <section><h2>{m.canvas}</h2><style>{vm.styles}</style><div data-jini-part="playground.canvas" className="jini-playground-canvas" ref={vm.registerCanvas} /><p data-jini-part="playground.empty" className="jini-playground-empty">{m.empty}</p></section>;
}
