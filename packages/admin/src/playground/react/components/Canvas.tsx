import { Notice } from '@jini-ai/ui-kit/react';
import type { TabViewProps } from '../../../core/react/bind-react.js';
import { useCanvas } from '../hooks/Canvas.hooks.js';
import { playgroundMessagesEn as m } from '../../messages.en.js';
export function Canvas(props: TabViewProps, _optional = {}) {
  const vm = useCanvas(props);
  return vm.denied ? <Notice tone="danger">{m.denied}</Notice> : <section><h2>{m.canvas}</h2><style>{vm.styles}</style><div data-jini-part="playground.canvas" className="jini-playground-canvas" ref={vm.registerCanvas} /><p data-jini-part="playground.empty" className="jini-playground-empty">{m.empty}</p></section>;
}
