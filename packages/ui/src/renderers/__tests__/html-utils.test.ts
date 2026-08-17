import { describe, expect, it } from 'vitest';
import {
  escapeHtmlAttribute,
  injectAfterHeadOpen,
  injectBeforeBodyEnd,
  injectBeforeHeadEnd,
} from '../html-utils.js';

describe('escapeHtmlAttribute', () => {
  it('escapes &, ", <, > in that order', () => {
    expect(escapeHtmlAttribute(`a & b "c" <d> &amp;`)).toBe(
      'a &amp; b &quot;c&quot; &lt;d&gt; &amp;amp;',
    );
  });

  it('leaves a plain string untouched', () => {
    expect(escapeHtmlAttribute('plain title')).toBe('plain title');
  });
});

describe('injectAfterHeadOpen', () => {
  it('inserts right after an opening <head> tag', () => {
    expect(injectAfterHeadOpen('<html><head><title>t</title></head></html>', 'X')).toBe(
      '<html><head>X<title>t</title></head></html>',
    );
  });

  it('matches a <head> tag with attributes', () => {
    expect(injectAfterHeadOpen('<head data-x="1"></head>', 'X')).toBe(
      '<head data-x="1">X</head>',
    );
  });

  it('prepends when there is no <head> at all', () => {
    expect(injectAfterHeadOpen('<body>hi</body>', 'X')).toBe('X<body>hi</body>');
  });
});

describe('injectBeforeHeadEnd', () => {
  it('inserts before the real </head>', () => {
    expect(injectBeforeHeadEnd('<html><head><title>t</title></head><body></body></html>', 'X')).toBe(
      '<html><head><title>t</title>X</head><body></body></html>',
    );
  });

  it('skips a </head> literal inside a <script> before <body>', () => {
    const doc =
      '<html><head><script>var s="</head>"</script></head><body></body></html>';
    const result = injectBeforeHeadEnd(doc, 'X');
    // The real </head> (the one right before <body>) gets the injection,
    // not the string literal inside the script.
    expect(result).toBe(
      '<html><head><script>var s="</head>"</script>X</head><body></body></html>',
    );
  });

  it('falls back to right after <head ...> when there is no closing tag', () => {
    expect(injectBeforeHeadEnd('<head><body></body>', 'X')).toBe('<head>X<body></body>');
  });

  it('finds the real </head> even when the document has no <body> at all', () => {
    expect(injectBeforeHeadEnd('<head><title>t</title></head>', 'X')).toBe(
      '<head><title>t</title>X</head>',
    );
  });

  it('prepends when there is no <head> at all', () => {
    expect(injectBeforeHeadEnd('<body>hi</body>', 'X')).toBe('X<body>hi</body>');
  });
});

describe('injectBeforeBodyEnd', () => {
  it('inserts before the real </body>', () => {
    expect(injectBeforeBodyEnd('<html><body><p>hi</p></body></html>', 'X')).toBe(
      '<html><body><p>hi</p>X</body></html>',
    );
  });

  it('skips a </body> literal inside a <script> before </html>', () => {
    const doc = '<html><body><script>var s="</body>"</script></body></html>';
    expect(injectBeforeBodyEnd(doc, 'X')).toBe(
      '<html><body><script>var s="</body>"</script>X</body></html>',
    );
  });

  it('appends at the end when there is no </body> at all', () => {
    expect(injectBeforeBodyEnd('<body>hi', 'X')).toBe('<body>hiX');
  });
});
