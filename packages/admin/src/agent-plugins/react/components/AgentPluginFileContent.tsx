import { Fragment } from 'react';
import { Button } from '@jini-ai/ui-kit/react';
import type { AgentPluginPackageFile } from '../../models.js';
import { useAgentPluginFileContent } from '../hooks/AgentPluginInspector.hooks.js';
export function AgentPluginFileContent({ file }: { file: AgentPluginPackageFile }, _optional = {}) {
  const vm = useAgentPluginFileContent({ file });
  return <section aria-labelledby={vm.headingId}><h3 id={vm.headingId}>{vm.segments.map((segment, i) => <span key={i}>{segment.text}{segment.slash && <><span>/</span><wbr /></>}</span>)}</h3>
    {vm.hasContent ? <><Button attrs={vm.wrapAttrs} onPress={vm.toggleWrap}>{vm.wrapText}</Button><div style={vm.codeStyle}>{vm.lines.map(line => <Fragment key={line.number}><span aria-hidden>{line.number} </span><code style={vm.lineStyle}>{line.text}</code></Fragment>)}</div></> : <p role="status">{vm.notice}</p>}
  </section>;
}
