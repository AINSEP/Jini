import { describe, expect, it } from 'vitest';

import { shellQuote } from '../shell-quote.js';

describe('shellQuote', () => {
  it('wraps a plain value in single quotes', () => {
    expect(shellQuote('react')).toBe("'react'");
  });

  it('preserves a value containing spaces as one shell word', () => {
    expect(shellQuote('my package')).toBe("'my package'");
  });

  it('escapes an embedded single quote so the shell cannot terminate early', () => {
    // A literal `it's` argument must not close the surrounding quote and let the rest of
    // the string be interpreted as a separate shell token.
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });

  it('escapes a value that is itself an unescaped shell metacharacter sequence', () => {
    expect(shellQuote('$(rm -rf /)')).toBe("'$(rm -rf /)'");
  });

  it('quotes an empty string rather than producing nothing', () => {
    expect(shellQuote('')).toBe("''");
  });
});
