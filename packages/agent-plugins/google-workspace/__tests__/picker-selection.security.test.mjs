/**
 * @file Security pins for `lib/picker-selection.mjs` (phase A, G13): a Picker selection is trusted
 * only after the server re-checks it. Covers id safety (no path or query injection into Google
 * URLs), the account the Picker was opened for, the spreadsheet MIME type, real Sheets API access,
 * that refusals never echo Google text or the token, and the desktop `picked_file_ids` callback field.
 * Every request goes to the 127.0.0.1 fake; any other host throws.
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

import { createGoogleClient } from '../lib/http.mjs';
import { DESKTOP_PICKER_START_PARAMS, SPREADSHEET_MIME_TYPE, parsePickedFileIds, verifySelectedSpreadsheet } from '../lib/picker-selection.mjs';
import { startFakeGoogle } from './fake-google-http.mjs';

const FILE_ID = '1AbC-dEf_ghIJklmnOPqrs';
const ACCOUNT = 'perm-alice';
let fake;
const token = 'ya' + '29.' + 'p'.repeat(40);

before(async () => { fake = await startFakeGoogle({ clients: {} }); });
after(async () => { await fake.close(); });
beforeEach(() => { fake.reset(); });

function client() {
  return createGoogleClient({ http: { fetch: fake.fetch }, connections: { getAccessToken: async () => token } });
}

function serve({ accountId = ACCOUNT, mimeType = SPREADSHEET_MIME_TYPE, fileStatus = 200, sheetsStatus = 200, sheetsId = FILE_ID, driveId = FILE_ID, trashed = false } = {}) {
  fake.route({ method: 'GET', path: '/drive/v3/about' }, () => [200, { user: { permissionId: accountId, emailAddress: 'alice@example.test' } }]);
  fake.route({ method: 'GET', path: `/drive/v3/files/${FILE_ID}` }, () => fileStatus === 200
    ? [200, { id: driveId, name: 'Leads', mimeType, trashed }]
    : [fileStatus, { error: { code: fileStatus, message: `File not found: ${FILE_ID} for ${token}`, status: 'NOT_FOUND' } }]);
  fake.route({ method: 'GET', path: `/v4/spreadsheets/${FILE_ID}` }, () => sheetsStatus === 200
    ? [200, { spreadsheetId: sheetsId, properties: { title: 'Leads' } }]
    : [sheetsStatus, { error: { code: sheetsStatus, message: `Requested entity was not found: ${FILE_ID}`, status: 'NOT_FOUND', errors: [{ reason: 'notFound' }] } }]);
}

const verify = (fileId = FILE_ID, expectedAccountId = ACCOUNT) => verifySelectedSpreadsheet({ client: client(), connectionRef: 'ref-1', fileId, expectedAccountId });

test('verified: a spreadsheet the account can open returns metadata only (id, title, account, link)', async () => {
  serve();
  assert.deepEqual(await verify(), { spreadsheetId: FILE_ID, title: 'Leads', accountId: ACCOUNT, url: `https://docs.google.com/spreadsheets/d/${FILE_ID}/edit` });
});

test('verified: Drive metadata AND the Sheets API are both called, in that order (real API access)', async () => {
  serve();
  await verify();
  assert.deepEqual(fake.requests.map((request) => `${request.host} ${request.path}`), [
    'www.googleapis.com /drive/v3/about', `www.googleapis.com /drive/v3/files/${FILE_ID}`, `sheets.googleapis.com /v4/spreadsheets/${FILE_ID}`]);
});

for (const bad of ['../about', 'a/b', 'abc?x=1', 'abc#x', '%2e%2e', 'short', 'x'.repeat(201), '', ' 1AbCdEfghIJklmn ', 42, null]) {
  test(`path safety: file id ${JSON.stringify(bad)} is refused before any request (invalid-selection)`, async () => {
    await assert.rejects(verify(bad), { name: 'GoogleWorkspaceError', code: 'invalid-selection', nextAction: 're-pick-file' });
    assert.equal(fake.requests.length, 0);
  });
}

test('authorization: a selection made for another account is refused (account-changed) before the file is read', async () => {
  serve({ accountId: 'perm-bob' });
  await assert.rejects(verify(), { code: 'account-changed', nextAction: 'review-account' });
  assert.deepEqual(fake.requests.map((request) => request.path), ['/drive/v3/about']);
});

test('trashed: a spreadsheet in the trash is refused (file-not-granted, re-pick), the Sheets API is not called', async () => {
  serve({ trashed: true });
  await assert.rejects(verify(), { code: 'file-not-granted', nextAction: 're-pick-file' });
  assert.equal(fake.requests.some((request) => request.host === 'sheets.googleapis.com'), false);
});

test('MIME: a file that is not a Google Sheets spreadsheet is refused (not-a-spreadsheet), the Sheets API is not called', async () => {
  serve({ mimeType: 'application/vnd.google-apps.document' });
  await assert.rejects(verify(), { code: 'not-a-spreadsheet', nextAction: 're-pick-file' });
  assert.equal(fake.requests.some((request) => request.host === 'sheets.googleapis.com'), false);
});

test('access: a file the drive.file grant does not cover is refused with a re-pick next step, never Google text or the token', async () => {
  serve({ fileStatus: 404 });
  await assert.rejects(verify(), (error) => error.code === 'file-not-granted' && error.nextAction === 're-pick-file'
    && !error.message.includes(FILE_ID) && !error.message.includes(token) && !JSON.stringify(error).includes(token));
});

test('access: Drive metadata alone is not enough; a Sheets API refusal refuses the selection', async () => {
  serve({ sheetsStatus: 404 });
  await assert.rejects(verify(), (error) => error.code === 'file-not-granted' && !error.message.includes(FILE_ID));
});

test('integrity: a Drive answer naming another file is refused (unexpected-response)', async () => {
  serve({ driveId: 'someOtherFileId123' });
  await assert.rejects(verify(), { code: 'unexpected-response' });
});

test('integrity: a Sheets answer naming another spreadsheet is refused (unexpected-response)', async () => {
  serve({ sheetsId: 'someOtherSheetId123' });
  await assert.rejects(verify(), { code: 'unexpected-response' });
});

test('desktop: picked_file_ids with one valid id yields that id', () => {
  assert.equal(parsePickedFileIds({ value: FILE_ID }), FILE_ID);
});

test('desktop: an absent or empty picked_file_ids is a cancel (null), leaving settings unchanged', () => {
  assert.equal(parsePickedFileIds({ value: undefined }), null);
  assert.equal(parsePickedFileIds({ value: '' }), null);
});

for (const bad of [`${FILE_ID},${FILE_ID}x`, '../about', `${FILE_ID}/x`, `${FILE_ID}&x=1`, 'x'.repeat(4097)]) {
  test(`desktop: picked_file_ids ${JSON.stringify(bad.slice(0, 40))} is refused (invalid-selection), never echoed`, () => {
    assert.throws(() => parsePickedFileIds({ value: bad }), (error) => error.code === 'invalid-selection' && !error.message.includes(bad.slice(0, 12)));
  });
}

test('desktop: native Picker start params ask for one spreadsheet only', () => {
  assert.deepEqual({ ...DESKTOP_PICKER_START_PARAMS }, { trigger_onepick: 'true', mimetypes: SPREADSHEET_MIME_TYPE });
  assert.equal(SPREADSHEET_MIME_TYPE, 'application/vnd.google-apps.spreadsheet');
});
