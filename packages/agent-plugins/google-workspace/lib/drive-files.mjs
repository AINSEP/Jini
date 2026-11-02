/**
 * @file Drive helpers shared by every Google Workspace product: who the connection is signed in as
 * and whole-file copy (`files.copy`, used by `sheets_copy`). File metadata reads (`files.get`) stay
 * with their callers (Picker verification, `sheets_open_existing`) and share `DRIVE_FILES_URL` here.
 *
 * Exists so identity costs no extra permission: Drive `about.get` answers under `drive.file`, so
 * the sign-in never adds `openid`, `email` or `profile` scopes just to learn the account.
 * `permissionId` is the account's stable Drive id; the email is only for display.
 */
import { pathSegment } from './http.mjs';
import { GoogleWorkspaceError } from './request-policy.mjs';

export const DRIVE_ABOUT_URL = 'https://www.googleapis.com/drive/v3/about';
export const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const COPY_FIELDS = 'id,name,mimeType,webViewLink';

/**
 * The signed-in account: `{ accountId, displayName }`.
 * @param {{ client: { request(input: object, options?: object): Promise<unknown> }, connectionRef: string }} required
 * @param {{ signal?: AbortSignal }} [optional]
 * @throws {GoogleWorkspaceError} `unexpected-response` when Google's answer names no account.
 * @complexity O(1): one request.
 */
export async function readAccount(required, optional = {}) {
  const body = await required.client.request({
    connectionRef: required.connectionRef, url: DRIVE_ABOUT_URL, kind: 'read',
    query: { fields: 'user(displayName,emailAddress,permissionId)' },
  }, optional);
  const user = body?.user;
  if (typeof user?.permissionId !== 'string' || user.permissionId === '') throw new GoogleWorkspaceError({ code: 'unexpected-response' });
  const label = [user.emailAddress, user.displayName].find((value) => typeof value === 'string' && value !== '');
  return { accountId: user.permissionId, displayName: label ?? 'Google account' };
}

/**
 * Copies one file the connection can open (`files.copy`); the copy is created by the site, so
 * `drive.file` grants it automatically. A copy is not idempotent: an unknown outcome is
 * `uncertain-outcome` and is never replayed (the shared client's `write` kind).
 * @param {{ client: { request(input: object, options?: object): Promise<unknown> }, connectionRef: string, fileId: string, name: string }} required
 * @param {{ parentId?: string, signal?: AbortSignal }} [optional] `parentId`: a folder the connection can open.
 * @returns {Promise<{ fileId: string, name: string, mimeType: string, url: string | undefined }>}
 * @throws {GoogleWorkspaceError} `unexpected-response` when Google's answer names no file id.
 * @complexity O(1): one request.
 */
export async function copyFile(required, optional = {}) {
  const body = await required.client.request({
    connectionRef: required.connectionRef, kind: 'write', method: 'POST',
    url: `${DRIVE_FILES_URL}/${pathSegment({ value: required.fileId })}/copy`,
    query: { fields: COPY_FIELDS, supportsAllDrives: 'true' },
    body: { name: required.name, ...(optional.parentId === undefined ? {} : { parents: [optional.parentId] }) },
  }, optional.signal ? { signal: optional.signal } : {});
  if (typeof body?.id !== 'string' || body.id === '') throw new GoogleWorkspaceError({ code: 'unexpected-response', outcome: 'unknown' });
  return { fileId: body.id, name: body.name, mimeType: body.mimeType, url: body.webViewLink };
}
