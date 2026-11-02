/**
 * @file The form-destination panel in the browser: lists each form's saved spreadsheet and tab, and
 * lets a person choose a spreadsheet (a picked one, or the Picker flow), a tab, and save. The server
 * re-verifies the spreadsheet and tab on every save; this file only collects the choice.
 *
 * A saved destination is the form's delivery binding (the server writes it), so there is nothing to
 * copy anywhere. Saving needs the "rows stay in the spreadsheet" confirmation, because removing a destination here
 * (or deleting a form or submission on the site) never deletes rows Google already holds.
 */
import { connectToHost, failureText, h, notice, show, tip } from './dom.mjs';
import { chooseSpreadsheet } from './picker-flow.mjs';
import { CANCELLED_TEXT, EXTERNAL_ROWS_NOTE, pickerIntro } from './picker-view.mjs';

let client;
let app;
let draft;
let view;
let status;
/** 'error' after a failed step, else 'info' (the status line's colour). */
let statusTone;
/** Re-runs the failed step when the host said a retry can help ("Try again"), else undefined. */
let statusRetry;
let bootstrap;

const call = (action, payload = {}) => client.call({ action, payload });

/** Runs one server step; its failure becomes the status line. */
async function step(work) {
  statusTone = 'info';
  statusRetry = undefined;
  try {
    await work();
  } catch (error) {
    status = failureText(error);
    statusTone = 'error';
    statusRetry = error?.retryable === true ? () => step(work) : undefined;
  }
  render();
}

/** A spreadsheet became the draft's: load its tabs (the server verifies access first). */
async function useSpreadsheet(spreadsheetId) {
  const { spreadsheet, tabs } = await call('list-tabs', { spreadsheetId });
  Object.assign(draft, { spreadsheet, tabs, sheetId: tabs[0]?.sheetId ?? null });
}

function savedList() {
  if (view.destinations.length === 0) return h('p', { class: 'muted empty' }, ['No form sends to Google Sheets yet.']);
  return h('ul', { class: 'rows' }, view.destinations.map((entry) => h('li', { class: 'card destination' }, [
    h('p', {}, [h('strong', {}, [entry.formSlug]), ` → ${entry.title} / ${entry.tabTitle}`]),
    entry.sameAccount === false ? h('p', { class: 'notice warn' }, ['Chosen with a different Google account than the one connected now. Choose its spreadsheet again.']) : null,
    h('div', { class: 'actions' }, [h('button', { type: 'button', class: 'small', onClick: () => step(async () => { view = await call('remove-destination', { formSlug: entry.formSlug }); status = `Removed ${entry.formSlug}. ${EXTERNAL_ROWS_NOTE}`; statusTone = 'ok'; }) }, ['Remove'])]),
  ])));
}

function spreadsheetChooser() {
  const options = view.picked.map((sheet) => h('option', { value: sheet.spreadsheetId, ...(draft.spreadsheet?.spreadsheetId === sheet.spreadsheetId ? { selected: true } : {}) }, [sheet.title]));
  return h('div', { class: 'field-stack' }, [
    view.picked.length > 0 ? h('label', {}, ['Spreadsheet', h('select', { onChange: (event) => step(() => useSpreadsheet(event.target.value)) }, [h('option', { value: '' }, ['Choose…']), ...options])]) : null,
    // Same rule as the Picker panel: no start data (or an unavailable mode) means nothing to open.
    bootstrap !== undefined && bootstrap.mode !== 'unavailable' ? h('button', { type: 'button', onClick: () => step(async () => {
      const chosen = await chooseSpreadsheet({ client, bootstrap, onStatus: (text) => { status = text; render(); } });
      if (chosen === null) { status = CANCELLED_TEXT; return; }
      status = '';
      await useSpreadsheet(chosen.spreadsheetId);
      view = await call('list-destinations');
    }) }, ['Choose another spreadsheet']) : null,
  ]);
}

function tabChooser() {
  if (draft.spreadsheet === null) return null;
  return h('label', {}, ['Tab', h('select', { onChange: (event) => { draft.sheetId = Number(event.target.value); } },
    draft.tabs.map((tab) => h('option', { value: String(tab.sheetId), ...(tab.sheetId === draft.sheetId ? { selected: true } : {}) }, [tab.title])))]);
}

/** Site choices use their stable slug as the value and their title as plain text. An empty list
 * still means discovery is supported; typing is only for hosts that lack the capability.
 * @complexity O(f) for the host's at most 200 choices. */
function formChooser() {
  if (view.forms === undefined) return h('label', {}, ['Form short name', h('input', { type: 'text', value: draft.formSlug, maxlength: '64', autocomplete: 'off', onInput: (event) => { draft.formSlug = event.target.value.trim(); } })]);
  return h('label', {}, ['Form', h('select', { name: 'formSlug', ...(view.forms.length === 0 ? { disabled: true } : {}), onChange: (event) => { draft.formSlug = event.target.value; } }, [
    h('option', { value: '' }, [view.forms.length === 0 ? 'No forms available' : 'Choose a form…']),
    ...view.forms.map((form) => h('option', { value: form.slug, ...(draft.formSlug === form.slug ? { selected: true } : {}) }, [form.title])),
  ])]);
}

/** What the person still has to fill in before a save can work, or null. @complexity O(f), at most 200 form choices. */
function missingForSave() {
  if (view.forms !== undefined && !view.forms.some((form) => form.slug === draft.formSlug)) return 'Choose a form.';
  if (draft.formSlug === '') return "Enter the form's short name.";
  if (draft.spreadsheet === null) return 'Choose a spreadsheet.';
  if (!draft.confirmed) return 'Tick the box to confirm rows stay in the spreadsheet.';
  return null;
}

function editor() {
  const ready = bootstrap !== undefined && bootstrap.mode !== 'unavailable';
  return h('section', { class: 'card', 'aria-labelledby': 'add-heading' }, [
    h('div', { class: 'head' }, [
      h('h2', { id: 'add-heading' }, ['Send a form to a spreadsheet']),
      ready ? tip('About choosing a spreadsheet', pickerIntro({ bootstrap }), { bodyClass: 'intro' }) : null,
    ]),
    formChooser(),
    spreadsheetChooser(),
    tabChooser(),
    h('label', { class: 'check confirm-rows' }, [h('input', { type: 'checkbox', ...(draft.confirmed ? { checked: true } : {}), onChange: (event) => { draft.confirmed = event.target.checked; } }), EXTERNAL_ROWS_NOTE]),
    h('div', { class: 'actions' }, [h('button', { type: 'button', class: 'primary', onClick: () => step(async () => {
      // Checked here first so the person reads what is missing, not the host's schema refusal.
      const missing = missingForSave();
      if (missing !== null) { status = missing; statusTone = 'error'; return; }
      view = await call('save-destination', { formSlug: draft.formSlug, spreadsheetId: draft.spreadsheet?.spreadsheetId ?? '', sheetId: draft.sheetId ?? 0, confirmExternalRows: draft.confirmed });
      // A save only succeeds with a chosen spreadsheet: the declared input refuses an empty
      // spreadsheetId (minLength 1), and that id is non-empty only once `draft.spreadsheet` is set.
      status = `Saved: ${draft.formSlug} sends to ${draft.spreadsheet.title}.`;
      statusTone = 'ok';
    }) }, ['Save destination'])]),
  ]);
}

function render() {
  // Not ready (no start data, Sheets off, not connected): the reason is the visible notice.
  const ready = bootstrap !== undefined && bootstrap.mode !== 'unavailable';
  show(app,
    ready ? null : h('p', { class: 'notice warn intro' }, [pickerIntro({ bootstrap })]),
    status ? notice({ text: status, tone: statusTone, retry: statusRetry }) : null,
    ...(view === undefined ? [] : [
      h('section', { class: 'card', 'aria-labelledby': 'saved-heading' }, [h('h2', { id: 'saved-heading' }, ['Saved destinations']), savedList()]),
      editor(),
    ]));
}

/**
 * Starts the panel in a frame: connects to the host and loads the saved destinations once the host's
 * init arrives. Exported so a test can start a fresh panel (fresh draft) in its own jsdom window; the
 * last line starts the real one.
 * @param {{ window: Window, document: Document }} required
 */
export function initDestinationPanel(required) {
  client = connectToHost({ window: required.window });
  app = required.document.getElementById('app');
  draft = { formSlug: '', spreadsheet: null, tabs: [], sheetId: null, confirmed: false };
  view = undefined;
  status = '';
  statusTone = 'info';
  bootstrap = undefined;
  client.ready.then(() => { bootstrap = client.bootstrap(); return step(async () => { view = await call('list-destinations'); }); });
}

initDestinationPanel({ window, document });
