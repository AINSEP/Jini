import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatSettingsDialog } from '../../../packages/chat/src/react/components/ChatSettingsDialog.js';
import { Composer } from '../../../packages/chat/src/react/components/Composer.js';
import { useComposer } from '../../../packages/chat/src/react/hooks/useComposer.js';
import { CHAT_PANE_STYLES } from '../../../packages/chat/src/react/features/chat-pane/styles.js';

function Harness() {
  const [open, setOpen] = useState(false);
  const composer = useComposer();
  return <>
    <style>{CHAT_PANE_STYLES}</style>
    <section className="jini-chat-pane" style={{ width: 379, height: 400 }}>
      <header className="host-header">{'UnbrokenHostHeader'.repeat(30)}</header>
      <div className="jini-chat-pane__body" />
      <Composer composer={composer} onSend={() => {}} />
    </section>
    <button type="button" onClick={() => setOpen(true)}>Open settings</button>
    <ChatSettingsDialog open={open} onClose={() => setOpen(false)} permissions={{ enabled: false, canEdit: true, capabilities: [], onChange: () => {} }}
      displaySections={[
        { key: 'tools', label: 'Tool calls', items: [{ key: 'compact', label: 'Compact', role: 'menuitemradio', checked: true }, { key: 'full', label: 'Full', role: 'menuitemradio' }] },
        ...Array.from({ length: 20 }, (_, index) => ({ key: `group-${index}`, label: `Group ${index}`, items: [{ key: `option-${index}`, label: `Option ${index}`, role: 'menuitemcheckbox' as const }] })),
      ]} />
  </>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
