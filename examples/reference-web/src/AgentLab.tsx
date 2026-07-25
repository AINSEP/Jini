import { useState } from 'react';

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

export function AgentLab() {
  const [items, setItems] = useState<LabItem[]>(INITIAL_ITEMS);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState('Ready.');

  const remaining = items.filter((item) => !item.done).length;

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
    <main className="agent-lab" data-agent-page="agent-lab">
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
  );
}
