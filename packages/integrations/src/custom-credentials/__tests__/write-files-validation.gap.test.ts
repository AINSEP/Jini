import { describe, expect, it, vi } from 'vitest';
import { CustomCredentialValidationError } from '../../credentialed-http/sets/store.js';
import { normalizeWriteFilePath, validateBranch, validateCommitMessage, validateRepositoryTarget, validateWriteFilesInput, WRITE_FILES_LIMITS } from '../write-files-validation.js';

const files = [{ path: './docs\\a.md', content: 'A' }];

describe('validateRepositoryTarget', () => {
  it('refuses non-string owner and repo with the offending value', () => {
    const repositoryTargetError = vi.fn(() => null);
    expect(() => validateRepositoryTarget({ owner: 3, repo: 'r', repositoryTargetError })).toThrow(new CustomCredentialValidationError("invalid owner '3'"));
    expect(() => validateRepositoryTarget({ owner: 'o', repo: null, repositoryTargetError })).toThrow("invalid repo 'null'");
    expect(repositoryTargetError).not.toHaveBeenCalled();
  });

  it('passes the provider validator through only when given, and surfaces its refusal', () => {
    const repositoryTargetError = vi.fn((_r: { owner: string; repo: string }, _o?: object) => null as string | null);
    expect(validateRepositoryTarget({ owner: 'o', repo: 'r', repositoryTargetError })).toEqual({ owner: 'o', repo: 'r' });
    expect(repositoryTargetError).toHaveBeenLastCalledWith({ owner: 'o', repo: 'r' }, {});
    const validateTarget = () => null;
    validateRepositoryTarget({ owner: 'o', repo: 'r', repositoryTargetError }, { validateTarget });
    expect(repositoryTargetError).toHaveBeenLastCalledWith({ owner: 'o', repo: 'r' }, { validateTarget });
    repositoryTargetError.mockReturnValueOnce('repo name not allowed');
    expect(() => validateRepositoryTarget({ owner: 'o', repo: 'bad', repositoryTargetError })).toThrow(new CustomCredentialValidationError('repo name not allowed'));
  });
});

describe('branch and commit message', () => {
  it('refuses non-string and pattern-breaking branches, truncating the echo to 60 chars', () => {
    expect(() => validateBranch({ value: 7 })).toThrow("invalid branch name '7'");
    expect(() => validateBranch({ value: `${'b'.repeat(70)} x` })).toThrow(`invalid branch name '${'b'.repeat(60)}'`);
    expect(validateBranch({ value: 'feature/x-1' })).toBe('feature/x-1');
  });

  it('commit message must be a non-blank string within the length cap', () => {
    for (const value of [undefined, '  ', 'x'.repeat(100_000)]) expect(() => validateCommitMessage({ value })).toThrow(/^commitMessage must be 1-\d+ characters$/);
    expect(validateCommitMessage({ value: 'Add docs' })).toBe('Add docs');
  });
});

describe('normalizeWriteFilePath', () => {
  it('normalizes backslashes and dot/empty segments', () => {
    expect(normalizeWriteFilePath({ rawPath: './docs\\\\a.md' })).toBe('docs/a.md');
  });

  it('refuses over-long, NUL, absolute, drive-letter and empty paths with specific reasons', () => {
    expect(() => normalizeWriteFilePath({ rawPath: 'a'.repeat(WRITE_FILES_LIMITS.maxPathLength + 1) })).toThrow(`exceeds the ${WRITE_FILES_LIMITS.maxPathLength}-character cap`);
    expect(() => normalizeWriteFilePath({ rawPath: 'a\0b' })).toThrow('contains a NUL byte');
    expect(() => normalizeWriteFilePath({ rawPath: '/etc/x' })).toThrow("must be relative, not absolute: '/etc/x'");
    expect(() => normalizeWriteFilePath({ rawPath: 'C:\\x' })).toThrow('must be relative, not absolute');
    expect(() => normalizeWriteFilePath({ rawPath: './/.' })).toThrow("is empty or resolves to nothing: './/.'");
    expect(() => normalizeWriteFilePath({ rawPath: 'a/../b' })).toThrow('escapes the repository root');
    expect(() => normalizeWriteFilePath({ rawPath: 'x/.Git/y' })).toThrow("reserved '.git' directory");
  });
});

describe('validateWriteFilesInput', () => {
  it('returns the normalized request', () => {
    expect(validateWriteFilesInput({ branch: 'main', commitMessage: 'm', files })).toEqual({ branch: 'main', commitMessage: 'm', files: [{ path: 'docs/a.md', content: 'A' }] });
  });

  it('refuses missing, empty and over-count file lists', () => {
    for (const bad of [undefined, [], { path: 'a', content: 'b' }]) expect(() => validateWriteFilesInput({ branch: 'main', commitMessage: 'm', files: bad })).toThrow("'files' must be a non-empty array");
    const many = Array.from({ length: WRITE_FILES_LIMITS.maxFiles + 1 }, (_, i) => ({ path: `f${i}`, content: '' }));
    expect(() => validateWriteFilesInput({ branch: 'main', commitMessage: 'm', files: many })).toThrow(`'files' has ${WRITE_FILES_LIMITS.maxFiles + 1} entries, over the ${WRITE_FILES_LIMITS.maxFiles}-file cap`);
  });

  it('refuses malformed entries and an over-cap single file', () => {
    for (const entry of [null, ['a'], { path: 1, content: '' }, { path: 'a', content: 2 }]) {
      expect(() => validateWriteFilesInput({ branch: 'main', commitMessage: 'm', files: [entry] })).toThrow("each entry in 'files' must be an object");
    }
    const big = 'x'.repeat(WRITE_FILES_LIMITS.maxFileBytes + 1);
    expect(() => validateWriteFilesInput({ branch: 'main', commitMessage: 'm', files: [{ path: 'big', content: big }] }))
      .toThrow(`file 'big' is ${WRITE_FILES_LIMITS.maxFileBytes + 1} bytes, over the ${WRITE_FILES_LIMITS.maxFileBytes}-byte per-file cap`);
  });
});
