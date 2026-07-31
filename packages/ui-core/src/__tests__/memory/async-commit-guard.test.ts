import { describe, expect, it } from 'vitest';
import { createAsyncCommitGuard } from '../../memory/async-commit-guard.js';

describe('createAsyncCommitGuard', () => {
  it('begin() advances the revision and isCurrent() only matches the latest', () => {
    const guard = createAsyncCommitGuard();
    const first = guard.begin();
    const second = guard.begin();
    expect(first).not.toBe(second);
    expect(guard.isCurrent(first)).toBe(false);
    expect(guard.isCurrent(second)).toBe(true);
  });

  it('capture() reads the current revision without advancing it', () => {
    const guard = createAsyncCommitGuard();
    guard.begin();
    const captured = guard.capture();
    expect(guard.isCurrent(captured)).toBe(true);
    expect(guard.capture()).toBe(captured);
  });

  it('invalidate() moves the revision forward, staling every earlier begin()/capture()', () => {
    const guard = createAsyncCommitGuard();
    const started = guard.begin();
    expect(guard.isCurrent(started)).toBe(true);
    guard.invalidate();
    expect(guard.isCurrent(started)).toBe(false);
  });

  it('a fresh guard starts current at revision 0, before any begin() call', () => {
    const guard = createAsyncCommitGuard();
    expect(guard.isCurrent(0)).toBe(true);
    expect(guard.isCurrent(-1)).toBe(false);
    expect(guard.capture()).toBe(0);
  });
});
