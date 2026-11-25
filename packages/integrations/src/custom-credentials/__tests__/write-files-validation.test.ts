import assert from 'node:assert/strict';
import { test } from 'vitest';
import { CustomCredentialValidationError } from '../../credentialed-http/sets/store.js';
import { validateWriteFilesInput, normalizeWriteFilePath, validateBranch, WRITE_FILES_LIMITS } from '../write-files-validation.js';

test('normalization collisions fail before writing', () => {
  assert.throws(() => validateWriteFilesInput({ branch: 'main', commitMessage: 'Write', files: [{ path: './a\\b', content: 'first' }, { path: 'a/b', content: 'second' }] }), /duplicate file path 'a\/b'/);
});

test('limits are checked on aggregate bytes', () => {
  const content = 'é'.repeat(WRITE_FILES_LIMITS.maxFileBytes / 2);
  assert.throws(() => validateWriteFilesInput({ branch: 'main', commitMessage: 'Write', files: Array.from({ length: 5 }, (_, index) => ({ path: `file-${index}`, content })) }), /aggregate cap/);
});

test('reserved git segments and dotdot paths are refused after slash normalization', () => {
  for (const rawPath of ['.GIT/hooks/x', 'a/.git', '../x', 'a/../b', 'a\\..\\b']) {
    assert.throws(() => normalizeWriteFilePath({ rawPath }), CustomCredentialValidationError);
  }
});

test('branch dotdot and empty segments are refused', () => {
  for (const value of ['../tags/r', 'a//b']) assert.throws(() => validateBranch({ value }), CustomCredentialValidationError);
});
