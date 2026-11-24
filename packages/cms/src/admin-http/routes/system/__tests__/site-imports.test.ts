import { describe, expect, it } from 'vitest';
import {
  importIncident, importStep, importUnavailableReply, mapImportFailure, ownerSetupBody, parseOwnerSetupBody, uploadBusyReply,
  workspaceUnavailableReply, type SiteImportFailureCollaborators,
} from '../site-imports.js';

class Refusal extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

const collaborators: SiteImportFailureCollaborators = {
  asRefusal: ({ error }) => (error instanceof Refusal ? error : undefined),
  formatByteSize: ({ bytes }) => `${bytes / 1024 / 1024} MiB`,
};
const map = (error: unknown, step = 'ZIP upload') => mapImportFailure({ step, error, collaborators });

describe('importStep', () => {
  it.each([
    ['GET', '/api/x/site-imports', 'Import history'],
    ['POST', '/api/x/site-imports', 'Archive verification'],
    ['POST', '/api/x/site-imports/uploads', 'ZIP upload'],
    ['GET', '/api/x/site-imports/:importId/owner', 'Import owner setup'],
    ['POST', '/api/x/site-imports/:importId/owner', 'Imported site creation'],
    ['DELETE', '/api/x/site-imports', 'Site import'],
    ['GET', '', 'Import history'],
    ['PUT', '', 'Site import'],
  ])('%s %s is %s', (method, routePath, step) => {
    expect(importStep({ method, routePath })).toBe(step);
  });
});

describe('mapImportFailure', () => {
  it('maps a NOT_FOUND refusal to 404 and any other refusal to 400, prefixed with the step', () => {
    expect(map(new Refusal('NOT_FOUND', 'Import not found.'))).toEqual({ status: 404, body: { code: 'NOT_FOUND', message: 'ZIP upload failed: Import not found.' } });
    expect(map(new Refusal('INVALID_INPUT', 'Bad archive'))).toEqual({ status: 400, body: { code: 'INVALID_INPUT', message: 'ZIP upload failed: Bad archive' } });
  });

  it('maps the parser limit to 413 LIMIT_EXCEEDED with the formatted byte limit', () => {
    expect(map({ type: 'entity.too.large', limit: 300 * 1024 * 1024 })).toEqual({ status: 413, body: { code: 'LIMIT_EXCEEDED', message: 'ZIP upload failed: the request is over the 300 MiB limit for this step.' } });
  });

  it.each([
    ['encoding.unsupported', 'send an uncompressed request body.'],
    ['entity.parse.failed', 'the request body could not be parsed.'],
    ['request.aborted', 'the request ended before the complete body arrived.'],
    ['request.size.invalid', 'the body size does not match the Content-Length header.'],
  ])('maps parser error %s to a 400 IMPORT_FAILED', (type, message) => {
    expect(map({ type }, 'Import history')).toEqual({ status: 400, body: { code: 'IMPORT_FAILED', message: `Import history failed: ${message}` } });
  });

  it('leaves a backend failure, an unknown parser type and a nullish error for the host incident path', () => {
    expect(map(new Error('SECRET private disk path'))).toBeUndefined();
    expect(map({ type: 'something.else' })).toBeUndefined();
    expect(map(undefined)).toBeUndefined();
    expect(map(null)).toBeUndefined();
  });
});

describe('fixed answers', () => {
  it('describes the incident the host reports', () => {
    expect(importIncident({ step: 'ZIP upload' })).toEqual({ operation: 'site-import:ZIP upload', code: 'IMPORT_FAILED', message: 'ZIP upload failed. No existing site was changed.', field: 'message' });
  });

  it('answers the shared gate and the upload lane with their fixed bodies', () => {
    expect(workspaceUnavailableReply({ step: 'Import history' })).toEqual({ status: 404, body: { code: 'NOT_FOUND', message: 'Import history failed: this workspace is not available.' } });
    expect(importUnavailableReply({ step: 'Import history' })).toEqual({ status: 503, body: { code: 'UNAVAILABLE', message: 'Import history requires local site creation and a configured sites home.' } });
    expect(uploadBusyReply()).toEqual({ status: 409, body: { code: 'BUSY', message: 'Another ZIP upload is running.' } });
  });
});

describe('owner setup', () => {
  it('adds the saved-keys field to the contract only when the import has encrypted keys', () => {
    const base = { method: 'POST', field: 'adminPassword', username: 'admin', sessionRequired: true };
    expect(ownerSetupBody({ imported: { id: 'a', hasEncryptedKeys: true } })).toEqual({ id: 'a', hasEncryptedKeys: true, ownerSetup: { ...base, savedKeysPasswordField: 'savedKeysPassword' } });
    expect(ownerSetupBody({ imported: { id: 'b', hasEncryptedKeys: false } }).ownerSetup).toEqual(base);
    const unflagged: { id: string; hasEncryptedKeys?: boolean } = { id: 'c' };
    expect(ownerSetupBody({ imported: unflagged }).ownerSetup).toEqual(base);
  });

  it('accepts only the two password fields and keeps an absent saved keys password absent', () => {
    expect(parseOwnerSetupBody({ body: { adminPassword: 'p' } })).toEqual({ input: { adminPassword: 'p' } });
    expect(parseOwnerSetupBody({ body: { adminPassword: 'p', savedKeysPassword: 'k' } })).toEqual({ input: { adminPassword: 'p', savedKeysPassword: 'k' } });
    expect(Object.keys((parseOwnerSetupBody({ body: { adminPassword: 'p' } }) as { input: object }).input)).toEqual(['adminPassword']);
  });

  it('refuses a missing body or any extra field with the fixed message', () => {
    const refusal = { refusal: 'Only the new owner password and optional saved keys password are accepted.' };
    expect(parseOwnerSetupBody({ body: undefined })).toEqual(refusal);
    expect(parseOwnerSetupBody({ body: { adminPassword: 'p', extra: 'x' } })).toEqual(refusal);
  });
});
