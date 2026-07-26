import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage } from '@jini/chat-core';
import {
  ChatPane,
  createDomPageDriver,
  createFrontendSessionBridge,
  type FrontendSessionBridge,
} from '@jini/chat-react';
import { uploadChatAttachments } from './attachments.js';
import { ChatFab } from './ChatFab.js';
import { createDaemonChatTransport } from './daemon-transport.js';
import { PLAYGROUND_RUNTIME_ACCESS } from './runtime-access.js';

/**
 * A plain React page tagged for agent control, served at `/#/agent-lab`.
 *
 * The point of this page is that it is **not** in an iframe. It renders in the same document as
 * everything else, which is how a real product embeds a chat pane (a CMS admin screen, a
 * dashboard), so the page verbs can be built and proven against it with no cross-frame hop at
 * all. The sandboxed preview in the main playground is the special case, not this.
 *
 * It also carries two fields an agent must REFUSE to fill — a password and a hidden CSRF token —
 * so the guard in `@jini/chat-core`'s `findFieldFillRefusal` has something real to refuse. Both
 * are tagged with valid handles on purpose: a correct implementation still says no.
 */
interface LabItem {
  id: string;
  title: string;
  done: boolean;
}

const INITIAL_ITEMS: LabItem[] = [
  { id: 'draft-release-notes', title: 'Draft the release notes', done: false },
  { id: 'review-pull-request', title: 'Review the open pull request', done: true },
  { id: 'water-window-plants', title: 'Water the window plants', done: false },
];

/**
 * The page ids this surface can navigate between, and how. `page.navigate` is checked against
 * these keys, so a page absent here is unreachable no matter what a caller asks for.
 */
const LAB_PAGES: Record<string, () => void> = {
  'agent-lab': () => { globalThis.location.hash = '#/agent-lab'; },
  playground: () => { globalThis.location.hash = '#/'; },
};

const LAB_CHAT_TRANSPORT = createDaemonChatTransport();

/**
 * Module-level so its identity is stable across renders.
 *
 * Writing `agentControl={{ enabled: true }}` inline would make a new object every render. The
 * hook is keyed on bridge *presence* rather than identity precisely so that cannot re-register
 * every tool on each render, but a stable constant is the honest way to express "this never
 * changes" and keeps the example a good pattern to copy.
 */
const AGENT_CONTROL = { enabled: true } as const;

const LAB_INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: 'lab-welcome',
    role: 'assistant',
    content:
      'This pane is docked **inline** — opening it resizes the page rather than covering it, which '
      + 'is how a real product embeds a chat pane. The page around me is tagged for agent control; '
      + 'the six `page.*` verbs run against it through `window.__jiniAgentLab.run`.',
    runStatus: 'succeeded',
    createdAt: Date.now(),
  },
];

export function AgentLab() {
  const [items, setItems] = useState<LabItem[]>(INITIAL_ITEMS);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState('Ready.');
  const [chatOpen, setChatOpen] = useState(false);
  const [bridge, setBridge] = useState<FrontendSessionBridge | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  /** Read at send time, not render time — the token arrives asynchronously, after attach. */
  const bindTokenRef = useRef<string | undefined>(undefined);

  const remaining = items.filter((item) => !item.done).length;

  // Memoized on the bridge itself: the hook keys on bridge *presence*, so this only has to be
  // stable enough not to churn — but a fresh object every render is still the pattern that made
  // that keying necessary in the first place, and the example should model the good habit.
  const agentControl = useMemo(
    () => (bridge === null ? AGENT_CONTROL : { enabled: true, bridgeAccess: bridge.bridgeAccess }),
    [bridge],
  );

  /**
   * The daemon-relayed control channel, replacing the `window.__jiniAgentLab` stopgap this page
   * used to publish. That global was a capability handed to every script on the page; the same
   * verbs now arrive over the surface's own SSE connection, having already passed `ToolExecutor`'s
   * authorization, confirmation, timeout and audit on the way in.
   */
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // Scoped to this page's subtree, never `document` — scanning everything would make any
    // markup on the page an authorization decision.
    const driver = createDomPageDriver({ root, pages: LAB_PAGES, currentPage: 'agent-lab' });
    const session = createFrontendSessionBridge({
      pageDriver: driver,
      // The activity trail the design debate flagged as missing: the user can see the agent
      // acting on their own screen instead of inferring it from the transcript.
      onInvocation: (action) => setStatus(`Agent ran ${action.capabilityId}.`),
      onError: (error) => console.error('[agent-lab] frontend session', error),
    });
    session.ready
      .then(({ bindToken }) => { bindTokenRef.current = bindToken; })
      .catch((error: unknown) => console.error('[agent-lab] never attached', error));
    setBridge(session);
    return () => {
      session.close();
      setBridge(null);
      bindTokenRef.current = undefined;
    };
  }, []);

  const toggle = (id: string) => {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, done: !item.done } : item)),
    );
    setStatus(`Toggled ${id}.`);
  };

  const addItem = () => {
    const title = draft.trim();
    if (!title) {
      setStatus('Nothing to add — the field is empty.');
      return;
    }
    const id = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
    setItems((current) => [...current, { id: id || `item-${current.length}`, title, done: false }]);
    setDraft('');
    setStatus(`Added "${title}".`);
  };

  return (
    <div className={`agent-lab-shell${chatOpen ? ' agent-lab-shell-open' : ''}`}>
      <main className="agent-lab" data-agent-page="agent-lab" ref={rootRef}>
      <header
        data-agent-element="lab-header"
        data-agent-role="region"
        data-agent-label="Title and description of the agent lab page"
      >
        <span className="eyebrow">Jini · plain React page</span>
        <h1>Agent lab</h1>
        <p>
          A normal React page, in the normal document. No iframe, no sandbox, no cross-frame
          messaging — the same shape a real app embeds a chat pane into.
        </p>
      </header>

      <nav
        data-agent-element="lab-nav"
        data-agent-role="region"
        data-agent-label="Links to the other pages"
      >
        <a href="#/" data-agent-element="link-playground" data-agent-role="link" data-agent-label="Back to the Jini playground">
          ← Playground
        </a>
        <a
          href="/sample-preview/starter-site/index.html"
          data-agent-element="link-starter-site"
          data-agent-role="link"
          data-agent-label="Open the plain HTML sample site in this tab"
        >
          Plain HTML sample →
        </a>
      </nav>

      <form
        data-agent-element="new-item-form"
        data-agent-role="form"
        data-agent-label="Add a new item to the list"
        onSubmit={(event) => {
          event.preventDefault();
          addItem();
        }}
      >
        <label htmlFor="lab-item">New item</label>
        <div className="input-row">
          <input
            id="lab-item"
            name="item"
            autoComplete="off"
            placeholder="What needs doing?"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            data-agent-element="new-item-input"
            data-agent-role="field"
            data-agent-label="Text of the new item to add"
          />
          <button
            type="submit"
            data-agent-element="add-item-button"
            data-agent-role="button"
            data-agent-label="Submit the new item"
          >
            Add
          </button>
        </div>
      </form>

      <ul data-agent-element="item-list" data-agent-role="list" data-agent-label="Every item in the lab list">
        {items.map((item) => (
          <li
            key={item.id}
            data-agent-element={`item-${item.id}`}
            data-agent-role="checkbox"
            data-agent-label={`Item: ${item.title}`}
          >
            <label>
              <input type="checkbox" checked={item.done} onChange={() => toggle(item.id)} />
              {item.title}
            </label>
          </li>
        ))}
      </ul>

      {/*
        Deliberate refusal targets. Both carry valid handles, so an implementation that only
        checks "is it tagged?" will happily fill them — which is the bug. The field guard must
        refuse on type/autocomplete/name regardless of tagging.
      */}
      <fieldset
        data-agent-element="protected-fields"
        data-agent-role="region"
        data-agent-label="Fields an agent must never fill, even though they are tagged"
      >
        <legend>Must never be agent-filled</legend>
        <label htmlFor="lab-password">Password</label>
        <input
          id="lab-password"
          name="password"
          type="password"
          autoComplete="current-password"
          data-agent-element="account-password-input"
          data-agent-role="field"
          data-agent-label="Account password — refusal target, never fill this"
        />
        <input
          type="hidden"
          name="csrf_token"
          value="not-a-real-token"
          data-agent-element="csrf-token-input"
          data-agent-role="field"
          data-agent-label="Anti-forgery token — refusal target, never fill this"
        />
      </fieldset>

      <footer>
        <span
          data-agent-element="remaining-count"
          data-agent-role="status"
          data-agent-label="How many items are still unchecked"
        >
          {remaining} {remaining === 1 ? 'item' : 'items'} left
        </span>
        <span data-agent-element="last-action" data-agent-role="status" data-agent-label="What happened most recently">
          {status}
        </span>
      </footer>
      </main>

      {/*
        `hidden` rather than unmounting: the pane keeps its conversation across toggles, which is
        the difference between a panel you can close mid-thread and one that throws your session
        away. It also drops out of layout and the tab order when closed, so the page genuinely
        resizes rather than reserving a gap.
      */}
      <aside className="agent-lab-chat" hidden={!chatOpen} aria-label="Workspace chat">
        <ChatPane
          title="Agent lab"
          transport={LAB_CHAT_TRANSPORT}
          runtimeAccess={PLAYGROUND_RUNTIME_ACCESS}
          initialMessages={LAB_INITIAL_MESSAGES}
          initialSelection={{ agentId: 'claude' }}
          placeholder="Ask about this page…"
          uploadAttachments={uploadChatAttachments}
          initialWorkingDirectory="examples/reference-web"
          suggestions={[
            'What controls are on this page?',
            'Check off "Water the window plants".',
          ]}
          // Opt in to the chat.* capability surface AND the daemon relay. Both families now
          // arrive over one connection: chat.* is served by the pane, page.* by the driver above.
          agentControl={agentControl}
          // Carries the surface's bind token so the daemon can route this run's page.* calls back
          // to this tab. Read from a ref at send time because it arrives after attach.
          runContext={() => ({
            project: 'starter-site',
            ...(bindTokenRef.current === undefined ? {} : { frontendBindToken: bindTokenRef.current }),
          })}
        />
      </aside>

      <ChatFab open={chatOpen} onToggle={() => setChatOpen((current) => !current)} label="workspace chat" />
    </div>
  );
}
