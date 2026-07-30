import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { expandHomePrefix, resolveProjectRelativePath } from '../home-expansion.js';

describe('@jini-ai/platform — home-expansion', () => {
  it('expands a bare home token', () => {
    expect(expandHomePrefix('~')).toBe(os.homedir());
    expect(expandHomePrefix('$HOME')).toBe(os.homedir());
    expect(expandHomePrefix('${HOME}')).toBe(os.homedir());
  });

  it('expands a forward-slash-prefixed shorthand', () => {
    expect(expandHomePrefix('~/data')).toBe(path.join(os.homedir(), 'data'));
    expect(expandHomePrefix('$HOME/data')).toBe(path.join(os.homedir(), 'data'));
    expect(expandHomePrefix('${HOME}/data')).toBe(path.join(os.homedir(), 'data'));
  });

  it('expands a back-slash-prefixed shorthand the same as forward-slash', () => {
    expect(expandHomePrefix('~\\data')).toBe(path.join(os.homedir(), 'data'));
    // Only the shorthand's own separator (matched by the regex) is
    // normalized via path.join; a further embedded backslash in the tail is
    // passed through as-is — path.join only treats `/` as a separator on
    // POSIX, matching the original OD behavior this is a verbatim port of.
    expect(expandHomePrefix('$HOME\\nested\\dir')).toBe(path.join(os.homedir(), 'nested\\dir'));
  });

  it('passes through absolute paths, plain relative paths, and other $VARS unchanged', () => {
    expect(expandHomePrefix('/already/absolute')).toBe('/already/absolute');
    expect(expandHomePrefix('relative/dir')).toBe('relative/dir');
    expect(expandHomePrefix('$OTHER/dir')).toBe('$OTHER/dir');
  });

  it('resolves an absolute expansion regardless of projectRoot', () => {
    expect(resolveProjectRelativePath('~/data', '/project/root')).toBe(path.join(os.homedir(), 'data'));
    expect(resolveProjectRelativePath('/abs/dir', '/project/root')).toBe('/abs/dir');
  });

  it('resolves a relative value against projectRoot', () => {
    expect(resolveProjectRelativePath('data', '/project/root')).toBe(path.resolve('/project/root', 'data'));
    expect(resolveProjectRelativePath('./nested/dir', '/project/root')).toBe(
      path.resolve('/project/root', './nested/dir'),
    );
  });
});
