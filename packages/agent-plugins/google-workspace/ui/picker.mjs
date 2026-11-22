/**
 * @file The "Choose spreadsheet" panel in the browser: one button that runs the Picker flow, and the
 * list of spreadsheets already chosen (metadata the server verified and saved). Their ids are what a
 * person gives chat or the form-destination panel; a pasted link grants nothing.
 */
import { connectToHost, failureText, h, notice, show, tip } from './dom.mjs';
import { chooseSpreadsheet } from './picker-flow.mjs';
import { CANCELLED_TEXT, pickerIntro, selectedText } from './picker-view.mjs';

let client;
let app;
let status;
/** 'info' while choosing or after a choice, 'error' after a failure (the status line's colour). */
let statusTone;
let waiting;
let stopRequested;
let picked;

function render(bootstrap) {
  const ready = bootstrap !== undefined && bootstrap.mode !== 'unavailable';
  // Ready: the intro is the heading's explanation and Choose sits in the header; otherwise the
  // reason it is unavailable is the visible notice.
  show({ root: app },
    { nodes: [ready ? null : h({ tag: 'p' }, { props: { class: 'notice warn intro' }, children: [pickerIntro({ bootstrap })] }),
    status ? notice({ text: status, tone: statusTone }) : null,
    h({ tag: 'section' }, { props: { class: 'card', 'aria-labelledby': 'picked-heading' }, children: [
      h({ tag: 'div' }, { props: { class: 'head' }, children: [
        h({ tag: 'h2' }, { props: { id: 'picked-heading' }, children: ['Chosen spreadsheets'] }),
        ready ? tip({ label: 'About choosing a spreadsheet', text: pickerIntro({ bootstrap }) }, { bodyClass: 'intro' }) : null,
        ready ? h({ tag: 'div' }, { props: { class: 'actions end' }, children: [
          h({ tag: 'button' }, { props: { type: 'button', class: 'primary', disabled: waiting, onClick: () => choose(bootstrap) }, children: ['Choose spreadsheet'] }),
          waiting && bootstrap.mode === 'system-browser' ? h({ tag: 'button' }, { props: { type: 'button', onClick: () => { stopRequested = true; status = 'Stopping…'; render(bootstrap); } }, children: ['Stop waiting'] }) : null,
        ] }) : null,
      ] }),
      picked.length === 0 ? h({ tag: 'p' }, { props: { class: 'muted empty' }, children: ['None yet.'] }) : h({ tag: 'ul' }, { props: { class: 'rows' }, children: picked.map((sheet) => h({ tag: 'li' }, { props: { class: 'sheet' }, children: [
        h({ tag: 'strong' }, { props: {}, children: [sheet.title] }), ' ', h({ tag: 'code' }, { props: {}, children: [sheet.spreadsheetId] }),
      ] })) }),
    ] })] });
}

async function refresh(bootstrap) {
  picked = (await client.call({ action: 'list-picked', payload: {} })).spreadsheets;
  render(bootstrap);
}

async function choose(bootstrap) {
  waiting = true;
  stopRequested = false;
  status = '';
  statusTone = 'info';
  render(bootstrap);
  try {
    // The Choose button stays disabled while waiting; "Stop waiting" stays usable.
    const chosen = await chooseSpreadsheet({ client, bootstrap, onStatus: (text) => { status = text; render(bootstrap); }, stopped: () => stopRequested });
    if (chosen) status = selectedText({ spreadsheet: chosen });
    else status ||= CANCELLED_TEXT;
  } catch (error) {
    status = failureText({ error });
    statusTone = 'error';
  }
  waiting = false;
  // A failed refresh must still re-render: the last render showed Choose disabled (waiting).
  await refresh(bootstrap).catch((error) => { status = failureText({ error }); statusTone = 'error'; render(bootstrap); });
}

/**
 * Starts the panel in a frame: connects to the host and lists the chosen spreadsheets once the host's
 * init arrives. Exported so a test can start a fresh panel (fresh state) in its own jsdom window; the
 * last line starts the real one.
 * @param {{ window: Window, document: Document }} required
 */
export function initPickerPanel(required, _optional = {}) {
  client = connectToHost({ window: required.window });
  app = required.document.getElementById('app');
  status = '';
  statusTone = 'info';
  waiting = false;
  stopRequested = false;
  picked = [];
  client.ready.then(load);
}

/** The first list; a failure the host calls retryable offers "Try again" (another list). */
function load() {
  return refresh(client.bootstrap()).catch((error) => show({ root: app }, { nodes: [notice({ text: failureText({ error }), retry: error?.retryable === true ? load : undefined })] }));
}

initPickerPanel({ window, document });
