import { createRoot } from 'react-dom/client';
import { Composer } from '../../../packages/chat/src/react/components/Composer.js';
import { useComposer } from '../../../packages/chat/src/react/hooks/useComposer.js';
import { AgentRuntimePicker } from '../../../packages/chat/src/react/features/chat-pane/components/AgentRuntimePicker.js';
import { CHAT_PANE_STYLES } from '../../../packages/chat/src/react/features/chat-pane/styles.js';

function Harness({ running }: { running: boolean }) {
  const composer = useComposer({ initialDraft: 'Create a new theme' });
  const record = () => {
    const output = document.getElementById(running ? 'stopped' : 'sent')!;
    output.textContent = String(Number(output.textContent) + 1);
  };
  return <section className="jini-chat-pane" style={{ width: 320, height: 360 }}>
    <Composer composer={composer} running={running} onSend={record} onCancel={record} slots={{
      footerLeadingAccessory: <button type="button">Choose folder</button>,
      footerAccessories: <AgentRuntimePicker agents={[{
        id: 'agent', name: 'Agent', available: true,
        models: [{ id: 'long', label: 'A long discovered model name' }],
        reasoningOptions: [{ id: 'default', label: 'Default' }, { id: 'high', label: 'High' }],
      }]} value={{ agentId: 'agent', model: 'long' }} onChange={() => {}} />,
    }} />
    <output id={running ? 'stopped' : 'sent'}>0</output>
  </section>;
}

createRoot(document.getElementById('root')!).render(<>
  <style>{CHAT_PANE_STYLES}</style><Harness running={false} /><Harness running />
</>);
