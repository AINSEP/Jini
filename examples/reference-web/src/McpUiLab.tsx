import { useState } from 'react';
import type { ChatMessage } from '@jini-ai/chat-core';
import { ChatPane, registerToolRenderer } from '@jini-ai/chat-react';
import { uploadChatAttachments } from './attachments.js';
import { ChatFab } from './ChatFab.js';
import { createDaemonChatTransport } from './daemon-transport.js';
import { McpUiLabHostFrame } from './McpUiLabHost.js';
import { MCPUI_LAB_VIEW_MODES, type McpUiLabViewMode } from './mcpui-lab-view.js';
import { PLAYGROUND_RUNTIME_ACCESS } from './runtime-access.js';

/**
 * A plain React page tagged for agent control, served at `/#/mcpui-lab`.
 *
 * The MCP Apps ("mcp-ui") stress-test fixture: a real Host↔View JSON-RPC handshake over
 * `postMessage`, against a genuinely sandboxed, genuinely cross-origin iframe (see
 * `McpUiLabHost.tsx`'s `MCPUI_LAB_VIEW_ORIGIN` and `daemon.ts`'s `/mcpui-lab/view` route — the
 * View is served from the daemon's own port, not this page's Vite origin). Two ways to trigger
 * it, both hitting the identical Host implementation (`useMcpUiLabHost`):
 *
 * 1. The manual harness below — always mounted, mode-selectable, for direct/adversarial poking.
 * 2. A live agent conversation calling the `show_mcpui_widget` tool (`daemon.ts`), whose result
 *    renders through `registerToolRenderer` exactly like any other tool card in the transcript.
 */

const MCPUI_CHAT_TRANSPORT = createDaemonChatTransport();

const AGENT_CONTROL = { enabled: true } as const;

const MCPUI_INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: 'mcpui-lab-welcome',
    role: 'assistant',
    content:
      'Ask me to open the MCP Apps demo widget and I\'ll call `show_mcpui_widget` — the result renders '
      + 'as a real sandboxed, cross-origin iframe running the actual MCP-UI/MCP-Apps JSON-RPC handshake, '
      + 'right here in the transcript.',
    runStatus: 'succeeded',
    createdAt: Date.now(),
  },
];

/**
 * Registered once at module scope (this route's module is bundled eagerly, same as `AgentLab`'s
 * and `App`'s — see `main.tsx`), so the SAME tool card renders correctly no matter which page's
 * `ChatPane` the run happens to be attached to.
 */
registerToolRenderer('show_mcpui_widget', (props) => {
  if (props.isError) {
    return (
      <div className="mcpui-lab-tool-error" data-agent-role="status" data-agent-label="MCP Apps widget failed to open">
        MCP Apps widget failed to open{props.result ? `: ${props.result}` : '.'}
      </div>
    );
  }
  if (props.result === undefined) return null; // still running — defer to ToolCard's built-in in-progress rendering
  let parsed: { uri?: unknown; title?: unknown } = {};
  try {
    parsed = JSON.parse(props.result) as { uri?: unknown; title?: unknown };
  } catch {
    return null; // not our JSON shape — defer to the generic fallback rather than render garbage
  }
  if (typeof parsed.uri !== 'string') return null;
  const title = typeof parsed.title === 'string' ? parsed.title : 'MCP Apps demo widget';
  return <McpUiLabHostFrame mode="normal" sessionKey={parsed.uri} title={title} />;
});

export function McpUiLab() {
  const [mode, setMode] = useState<McpUiLabViewMode>('normal');
  const [sessionKey, setSessionKey] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);

  return (
    <div className={`mcpui-lab-shell${chatOpen ? ' mcpui-lab-shell-open' : ''}`}>
      <main className="mcpui-lab-page">
        <header
          data-agent-element="mcpui-lab-header"
          data-agent-role="region"
          data-agent-label="Title and description of the MCP Apps lab page"
        >
          <span className="eyebrow">Jini · MCP Apps (mcp-ui) stress test</span>
          <h1>MCP Apps lab</h1>
          <p>
            A real Host↔View JSON-RPC-over-<code>postMessage</code> handshake against a genuinely
            sandboxed, cross-origin iframe — not a mock.
          </p>
          <a href="#/" data-agent-element="link-playground" data-agent-role="link" data-agent-label="Back to the Jini playground">
            ← Playground
          </a>
        </header>

        <section
          aria-label="Manual protocol harness"
          data-agent-page="mcpui-lab"
          data-agent-element="mcpui-lab-harness"
          data-agent-role="region"
          data-agent-label="Manual harness for driving the MCP Apps handshake directly"
        >
          <div className="mcpui-lab-harness-controls">
            <label>
              Mode
              <select
                value={mode}
                onChange={(event) => setMode(event.target.value as McpUiLabViewMode)}
                data-agent-element="mcpui-lab-mode-select"
                data-agent-role="field"
                data-agent-label="Which adversarial posture the View boots into"
              >
                {MCPUI_LAB_VIEW_MODES.map((candidate) => (
                  <option key={candidate} value={candidate}>{candidate}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => setSessionKey((current) => current + 1)}
              data-agent-element="mcpui-lab-restart-button"
              data-agent-role="button"
              data-agent-label="Restart the manual harness session with a fresh iframe"
            >
              Restart session
            </button>
          </div>
          <McpUiLabHostFrame mode={mode} sessionKey={sessionKey} title="Manual harness widget" />
        </section>
      </main>

      <aside className="mcpui-lab-chat" hidden={!chatOpen} aria-label="MCP Apps chat">
        <ChatPane
          title="MCP Apps lab"
          transport={MCPUI_CHAT_TRANSPORT}
          runtimeAccess={PLAYGROUND_RUNTIME_ACCESS}
          initialMessages={MCPUI_INITIAL_MESSAGES}
          initialSelection={{ agentId: 'claude' }}
          placeholder="Ask me to open the widget…"
          uploadAttachments={uploadChatAttachments}
          initialWorkingDirectory="examples/reference-web"
          agentControl={AGENT_CONTROL}
          runContext={() => ({ project: 'starter-site' })}
        />
      </aside>

      <ChatFab open={chatOpen} onToggle={() => setChatOpen((current) => !current)} label="MCP Apps chat" />
    </div>
  );
}
