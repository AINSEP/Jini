/**
 * @file The connection panel in the browser: renders the handler's panel view (account, products,
 * revocation state) and sends the person's choices as declared actions. All wording comes from
 * `connection-view.mjs`; this file only wires buttons to actions.
 *
 * Sign-ins: the panel is a sandboxed frame that cannot open links or popups, so `sign-in` only asks
 * the server to start one; the admin page above the panel then offers "Continue to sign-in" (in the
 * desktop app it opens the system browser). The panel polls the status until the sign-in finishes or
 * its link expires. The Google Account page (to remove access by hand while a revocation is
 * pending) is opened the same way, through the surface client's `openLink`.
 */
import { DISCONNECT_CONFIRM_TEXT, REASSIGN_HINT, connectionSummary, productRows, reassignmentMessage, revocationMessage } from './connection-view.mjs';
import { busy, connectToHost, failureText, h, notice as noticeLine, show, tip, wait } from './dom.mjs';

const POLL_MS = 4000;
let client;
let app;
let notice = null;
/** True while the panel asks "Disconnect and revoke?"; the revocation is sent only from that step. */
let confirmingDisconnect = false;

const call = (action, payload = {}) => client.call({ action, payload });

/** Polls the status after a sign-in started, until the connection changes or the link expires. */
async function followSignIn(before, expiresAt) {
  while (Date.now() < Date.parse(expiresAt)) {
    await wait(POLL_MS);
    const view = await call('status');
    // The sign-in finished: the "continue to sign-in" instruction no longer applies.
    if (JSON.stringify(view.connection) !== JSON.stringify(before.connection)) { notice = null; return render(view); }
  }
  notice = { text: 'The sign-in link expired. Start it again if you still want to change the connection.', tone: 'warn' };
  return render(await call('status'));
}

/** Runs one action from a button; failures become the notice (with "Try again" when the host says
 * a retry can help), never a thrown page error. */
async function run(work) {
  try {
    await busy(app, work);
  } catch (error) {
    notice = { text: failureText(error), retry: error?.retryable === true ? () => run(work) : undefined };
    render(lastView);
  }
}

const SIGN_IN_ACTIONS = { connect: 'connect', reconnect: 'reconnect', switch: 'switch', grant: 'add-scopes' };

/** What each summary button does. */
function onAction(action, view) {
  if (action in SIGN_IN_ACTIONS) return run(async () => {
    const started = await call('sign-in', { action: SIGN_IN_ACTIONS[action] });
    notice = { text: 'Continue with the "Continue to sign-in" button the admin page shows above this panel. This panel updates when you are done.', tone: 'info' };
    render(view);
    await followSignIn(view, started.expiresAt);
  });
  if (action === 'disconnect') { confirmingDisconnect = true; notice = null; return render(view); }
  if (action === 'confirm-disconnect' || action === 'retry-revocation') return run(async () => {
    confirmingDisconnect = false;
    const result = await call('disconnect');
    notice = { text: revocationMessage({ revocation: result.revocation }), tone: result.revocation === 'confirmed' ? 'ok' : 'warn' };
    render(result);
  });
  if (action === 'confirm-switch') return run(async () => {
    const result = await call('confirm-switch', { reassign: tickedDestinations() });
    notice = { text: reassignmentMessage({ reassignment: result.reassignment, destinations: view.destinations }), tone: result.reassignment.failed.length === 0 ? 'ok' : 'warn' };
    render(result);
  });
  return run(async () => { notice = null; render(await call(action)); });
}

/** The form slugs whose "move to the new account" box is ticked right now. */
function tickedDestinations() {
  return [...app.querySelectorAll('input[name="reassign"]')].filter((box) => box.checked).map((box) => box.value);
}

/** One unticked checkbox per destination while a switch is staged: moving one is always a choice. */
function reassignList(destinations) {
  return h('fieldset', { class: 'list reassign' }, [
    h('legend', {}, [REASSIGN_HINT]),
    ...destinations.map((entry) => h('label', { class: 'check' }, [
      h('input', { type: 'checkbox', name: 'reassign', value: entry.formSlug }),
      `${entry.formSlug}: ${entry.title} / ${entry.tabTitle}`,
    ])),
  ]);
}

/**
 * The Google Account page, opened by the admin page (the frame cannot open links): only this
 * surface's declared `linkOrigins` open. The address stays visible in case the host refuses.
 */
function accountAccessLink(url) {
  const open = () => client.openLink({ url }).catch((error) => { notice = { text: failureText(error) }; render(lastView); });
  return h('p', { class: 'account-link' }, [
    'Or remove access yourself:', ' ',
    h('button', { type: 'button', class: 'small', onClick: open }, ['Open Google Account page']),
    ' ', h('span', { class: 'url' }, [url]),
  ]);
}

/** The second step of "Disconnect and revoke": nothing is sent until the person confirms here. */
function disconnectConfirmation(view) {
  const cancel = () => { confirmingDisconnect = false; render(view); };
  return h('div', { class: 'confirm', role: 'group', 'aria-label': 'Confirm disconnect' }, [
    h('p', {}, [DISCONNECT_CONFIRM_TEXT]),
    h('div', { class: 'actions' }, [
      h('button', { type: 'button', class: 'danger', onClick: () => onAction('confirm-disconnect', view) }, ['Yes, disconnect and revoke']),
      h('button', { type: 'button', onClick: cancel }, ['Cancel']),
    ]),
  ]);
}

function connectionCard(view) {
  const summary = connectionSummary({ connection: view.connection });
  const switching = Boolean(view.connection.pendingSwitchAccountLabel);
  // At most one primary action, and none while all is well (connected); the irreversible one reads
  // as dangerous and sits apart at the end.
  const buttonClass = (entry, index) => {
    if (entry.action === 'disconnect') return 'danger-quiet';
    return index === 0 && summary.tone !== 'ok' ? 'primary' : undefined;
  };
  return h('section', { class: 'card', 'aria-labelledby': 'account-heading' }, [
    h('div', { class: 'head' }, [
      h('span', { class: `dot ${summary.tone}`, 'aria-hidden': 'true' }),
      h('h2', { id: 'account-heading' }, [summary.heading]),
      tip('About the Google connection', summary.detail),
    ]),
    switching && view.destinations.length > 0 ? reassignList(view.destinations) : null,
    h('div', { class: 'actions' }, summary.buttons.map((entry, index) => h('button', { type: 'button', class: buttonClass(entry, index), onClick: () => onAction(entry.action, view) }, [entry.label]))),
    confirmingDisconnect ? disconnectConfirmation(view) : null,
    view.connection.status === 'revocation-pending' ? accountAccessLink(view.accountAccessUrl) : null,
  ]);
}

function productsCard(view) {
  const rows = productRows({ products: view.products, connection: view.connection });
  return h('section', { class: 'card', 'aria-labelledby': 'products-heading' }, [
    h('div', { class: 'head' }, [
      h('h2', { id: 'products-heading' }, ['Products']),
      tip('About products', 'Turning a product on or off changes only what this site does; it never changes what Google granted.'),
    ]),
    h('ul', { class: 'rows' }, rows.map((row) => h('li', { class: 'product' }, [
      h('div', { class: 'product-name' }, [
        h('span', { class: 'name-line' }, [h('strong', {}, [row.label]), tip(`About ${row.label}`, row.note)]),
        h('span', { class: row.grant ? 'state warn' : 'state' }, [row.state]),
      ]),
      row.grant ? h('button', { type: 'button', class: 'primary small', onClick: () => onAction('grant', view) }, ['Grant permission']) : null,
      // A switch drawn from the toggle button: the visible track is decoration; its text is the action.
      h('button', { type: 'button', class: 'switch', 'aria-pressed': String(row.enabled), onClick: () => run(async () => { notice = null; render(await call('set-product', { productId: row.id, enabled: !row.enabled })); }) }, [
        h('span', { class: 'sr-only' }, [row.toggleLabel]),
      ]),
    ]))),
  ]);
}

let lastView = null;

function render(view) {
  lastView = view;
  // A null view only comes from a failed first `status`, which always sets the notice first (and
  // with no view there are no buttons, so no later action can render null again).
  if (view === null) return show(app, noticeLine(notice));
  return show(app,
    notice ? noticeLine(notice) : null,
    connectionCard(view),
    productsCard(view));
}

/**
 * Starts the panel in a frame: connects to the host and renders the status once the host's init
 * arrives. Exported so a test can start a fresh panel (fresh state) in its own jsdom window; the
 * last line starts the real one.
 * @param {{ window: Window, document: Document }} required
 */
export function initConnectionPanel(required) {
  client = connectToHost({ window: required.window });
  app = required.document.getElementById('app');
  notice = null;
  confirmingDisconnect = false;
  lastView = null;
  client.ready.then(load);
}

/** The first `status`; a failure the host calls retryable offers "Try again" (another `status`). */
function load() {
  return call('status').then(render, (error) => { notice = { text: failureText(error), retry: error?.retryable === true ? load : undefined }; render(null); });
}

initConnectionPanel({ window, document });
