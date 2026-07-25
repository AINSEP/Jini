/*
 * Shared behavior for every page of this sample.
 *
 * Both pages load this one file, so nothing here may assume a particular page's ids. Each page
 * is described by its `data-agent-page` handle and wired through the same `data-agent-element`
 * handles an agent uses — which also means the convention is exercised by the site itself, not
 * just asserted in a comment.
 */
const PAGES = {
  'sunday-list': {
    form: 'new-task-form',
    input: 'new-task-input',
    list: 'task-list',
    status: 'remaining-count',
    handlePrefix: 'task',
    labelPrefix: 'Task',
    countLabel: (count) => `${count} ${count === 1 ? 'thing' : 'things'} left`,
    /** Counts what is still unchecked. */
    countOf: (list) => list.querySelectorAll('input:not(:checked)').length,
    render: (item, text) => {
      item.innerHTML = '<label><input type="checkbox" /> <span></span></label>';
      item.querySelector('span').textContent = text;
    },
    role: 'checkbox',
  },
  notes: {
    form: 'new-note-form',
    input: 'note-title-input',
    list: 'note-list',
    status: 'note-count',
    handlePrefix: 'note',
    labelPrefix: 'Note',
    countLabel: (count) => `${count} ${count === 1 ? 'note' : 'notes'}`,
    countOf: (list) => list.children.length,
    render: (item, text) => {
      const title = document.createElement('strong');
      title.textContent = text;
      item.append(title);
    },
    role: 'region',
  },
};

const byHandle = (handle) => document.querySelector(`[data-agent-element="${handle}"]`);

/**
 * Stable, human-meaningful handle for an agent target, derived from the entered text.
 * Kept unique by suffixing on collision so two entries with the same words stay
 * addressable. See the convention comment in index.html.
 */
function agentElementFor(prefix, label) {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const base = `${prefix}-${slug || 'item'}`;
  let id = base;
  for (let n = 2; document.querySelector(`[data-agent-element="${id}"]`); n += 1) id = `${base}-${n}`;
  return id;
}

function start() {
  const page = PAGES[document.body.dataset.agentPage];
  if (!page) return;

  const form = byHandle(page.form);
  const input = byHandle(page.input);
  const list = byHandle(page.list);
  const status = byHandle(page.status);
  // Every page is expected to publish all four; bail rather than throw if one is missing, so a
  // half-tagged page degrades to "no interactivity" instead of a broken script.
  if (!form || !input || !list || !status) return;

  const updateCount = () => {
    status.textContent = page.countLabel(page.countOf(list));
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    const item = document.createElement('li');
    page.render(item, text);
    // Tag newly added rows the same way the static ones are tagged, so something the agent
    // just created is immediately addressable by find_elements/highlight/click.
    item.dataset.agentElement = agentElementFor(page.handlePrefix, text);
    item.dataset.agentRole = page.role;
    item.dataset.agentLabel = `${page.labelPrefix}: ${text}`;
    list.append(item);
    input.value = '';
    updateCount();
  });

  list.addEventListener('change', updateCount);
  updateCount();
}

start();
